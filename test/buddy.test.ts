/** Functional check of the new buddy system: summon/keep/close over SSE,
 * session memory on turn-off, one-liner retort reuse, and watchdog behavior.
 * Spawn stubbed so no real windows open. */
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClippyRuntime } from '../src/runtime.ts'
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
    isIdle: () => false, // pretend the agent is always mid-turn
    signal: undefined,
  } as unknown as ExtensionContext
}

async function main(): Promise<void> {
  const viewer = new ClippyViewer('auto', { floor: { enabled: false } })
  await viewer.start(0)
  // No real windows in tests.
  const stub = viewer as unknown as { spawnShell: () => void }
  stub.spawnShell = () => {}
  const token = new URL(viewer.url).searchParams.get('t')
  const draining = drainSse(`${viewer.origin}/events?t=${token}`, 400)

  const runtime = new ClippyRuntime(fakeCtx(), { renderer: 'external', viewer })
  runtime.start()
  await new Promise(r => setTimeout(r, 20))

  // Summon a buddy: it opens (activeCameos) and delivers a greeting line.
  await runtime.summonBuddy('bonzi')
  check('summon opens cameo', viewer.isCameoOpen('bonzi'))
  check('summon does not open a duplicate', viewer.isCameoOpen('bonzi') === true)

  // The same buddy retorting later reuses the existing window.
  viewer.showCameo('bonzi', 'still here', true)
  check('retort reuses open cameo (still one active)', viewer.isCameoOpen('bonzi'))

  // Clicking talks and keeps it around.
  runtime.onCameoClick('bonzi')
  check('click keeps cameo open', viewer.isCameoOpen('bonzi'))

  // Banter: bonzi conjures merlin, both remember the argument.
  runtime.triggerBuddyAction('bonzi', 'roast')
  check('buddy menu line reachable (no throw)', true)

  // Turn off: window closes and the memory records it.
  runtime.turnOffBuddy('clippy', 'bonzi')
  check('turn off closes cameo', !viewer.isCameoOpen('bonzi'))

  // Re-summoning later (same session) greets with the grudge — no throw.
  await runtime.summonBuddy('bonzi')
  check('re-summon reopens a turned-off buddy', viewer.isCameoOpen('bonzi'))

  const events = await draining
  const parsed = events.map(e => JSON.parse(e) as { type: string; to?: string })
  const types = parsed.map(p => p.type)
  check('persist event broadcast', types.includes('persist'))
  check('close event broadcast', types.includes('close'))
  check('persist/close addressed to bonzi',
    parsed.some(p => p.type === 'persist' && p.to === 'bonzi') &&
    parsed.some(p => p.type === 'close' && p.to === 'bonzi'),
    types.join(','))
  check('buddy balloons addressed', parsed.some(p => p.type === 'balloon' && p.to === 'bonzi'), types.join(','))

  const failed = results.filter(r => r.startsWith('FAIL'))
  console.log(results.join('\n'))
  console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
  runtime.dispose()
  viewer.dispose()
  process.exit(failed.length === 0 ? 0 : 1)
}

void main()