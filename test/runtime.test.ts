/** Integration test: ClippyRuntime (external renderer) drives ClippyViewer
 * broadcasts over SSE, and /command actions route back into triggerBalloon. */
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClippyRuntime } from '../src/runtime.ts'
import { defaultClippyConfig } from '../src/config.ts'
import { ClippyViewer } from '../src/viewer.ts'
import { get } from 'node:http'

// Keep stats writes out of the real pi agent dir during tests.
process.env['PI_CLIPPY_STATS_DIR'] = join(tmpdir(), 'pi-clippy-test-stats')

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

/** Collect SSE `clippy` events until `count` arrive (or a 10s watchdog
 * resolves with whatever arrived, so a regression cannot hang the suite). */
function collectSse(url: string, count: number): { ready: Promise<void>; done: Promise<string[]> } {
  const events: string[] = []
  let resolveReady: () => void = () => {}
  const ready = new Promise<void>(resolve => {
    resolveReady = resolve
  })
  const done = new Promise<string[]>((resolve, reject) => {
    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      req.destroy()
      resolve(events)
    }
    const watchdog = setTimeout(finish, 10_000)
    const req = get(url, res => {
      if (res.statusCode !== 200) {
        clearTimeout(watchdog)
        reject(new Error(`SSE status ${res.statusCode}`))
        return
      }
      resolveReady()
      let buffer = ''
      res.on('data', (c: Buffer) => {
        buffer += c.toString()
        for (;;) {
          const idx = buffer.indexOf('\n\n')
          if (idx < 0) break
          const message = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const line = message.split('\n').find(l => l.startsWith('data: '))
          if (line !== undefined) {
            events.push(line.slice(6))
            if (events.length >= count) {
              clearTimeout(watchdog)
              finish()
              return
            }
          }
        }
      })
    })
    req.on('error', reject)
  })
  return { ready, done }
}

function fakeCtx(): ExtensionContext {
  return {
    hasUI: false,
    mode: 'tui',
    cwd: 'C:/fake',
    ui: {} as ExtensionContext['ui'],
    sessionManager: {
      getLeafId: () => 'leaf-1',
      buildContextEntries: () => [],
    } as unknown as ExtensionContext['sessionManager'],
    modelRegistry: {} as ExtensionContext['modelRegistry'],
    model: undefined,
    isIdle: () => true,
    signal: undefined,
  } as unknown as ExtensionContext
}

