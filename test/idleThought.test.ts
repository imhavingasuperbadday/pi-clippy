/** Background thinking: while the session is idle, Clippy asks the model
 * what he feels like doing and acts on it — summoning a buddy for a chat,
 * offering help with the real buttons, musing out loud, or staying quiet.
 * The thought generator is injected so no model route is needed, and the
 * idle timings are shrunk so a thought can be provoked in milliseconds. */
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClippyRuntime } from '../src/runtime.ts'
import { defaultClippyConfig } from '../src/config.ts'
import type { ClippyModelRouteOverride } from '../src/generator.ts'
import type { IdleThought } from '../src/response.ts'
import { ClippyViewer } from '../src/viewer.ts'
import { get } from 'node:http'

process.env['PI_CLIPPY_STATS_DIR'] = join(tmpdir(), 'pi-clippy-test-stats')

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

/** Drain SSE for `windowMs`, returning every clippy event. */
function drainSse(url: string, windowMs: number): Promise<string[]> {
  return new Promise(resolve => {
    const events: string[] = []
    const req = get(url, res => {
      let buffer = ''
      res.on('data', (c: Buffer) => {
        buffer += c.toString()
        for (;;) {
          const idx = buffer.indexOf('\n\n')
          if (idx < 0) break
          const message = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const line = message.split('\n').find(l => l.startsWith('data: '))
          if (line !== undefined) events.push(line.slice(6))
        }
      })
      res.on('close', () => resolve(events))
      res.on('end', () => resolve(events))
    })
    req.on('error', () => resolve(events))
    setTimeout(() => req.destroy(), windowMs + 50)
  })
}

function fakeCtx(idle: boolean): ExtensionContext & { setIdle: (value: boolean) => void } {
  let current = idle
  return {
    hasUI: true,
    mode: 'tui',
    cwd: 'C:/fake',
    ui: {
      notify: () => {},
      setWidget: () => {},
      setStatus: () => {},
    } as unknown as ExtensionContext['ui'],
    sessionManager: {
      getLeafId: () => 'leaf-1',
      buildContextEntries: () => [],
    } as unknown as ExtensionContext['sessionManager'],
    modelRegistry: {} as ExtensionContext['modelRegistry'],
    model: undefined,
    isIdle: () => current,
    setIdle: (value: boolean) => {
      current = value
    },
    signal: undefined,
  } as unknown as ExtensionContext & { setIdle: (value: boolean) => void }
}

type ThoughtGenerator = (ctx: ExtensionContext, signal: AbortSignal, route: ClippyModelRouteOverride) => Promise<IdleThought>

/** Shrunk timeline: poll every 10ms, think after 25ms of quiet, cool down
 * in 30ms, cap one thought's model call at 2s. */
