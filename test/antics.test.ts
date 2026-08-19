/** Integration test for the behavior layer added on top of the balloon
 * machinery: being shushed (and what it costs to un-shush him), typed
 * easter eggs, the strike, rubber-duck mode, and the physical antics the
 * window reports back.
 *
 * Everything here runs against the real ClippyRuntime and a real
 * ClippyViewer with the floor disabled, so what is asserted is what the
 * window would actually receive. */
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { get } from 'node:http'
import { ClippyRuntime } from '../src/runtime.ts'
import { defaultClippyConfig } from '../src/config.ts'
import { ClippyViewer } from '../src/viewer.ts'

process.env['PI_CLIPPY_STATS_DIR'] = join(tmpdir(), 'pi-clippy-test-antics')

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

interface Event { type?: string; text?: string; effect?: string; shushed?: boolean; hat?: string | null; color?: string }

/** Collect every `clippy` SSE event until the caller stops listening. */
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

/** The runtime's private balloon entry point, for driving the parts that a
 * model would normally supply text for. */
type Speak = (text: string, choices?: boolean | readonly string[], subject?: string, force?: boolean) => void

async function main(): Promise<void> {
  const viewer = new ClippyViewer('auto', { floor: { enabled: false } })
  await viewer.start(0)
  const token = new URL(viewer.url).searchParams.get('t')
  const stream = listen(`${viewer.origin}/events?t=${token}`)
  await stream.ready

  const config = { ...defaultClippyConfig(), cameoChance: 0, dailyGreeting: false, idleThinking: false }
  const runtime = new ClippyRuntime(fakeCtx(), { renderer: 'external', viewer, config, typoChance: 0 })
  const speak = (runtime as unknown as { showBalloon: Speak }).showBalloon.bind(runtime) as Speak
  const texts = (): string[] => stream.events.filter(e => e.type === 'balloon').map(e => e.text ?? '')
  const effects = (): string[] => stream.events.filter(e => e.type === 'effect').map(e => e.effect ?? '')

  // --- Being shushed -------------------------------------------------------
  runtime.shushAgent('clippy')
  await settle()
  check('the shush reaches the window', stream.events.some(e => e.type === 'shush' && e.shushed === true))
  check('the runtime reports him silenced', runtime.isShushed('clippy'))
  const beforeMute = texts().length
  speak('It looks like you are filing papers. Would you like help with it?')
  await settle()
  check('a volunteered line is swallowed while he is muted', texts().length === beforeMute)
  speak('You asked me something, so I am answering.', false, undefined, true)
  await settle()
  check('a line you asked for still arrives while he is muted',
    texts().some(t => t.includes('so I am answering')))
  runtime.unshushAgent('clippy')
  await settle()
  check('un-shushing lifts the tape', stream.events.some(e => e.type === 'shush' && e.shushed === false))
  check('silence costs one catch-up line',
    texts().some(t => t.startsWith('I can talk again?')), texts().slice(-2).join(' | '))
  const afterUnmute = texts().length
  speak('It looks like you are filing papers again.')
  await settle()
  check('he speaks freely once un-shushed', texts().length > afterUnmute)

  // --- Typed easter eggs ---------------------------------------------------
  runtime.onUserInput('xyzzy')
  await settle()
  check('xyzzy answers with the hollow voice', texts().some(t => t.includes('plugh')))
  runtime.onUserInput('do a barrel roll')
  await settle()
  check('the barrel roll reaches the window as an effect', effects().includes('barrel-roll'))
  runtime.onUserInput('should I rm -rf node_modules')
  await settle()
  check('rm -rf gets the panic effect', effects().includes('panic'))
  check('the panic line admits it cannot stop you',
    texts().some(t => t.includes('cannot actually stop you')))
  const beforeOrdinary = texts().length
  runtime.onUserInput('please refactor the runtime timers to be injectable')
  await settle()
  check('an ordinary message triggers no egg', texts().length === beforeOrdinary, texts().slice(-1).join(''))

  // --- The typed mute ------------------------------------------------------
  runtime.onUserInput('clippy, shut up for a bit')
  await settle()
  check('the typed shut up mutes him', runtime.isShushed('clippy'))
  runtime.unshushAgent('clippy')
  await settle()

  // --- The strike ----------------------------------------------------------
  runtime.onUserInput('not now')
  runtime.onUserInput('not now')
  const beforeStrike = texts().length
  runtime.onUserInput('not now')
  await settle()
  check('three brush-offs earn a strike', effects().includes('strike'))
  check('the strike is announced', texts().length > beforeStrike
    && texts().some(t => t.includes('withdrawing my labour')))
  const onStrike = texts().length
  speak('It looks like you are filing papers. Would you like help with it?')
  await settle()
  check('a striking paperclip volunteers nothing', texts().length === onStrike)
  speak('You asked, so I am answering.', false, undefined, true)
  await settle()
  check('but he still answers you directly', texts().length > onStrike)
  runtime.dispose()

  // --- Rubber-duck mode ----------------------------------------------------
  const duckRun = new ClippyRuntime(fakeCtx(), { renderer: 'external', viewer, config, typoChance: 0 })
  const duckSpeak = (duckRun as unknown as { showBalloon: Speak }).showBalloon.bind(duckRun) as Speak
  check('duck mode toggles on', duckRun.toggleDuck())
  await settle()
  const beforeDuck = texts().length
  duckSpeak('It looks like you are writing a letter. Would you like help with it?')
  await settle()
  check('a duck offers nothing unprompted', texts().length === beforeDuck)
  check('duck mode toggles back off', !duckRun.toggleDuck())
  duckRun.dispose()

  // --- The antics the window reports back ----------------------------------
  const anticRun = new ClippyRuntime(fakeCtx(), { renderer: 'external', viewer, config, typoChance: 0 })
  anticRun.onPetted()
  await settle()
  check('petting is acknowledged', texts().some(t => t.includes('petted the paperclip')))
  check('petting shows a content pose', effects().includes('content'))
  anticRun.onFeed()
  await settle()
  check('feeding him lands a crumb', effects().includes('feed'))
  anticRun.onStartled()
  await settle()
  check('a startle gets one annoyed line', texts().some(t => t.includes('made of wire')))
  anticRun.onStartled()
  await settle()
  check('startling him again wears the complaint down, not repeats it',
    texts().some(t => t.includes('not recovered from the first one')))
  anticRun.onStartled()
  anticRun.onStartled()
  await settle()
  check('past the last line he stays resigned',
    texts().filter(t => t.includes('braced, permanently')).length === 2,
    texts().slice(-3).join(' | '))
  anticRun.onKeyboardMash()
  await settle()
  check('a keyboard mash gets the deadpan',
    texts().some(t => t === 'It looks like you are typing.'))
  anticRun.onClassicLine()
  await settle()
  check('Ctrl+L says the classic line on demand',
    texts().some(t => t.startsWith('It looks like you are writing a letter')))
  anticRun.haunt()
  await settle()
  check('the ghost is a window effect, not new sprite art', effects().includes('ghost'))
  check('the ghost has something to say about 2007',
    texts().some(t => t.includes('retired in 2007')))
  anticRun.dispose()

  stream.stop()
  viewer.dispose()

  const failed = results.filter(r => r.startsWith('FAIL'))
  console.log(results.join('\n'))
  console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
  process.exit(failed.length === 0 ? 0 : 1)
}

void main()