async function main(): Promise<void> {
  // Floor disabled so balloon broadcasts arrive immediately (other tests
  // exercise the one-message-at-a-time floor in isolation).
  const viewer = new ClippyViewer('auto', { floor: { enabled: false } })
  await viewer.start(0)
  const token = new URL(viewer.url).searchParams.get('t')
  const sse = collectSse(`${viewer.origin}/events?t=${token}`, 6)
  await sse.ready

  const ctx = fakeCtx()
  const runtime = new ClippyRuntime(ctx, { renderer: 'external', viewer })
  runtime.start()

  // Feed the same agent events the extension forwards.
  runtime.onTurnStart()
  runtime.onMessageUpdate({ message: { role: 'assistant', content: [{ type: 'thinking', thinking: '...' }] } } as never)
  runtime.onToolStart()
  runtime.onAgentEnd([{ role: 'toolResult', toolCallId: '1', toolName: 'bash', content: [], isError: true }] as never)
  runtime.onAgentSettled()
  runtime.onToolEnd(true)

  const events = await sse.done
  const states = events.map(e => (JSON.parse(e) as { state?: string }).state).filter(Boolean)
  check('thinking broadcast', states.filter(s => s === 'thinking').length === 1, states.join(','))
  check('thinking-only update stays thinking (no writing)', !states.includes('writing'), states.join(','))
  check('searching broadcast', states.includes('searching'), states.join(','))
  check('alert broadcast on error', states.filter(s => s === 'alert').length >= 1, states.join(','))
  check('idle broadcast on settle', states.includes('idle'), states.join(','))
  check('no balloon events yet', !events.some(e => (JSON.parse(e) as { type?: string }).type === 'balloon'))

  runtime.dispose()

  // --- Choice answers: the button decides what the model does --------------
  // cameoChance: 0 so balloon side effects can never spawn a real window.
  // A "Yes" no longer writes into the pi session: Clippy carries the offer
  // out himself with his file powers (the model is absent in tests, so the
  // fallback balloon is what lands). Refusals and snoozes are unchanged.
  interface InsertRecord { text: string; options?: { deliverAs?: string } }
  const inserted: InsertRecord[] = []
  const choiceCtx = fakeCtx()
  const choiceRun = new ClippyRuntime(choiceCtx, {
    renderer: 'external',
    viewer,
    config: { ...defaultClippyConfig(), cameoChance: 0 },
    sendUserMessage: (text, options) => { inserted.push({ text: String(text), options }) },
  })
  const showBalloon = (choiceRun as unknown as {
    showBalloon: (text: string, choices?: boolean | readonly string[]) => void
  }).showBalloon.bind(choiceRun)
  const balloonEvents: string[] = []
  const accepted = collectSse(`${viewer.origin}/events?t=${token}`, 4)
  await accepted.ready
  showBalloon('It looks like you are preparing a memo. Would you like help with it?', ['Yes, please', 'No thanks'])
  choiceRun.onChoice(0)
  const acceptedEvents = await accepted.done
  acceptedEvents.forEach(raw => {
    const parsed = JSON.parse(raw) as { type?: string; text?: string }
    if (parsed.type === 'balloon' && typeof parsed.text === 'string') balloonEvents.push(parsed.text)
  })
  check('accepted answer writes nothing into the session (Clippy does it himself)',
    inserted.length === 0, inserted.map(r => r.text).join('|'))
  check('accepted answer makes Clippy act (offer-action balloon lands)',
    balloonEvents.length >= 1 && balloonEvents.some(t => /on it|filing cabinet/iu.test(t)), balloonEvents.join(' | '))
  showBalloon('It looks like you are addressing an envelope. Would you like help with it?', ['Yes', 'No, not now'])
  choiceRun.onChoice(1)
  check('refused answer is not inserted', inserted.length === 0, inserted.map(r => r.text).join('|'))
  showBalloon('It looks like you are filing papers. Would you like help with it?', ['Yes', 'No', "Don't show this tip again"])
  choiceRun.onChoice(2)
  check('snooze answer is not inserted', inserted.length === 0, inserted.map(r => r.text).join('|'))
  choiceRun.dispose()

  // A buddy's accept still asks the pi session for real (buddies cannot edit
  // files): the request is queued as a follow-up while the agent is busy.
  const busyCtx = { ...fakeCtx(), isIdle: () => false } as ExtensionContext
  const busyRun = new ClippyRuntime(busyCtx, {
    renderer: 'external',
    viewer,
    config: { ...defaultClippyConfig(), cameoChance: 0 },
    sendUserMessage: (text, options) => { inserted.push({ text: String(text), options }) },
  })
  viewer.showCameo('bonzi', 'It looks like you are being followed by a paperclip. Would you like help with it?', true)
  // Deliver the line so the buddy's "last words" exist (the window itself
  // is stubbed away in tests, so sayTo stands in for the cameo-ready handoff).
  viewer.sayTo('bonzi', 'It looks like you are being followed by a paperclip. Would you like help with it?')
  busyRun.onBuddyChoice('bonzi', 0, 'Yes')
  check('buddy accept still inserts a real request built from the balloon',
    inserted.length === 1 && (inserted[0]?.text ?? '').startsWith('Yes — help me with'),
    inserted.map(r => r.text).join('|'))
  check('mid-run buddy insertion queues as a follow-up',
    inserted[0]?.options?.deliverAs === 'followUp', JSON.stringify(inserted[0] ?? null))
  busyRun.dispose()
  viewer.dispose()

  const failed = results.filter(r => r.startsWith('FAIL'))
  console.log(results.join('\n'))
  console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
  process.exit(failed.length === 0 ? 0 : 1)
}

void main()