function timings() {
  return { pollMs: 10, thinkAfterMs: 25, cooldownMs: 30, maxThoughtMs: 2_000 }
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

async function main(): Promise<void> {
  const viewer = new ClippyViewer('auto', { floor: { enabled: false } })
  await viewer.start(0)
  // No real windows in tests.
  const stub = viewer as unknown as { spawnShell: () => void }
  stub.spawnShell = () => {}
  const token = new URL(viewer.url).searchParams.get('t')

  // --- A chat thought summons the named buddy ------------------------------
  const chatSse = drainSse(`${viewer.origin}/events?t=${token}`, 350)
  const chatRun = new ClippyRuntime(fakeCtx(true), {
    renderer: 'external',
    viewer,
    config: { ...defaultClippyConfig(), cameoChance: 1 },
    idleThinkTimings: timings(),
    thoughtGenerator: (async () => ({
      action: 'chat',
      agent: 'bonzi',
      statement: 'you could use a second opinion, so i am asking bonzi to weigh in',
    })) as ThoughtGenerator,
  })
  chatRun.start()
  await sleep(150)
  check('chat thought summons the named buddy', viewer.isCameoOpen('bonzi'))
  chatRun.dispose()
  const chatRaw = await chatSse
  const chatParsed = chatRaw.map(e => JSON.parse(e) as { type?: string; text?: string; state?: string })
  check('background thought poses as thinking',
    chatParsed.some(p => p.state === 'thinking'),
    chatParsed.map(p => p.state).filter(Boolean).join(','))
  check('chat opener spoken out loud before the arrival',
    chatParsed.some(p => p.type === 'balloon' && (p.text ?? '').toLowerCase().includes('second opinion')),
    chatParsed.filter(p => p.type === 'balloon').map(p => p.text).join(' | '))

  // --- cameoChance 0 blocks an idle chat summon ----------------------------
  const gatedSse = drainSse(`${viewer.origin}/events?t=${token}`, 250)
  const gatedRun = new ClippyRuntime(fakeCtx(true), {
    renderer: 'external',
    viewer,
    config: { ...defaultClippyConfig(), cameoChance: 0 },
    idleThinkTimings: timings(),
    thoughtGenerator: (async () => ({
      action: 'chat',
      agent: 'genie',
      statement: 'you could use a second opinion, so i am asking genie to weigh in',
    })) as ThoughtGenerator,
  })
  gatedRun.start()
  await sleep(150)
  check('cameoChance 0 blocks an idle chat summon', !viewer.isCameoOpen('genie'))
  gatedRun.dispose()
  const gatedRaw = await gatedSse
  const gatedParsed = gatedRaw.map(e => JSON.parse(e) as { type?: string; text?: string })
  check('blocked chat impulse stays quiet',
    !gatedParsed.some(p => p.type === 'balloon'),
    gatedParsed.filter(p => p.type === 'balloon').map(p => p.text).join(' | '))

  // --- An offer thought shows a balloon with real buttons ------------------
  const offerSse = drainSse(`${viewer.origin}/events?t=${token}`, 250)
  const offerRun = new ClippyRuntime(fakeCtx(true), {
    renderer: 'external',
    viewer,
    config: { ...defaultClippyConfig(), cameoChance: 0 },
    idleThinkTimings: timings(),
    thoughtGenerator: (async () => ({
      action: 'offer',
      statement: 'you are leaving your files in a heap. would you like help with a filing system?',
    })) as ThoughtGenerator,
  })
  offerRun.start()
  await sleep(150)
  offerRun.dispose()
  const offerParsed = (await offerSse).map(e => JSON.parse(e) as { type?: string; text?: string; choices?: unknown })
  const offerBalloon = offerParsed.find(p => p.type === 'balloon' && (p.text ?? '').toLowerCase().includes('filing system'))
  check('offer thought shows a balloon with real buttons',
    offerBalloon !== undefined && Array.isArray(offerBalloon.choices) && (offerBalloon.choices as unknown[]).length >= 2,
    offerParsed.filter(p => p.type === 'balloon').map(p => `${p.text} [${JSON.stringify(p.choices)}]`).join(' | '))

  // --- A nothing thought stays quiet (but still thinks) ---------------------
  const quietSse = drainSse(`${viewer.origin}/events?t=${token}`, 250)
  const quietRun = new ClippyRuntime(fakeCtx(true), {
    renderer: 'external',
    viewer,
    config: { ...defaultClippyConfig(), cameoChance: 0 },
    idleThinkTimings: timings(),
    thoughtGenerator: (async () => ({ action: 'nothing', statement: '' })) as ThoughtGenerator,
  })
  quietRun.start()
  await sleep(150)
  quietRun.dispose()
  const quietParsed = (await quietSse).map(e => JSON.parse(e) as { type?: string; state?: string })
  check('nothing thought shows no balloon',
    !quietParsed.some(p => p.type === 'balloon'),
    quietParsed.filter(p => p.type === 'balloon').length.toString())
  check('nothing thought still poses as thinking',
    quietParsed.some(p => p.state === 'thinking'),
    quietParsed.map(p => p.state).filter(Boolean).join(','))

  // --- A busy session never triggers a thought ------------------------------
  let asked = 0
  const busyRun = new ClippyRuntime(fakeCtx(false), {
    renderer: 'external',
    viewer,
    config: { ...defaultClippyConfig(), cameoChance: 0 },
    idleThinkTimings: timings(),
    thoughtGenerator: (async () => {
      asked += 1
      return { action: 'remark', statement: 'you are away from your desk' } satisfies IdleThought
    }) as ThoughtGenerator,
  })
  busyRun.start()
  await sleep(150)
  busyRun.dispose()
  check('busy session never triggers a background thought', asked === 0, String(asked))

  // --- A user turn aborts a thought mid-flight ------------------------------
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const abortSse = drainSse(`${viewer.origin}/events?t=${token}`, 250)
  const abortCtx = fakeCtx(true)
  const abortRun = new ClippyRuntime(abortCtx, {
    renderer: 'external',
    viewer,
    config: { ...defaultClippyConfig(), cameoChance: 0 },
    idleThinkTimings: { ...timings(), maxThoughtMs: 5_000 },
    thoughtGenerator: (async () => {
      await gate
      return { action: 'remark', statement: 'you are still away from your desk' } satisfies IdleThought
    }) as ThoughtGenerator,
  })
  abortRun.start()
  await sleep(80) // poll (10ms) sees idle, thinkAfter (25ms) elapses, thought hangs on the gate
  abortRun.onTurnStart() // the user is back: the half-formed thought must die
  abortCtx.setIdle(false) // a real turn is running now, so no second thought fires
  release()
  await sleep(50)
  abortRun.dispose()
  const abortParsed = (await abortSse).map(e => JSON.parse(e) as { type?: string; text?: string })
  check('a user turn aborts the in-flight thought',
    !abortParsed.some(p => p.type === 'balloon' && (p.text ?? '').includes('away from your desk')),
    abortParsed.filter(p => p.type === 'balloon').map(p => p.text).join(' | '))

  const failed = results.filter(r => r.startsWith('FAIL'))
  console.log(results.join('\n'))
  console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
  viewer.dispose()
  process.exit(failed.length === 0 ? 0 : 1)
}

void main()
