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

/** Collect SSE `clippy` events until `count` arrive. */
function collectSse(url: string, count: number): { ready: Promise<void>; done: Promise<string[]> } {
  const events: string[] = []
  let resolveReady: () => void = () => {}
  const ready = new Promise<void>(resolve => {
    resolveReady = resolve
  })
  const done = new Promise<string[]>((resolve, reject) => {
    const req = get(url, res => {
      if (res.statusCode !== 200) {
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
              res.destroy()
              resolve(events)
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

  // --- Choice answers become real user messages (sendUserMessage wiring) ---
  // cameoChance: 0 so balloon side effects can never spawn a real window.
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
  showBalloon('It looks like you are preparing a memo. Would you like help with it?', ['Yes, please', 'No thanks'])
  choiceRun.onChoice(0)
  check('accepted answer inserts a real request built from the balloon',
    inserted.length === 1 && inserted[0]?.text === 'Yes, please — help me with preparing a memo.',
    inserted.map(r => r.text).join('|'))
  check('idle insertion sends immediately (no deliverAs)', inserted[0]?.options === undefined)
  showBalloon('It looks like you are addressing an envelope. Would you like help with it?', ['Yes', 'No, not now'])
  choiceRun.onChoice(1)
  check('refused answer is not inserted', inserted.length === 1, inserted.map(r => r.text).join('|'))
  showBalloon('It looks like you are filing papers. Would you like help with it?', ['Yes', 'No', "Don't show this tip again"])
  choiceRun.onChoice(2)
  check('snooze answer is not inserted', inserted.length === 1, inserted.map(r => r.text).join('|'))
  choiceRun.dispose()

  // While the agent is mid-run the answer is queued as a follow-up.
  const busyCtx = { ...fakeCtx(), isIdle: () => false } as ExtensionContext
  const busyRun = new ClippyRuntime(busyCtx, {
    renderer: 'external',
    viewer,
    config: { ...defaultClippyConfig(), cameoChance: 0 },
    sendUserMessage: (text, options) => { inserted.push({ text: String(text), options }) },
  })
  const showBusy = (busyRun as unknown as {
    showBalloon: (text: string, choices?: boolean | readonly string[]) => void
  }).showBalloon.bind(busyRun)
  showBusy('It looks like you are binding a report. Would you like help with it?', ['Please do', 'Not now'])
  busyRun.onChoice(0)
  check('mid-run insertion queues as a follow-up', inserted.length === 2 && inserted[1]?.options?.deliverAs === 'followUp', JSON.stringify(inserted[1] ?? null))
  busyRun.dispose()

  viewer.dispose()

  const failed = results.filter(r => r.startsWith('FAIL'))
  console.log(results.join('\n'))
  console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
  process.exit(failed.length === 0 ? 0 : 1)
}

void main()
