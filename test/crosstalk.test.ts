/** Functional test of the buddy messaging layer (src/buddy.ts), driven
 * through the runtime with the one-message-at-a-time floor disabled and the
 * crosstalk timeline shrunk to milliseconds:
 *
 *  - a line from Clippy gets a buddy reply, and the buddy's reply gets a
 *    bounded counter-reply back (the mic-back), after which the pair cools
 *    down;
 *  - every agent gets a canned fallback in its own voice when the model is
 *    unavailable (model is stubbed away in tests);
 *  - a buddy's line is never left hanging: Clippy acknowledges it even when
 *    everyone rolls below the crosstalk chance;
 *  - Reaching the annoyance threshold cannot swallow the conversation: the
 *    current line's replies land before Clippy turns the interrupter off.
 */
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { get, request } from 'node:http'
import { ClippyRuntime } from '../src/runtime.ts'
import { defaultClippyConfig } from '../src/config.ts'
import { ClippyViewer } from '../src/viewer.ts'

process.env['PI_CLIPPY_STATS_DIR'] = join(tmpdir(), 'pi-clippy-test-stats')

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

interface AgentEvent { type: string; to?: string; text?: string }

/** Stepwise SSE collector: the next parsed agent event (or null if none
 * within `timeoutMs`). Skips state/party noise. */
function openAgentSse(url: string): Promise<{
  next: (timeoutMs: number) => Promise<AgentEvent | null>
  close: () => void
}> {
  return new Promise((resolve, reject) => {
    const req = get(url, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`SSE status ${res.statusCode}`))
        return
      }
      const queue: AgentEvent[] = []
      const waiters: Array<{ timer: ReturnType<typeof setTimeout>; cb: (e: AgentEvent | null) => void }> = []
      let buffer = ''
      const accept = (raw: string): void => {
        let parsed: unknown
        try {
          parsed = JSON.parse(raw)
        } catch {
          return
        }
        const record = parsed as { type?: unknown; to?: unknown; text?: unknown }
        if (record.type === 'state' || record.type === 'party') return
        const event: AgentEvent = {
          type: String(record.type),
          // Unaddressed balloons are Clippy's own lines (server-side semantic,
          // matching the viewer's lastLines funnel).
          ...(typeof record.to === 'string'
            ? { to: record.to }
            : record.type === 'balloon'
              ? { to: 'clippy' }
              : {}),
          ...(typeof record.text === 'string' ? { text: record.text } : {}),
        }
        const waiter = waiters.shift()
        if (waiter !== undefined) {
          clearTimeout(waiter.timer)
          waiter.cb(event)
        } else {
          queue.push(event)
        }
      }
      res.on('data', (c: Buffer) => {
        buffer += c.toString()
        for (;;) {
          const idx = buffer.indexOf('\n\n')
          if (idx < 0) break
          const message = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const line = message.split('\n').find(l => l.startsWith('data: '))
          if (line !== undefined) accept(line.slice(6))
        }
      })
      const next = (timeoutMs: number): Promise<AgentEvent | null> => {
        const queued = queue.shift()
        if (queued !== undefined) return Promise.resolve(queued)
        return new Promise(cb => {
          const timer = setTimeout(() => {
            const idx = waiters.findIndex(w => w.cb === cb)
            if (idx >= 0) waiters.splice(idx, 1)
            cb(null)
          }, timeoutMs)
          waiters.push({ timer, cb })
        })
      }
      resolve({ next, close: () => res.destroy() })
    })
    req.on('error', reject)
  })
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

function stubShell(viewer: ClippyViewer): void {
  ;(viewer as unknown as { spawnShell: () => void }).spawnShell = () => {}
}

/** Fast, deterministic messaging timeline for the tests. */
const FAST_TIMINGS = {
  crosstalkDelayMs: 20,
  crosstalkStaggerMs: 5,
  crosstalkCooldownMs: 600,
  retryBackoffMs: 15,
  annoyedTurnoffMs: 60,
  maxRepliesPerLine: 2,
  maxExchangesPerWindow: 2,
  micBackChance: 1,
  guaranteedAckExtraMs: 5,
}

