/** Boredom depth: the escalation inside the `bored` mood. The mood itself
 * is binary (test/mood.test.ts); this tests the depth on top of it — the
 * quiet clock, the once-per-depth canned lines, and the guards that keep a
 * boredom line from displacing buttons or a match in progress.
 *
 * Pure function (boredGameOfferChance) plus the runtime layer driven
 * directly through its private seams, asserting what the window would
 * actually receive. */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { get } from 'node:http'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { ClippyRuntime, boredGameOfferChance } from '../src/runtime.ts'
import { defaultClippyConfig } from '../src/config.ts'
import { ClippyViewer } from '../src/viewer.ts'
import { newGame } from '../src/games.ts'

process.env['PI_CLIPPY_STATS_DIR'] = join(tmpdir(), 'pi-clippy-test-boredom')

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

interface Event { type?: string; text?: string }

function listen(url: string): { ready: Promise<void>; events: Event[]; stop: () => void } {
  const events: Event[] = []
  let resolveReady: () => void = () => {}
  const ready = new Promise<void>(resolve => { resolveReady = resolve })
  const req = get(url, res => {
    resolveReady()
    let buffer = ''
    res.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      for (;;) {
        const idx = buffer.indexOf('\n\n')
        if (idx < 0) break
        const message = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 2)
        const line = message.split('\n').find(l => l.startsWith('data: '))
        if (line !== undefined) {
          try {
            events.push(JSON.parse(line.slice(6)) as Event)
          } catch {
            // heartbeat or comment line
          }
        }
      }
    })
  })
  req.on('error', () => {})
  return { ready, events, stop: () => req.destroy() }
}

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 120))

function fakeCtx(entries: unknown[] = []): ExtensionContext {
  return {
    hasUI: false,
    mode: 'tui',
    cwd: 'C:/fake',
    ui: {} as ExtensionContext['ui'],
    sessionManager: {
      getLeafId: () => 'leaf-1',
      buildContextEntries: () => entries as ExtensionContext['sessionManager'] extends { buildContextEntries(): infer R } ? R : never,
    } as unknown as ExtensionContext['sessionManager'],
    modelRegistry: {} as ExtensionContext['modelRegistry'],
    model: undefined,
    isIdle: () => true,
    signal: undefined,
  } as unknown as ExtensionContext
}

/** The runtime's private boredom seams, reached the way tests usually reach
 * private machinery here (see test/antics.test.ts). */
interface BoredomSeams {
  observeClimate(force?: boolean): void
  noteBoredom(): void
  boredomLevel(): 0 | 1 | 2
  boredSince: number
  boredDepthAck: number
  lastBalloonAt: number
  lastChoices: readonly string[] | undefined
  game: unknown
}

/** One successful tool call in the evidence: enough to make the climate
 * read delighted instead of bored, ending a quiet stretch. */
function activityEntries(): unknown[] {
  return [
    {
      type: 'message',
      timestamp: new Date().toISOString(),
      message: {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-1', name: 'bash', arguments: {} }],
      },
    },
    {
      type: 'message',
      timestamp: new Date().toISOString(),
      message: {
        role: 'toolResult',
        toolCallId: 'call-1',
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
      },
    },
  ]
}

async function main(): Promise<void> {
  const viewer = new ClippyViewer('auto', { floor: { enabled: false } })
  await viewer.start(0)
  const token = new URL(viewer.url).searchParams.get('t')
  const stream = listen(`${viewer.origin}/events?t=${token}`)
  await stream.ready

  const config = { ...defaultClippyConfig(), cameoChance: 0, dailyGreeting: false, idleThinking: false }
  const runtime = new ClippyRuntime(fakeCtx(), { renderer: 'external', viewer, config, typoChance: 0 })
  runtime.start()
  const seams = runtime as unknown as BoredomSeams
  const texts = (): string[] => stream.events.filter(e => e.type === 'balloon').map(e => e.text ?? '')

  // --- The offer chance escalates with depth --------------------------------
  check('fresh boredom keeps the classic game-offer chance', boredGameOfferChance(0) === 0.35)
  check('stir-crazy boredom pushes the game harder', boredGameOfferChance(1) === 0.6)
  check('desperate boredom all but demands the game', boredGameOfferChance(2) === 0.8)

  // --- The quiet clock ------------------------------------------------------
  seams.observeClimate(true)
  await settle()
  check('a dead session reads as bored and starts the clock',
    seams.boredSince > 0 && seams.boredomLevel() === 0, `since=${seams.boredSince}`)
  const fresh = texts().length
  seams.noteBoredom()
  await settle()
  check('fresh boredom says nothing yet', texts().length === fresh, texts().slice(fresh).join(' | '))

  // --- First depth: stir-crazy ---------------------------------------------
  seams.boredSince = Date.now() - 5 * 60_000
  seams.lastBalloonAt = 0
  seams.noteBoredom()
  await settle()
  check('stir-crazy boredom admits the pixel counting',
    texts().some(t => t.includes('counted the pixels')), texts().slice(fresh).join(' | '))
  const afterStir = texts().length
  seams.noteBoredom()
  await settle()
  check('the depth line is said exactly once', texts().length === afterStir)

  // --- Second depth: desperate ---------------------------------------------
  seams.boredSince = Date.now() - 15 * 60_000
  seams.lastBalloonAt = 0
  seams.noteBoredom()
  await settle()
  check('desperate boredom confesses the self-play match',
    texts().some(t => t.includes('against myself')), texts().slice(afterStir).join(' | '))

  // --- The guards: nothing displaces what is on screen ----------------------
  // The depth is rewound so the guards are actually reached: with the depth
  // already banked, noteBoredom returns before it ever consults them.
  seams.boredSince = Date.now() - 20 * 60_000
  seams.boredDepthAck = 1
  seams.lastBalloonAt = 0
  const beforeChoice = texts().length
  seams.lastChoices = ['Yes, please', 'Not now']
  seams.noteBoredom()
  await settle()
  check('a boredom line never displaces pending buttons', texts().length === beforeChoice)
  seams.lastChoices = undefined

  const beforeGame = texts().length
  seams.game = newGame()
  seams.noteBoredom()
  await settle()
  check('a boredom line never interrupts a match in progress', texts().length === beforeGame)
  seams.game = undefined

  const beforeFloor = texts().length
  seams.lastBalloonAt = Date.now()
  seams.noteBoredom()
  await settle()
  check('a boredom line waits for the floor to clear', texts().length === beforeFloor)

  // A suppressed line is postponed, not lost: the depth is only banked once
  // it has actually been said.
  check('a suppressed depth is not banked', seams.boredDepthAck === 1)
  seams.lastBalloonAt = 0
  seams.noteBoredom()
  await settle()
  check('the postponed line lands once the floor is free',
    texts().length > beforeFloor && seams.boredDepthAck === 2,
    texts().slice(beforeFloor).join(' | '))

  // --- Activity ends the stretch --------------------------------------------
  const active = new ClippyRuntime(fakeCtx(activityEntries()), { renderer: 'external', viewer, config, typoChance: 0 })
  const activeSeams = active as unknown as BoredomSeams
  activeSeams.observeClimate(true)
  await settle()
  check('activity resets the boredom clock',
    activeSeams.boredSince === 0 && activeSeams.boredDepthAck === 0,
    `since=${activeSeams.boredSince} ack=${activeSeams.boredDepthAck}`)

  runtime.dispose()
  active.dispose()
  stream.stop()
  viewer.dispose()

  const failed = results.filter(r => r.startsWith('FAIL'))
  console.log(results.join('\n'))
  console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
  process.exit(failed.length === 0 ? 0 : 1)
}

void main()