async function main(): Promise<void> {
  const viewer = new ClippyViewer('auto', { floor: { enabled: false } })
  await viewer.start(0)
  stubShell(viewer)
  const token = new URL(viewer.url).searchParams.get('t')
  const sse = await openAgentSse(`${viewer.origin}/events?t=${token}`)
  const ctx = fakeCtx()

  // --- 1) Clippy -> buddy reply -> counter-reply back (mic-back) ------------
  const runtime = new ClippyRuntime(ctx, {
    renderer: 'external',
    viewer,
    config: { ...defaultClippyConfig(), cameoChance: 0, crosstalkChance: 1 },
    buddyTimings: FAST_TIMINGS,
    sendUserMessage: () => {},
  })
  runtime.start()
  // Mock a buddy window open (no auto-crosstalk until a real line lands).
  viewer.showCameo('bonzi', 'It looks like you rang in the paperclip.', true)
  const showBalloon = (runtime as unknown as {
    showBalloon: (text: string, choices?: boolean | readonly string[]) => void
  }).showBalloon.bind(runtime)

  showBalloon('It looks like you are writing a letter. Would you like help with it?', ['Yes', 'No'])
  const line1 = await sse.next(500)
  const reply1 = await sse.next(800)
  const counter1 = await sse.next(800)
  check('clippy spoke first', line1?.type === 'balloon' && line1.to === 'clippy')
  check('bonzi answered clippy (canned, model absent)',
    reply1?.type === 'balloon' && reply1.to === 'bonzi' && typeof reply1.text === 'string' && (reply1.text?.length ?? 0) > 10,
    `to=${reply1?.to}`)
  check('clippy countered the reply once (mic-back)', counter1?.type === 'balloon' && counter1.to === 'clippy')
  // The pair now cools down: a fresh clippy line does NOT get a bonzi reply.
  showBalloon('It looks like a second paragraph needs formatting. Would you like help with it?', ['Yes', 'No'])
  const line2 = await sse.next(500)
  check('second clippy line delivered', line2?.type === 'balloon' && line2.to === 'clippy')
  check('pair cooled down — no reply after the exchange window', null === await sse.next(150))
  // Once the cooldown expires the pair gets a FRESH exchange window: a reply
  // AND the mic-back again. (The budget used to be spent permanently, so the
  // second window silently degraded to a single line for the whole session.)
  await new Promise(r => setTimeout(r, FAST_TIMINGS.crosstalkCooldownMs))
  showBalloon('It looks like the filing cabinet needs a third letter. Would you like help with it?', ['Yes', 'No'])
  const line3 = await sse.next(500)
  const reply3 = await sse.next(800)
  const counter3 = await sse.next(800)
  check('third clippy line delivered', line3?.type === 'balloon' && line3.to === 'clippy')
  check('bonzi answered again after the cooldown', reply3?.type === 'balloon' && reply3.to === 'bonzi', `to=${reply3?.to}`)
  check('the mic-back survives into the next exchange window',
    counter3?.type === 'balloon' && counter3.to === 'clippy', `to=${counter3?.to}`)
  runtime.dispose()

  // --- 2) A buddy line is never left hanging (guaranteed acknowledgment) ----
  const quiet = new ClippyRuntime(ctx, {
    renderer: 'external',
    viewer,
    config: { ...defaultClippyConfig(), cameoChance: 0, crosstalkChance: 0, annoyanceChance: 0 },
    buddyTimings: FAST_TIMINGS,
    sendUserMessage: () => {},
  })
  quiet.start()
  await quiet.summonBuddy('merlin')
  const ack = await sse.next(800)
  check('clippy acknowledged a buddy line even with crosstalk at 0',
    ack?.type === 'balloon' && ack.to === 'clippy' && (ack.text?.length ?? 0) > 10,
    `to=${ack?.to} text=${ack?.text}`)
  quiet.dispose()

  // --- 3) The annoying interrupter is turned off AFTER replies land ----------
  const irate = new ClippyViewer('auto', { floor: { enabled: false } })
  await irate.start(0)
  stubShell(irate)
  const token3 = new URL(irate.url).searchParams.get('t')
  const sse3 = await openAgentSse(`${irate.origin}/events?t=${token3}`)
  const cranky = new ClippyRuntime(ctx, {
    renderer: 'external',
    viewer: irate,
    config: {
      ...defaultClippyConfig(),
      cameoChance: 0,
      crosstalkChance: 1,
      annoyanceChance: 1,
    },
    buddyTimings: { ...FAST_TIMINGS, micBackChance: 0 },
    sendUserMessage: () => {},
  })
  cranky.start()
  irate.showCameo('rocky', 'It looks like you woke the bird.', true)
  // Four quips in a row trip Clippy's patience (ANNOYED_AFTER_QUIPS = 4).
  for (let i = 0; i < 4; i += 1) {
    cranky.onCameoClick('rocky')
    await new Promise(r => setTimeout(r, 30))
  }
  // Watch until the turn-off lands; the conversation must have happened first.
  let hadRockyReply = false
  let hadClippyReply = false
  let closedRocky = false
  for (let i = 0; i < 20 && !closedRocky; i += 1) {
    const ev = await sse3.next(200)
    if (ev === null) break
    if (ev.type === 'balloon' && ev.to === 'rocky') hadRockyReply = true
    if (ev.type === 'balloon' && ev.to === 'clippy') hadClippyReply = true
    if (ev.type === 'close' && ev.to === 'rocky') closedRocky = true
  }
  check('rocky spoke while being annoying', hadRockyReply)
  check('clippy answered before the hang-up (conversation not swallowed)', hadClippyReply)
  check('clippy turned the interrupter off', closedRocky && !irate.isCameoOpen('rocky'))
  cranky.dispose()
  irate.dispose()

  sse.close()
  viewer.dispose()

  const failed = results.filter(r => r.startsWith('FAIL'))
  console.log(results.join('\n'))
  console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
  process.exit(failed.length === 0 ? 0 : 1)
}

void main()
