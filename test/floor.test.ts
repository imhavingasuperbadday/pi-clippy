/** Functional test of the one-message-at-a-time floor: balloons are voiced
 * one at a time — a second message never starts until the first is done —
 * the addressed window's `balloon-gone` (or the fallback reading timer)
 * frees the floor, and a stray window's report cannot cut the live message
 * short. */
import { ClippyViewer } from '../src/viewer.ts'
import { get, request } from 'node:http'

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

interface TimedEvent { at: number; data: string }

/** Stepwise SSE collector: the next floored balloon, or null if none within
 * `timeoutMs`. Timestamps the arrival so serialization is measurable. */
function openCollector(url: string): Promise<{
  next: (timeoutMs: number) => Promise<TimedEvent | null>
  close: () => void
}> {
  return new Promise((resolve, reject) => {
    const req = get(url, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`SSE status ${res.statusCode}`))
        return
      }
      const queue: TimedEvent[] = []
      const waiters: Array<{ timer: ReturnType<typeof setTimeout>; cb: (e: TimedEvent | null) => void }> = []
      let buffer = ''
      res.on('data', (c: Buffer) => {
        buffer += c.toString()
        for (;;) {
          const idx = buffer.indexOf('\n\n')
          if (idx < 0) break
          const message = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const line = message.split('\n').find(l => l.startsWith('data: '))
          if (line === undefined) continue
          const event = { at: Date.now(), data: line.slice(6) }
          const waiter = waiters.shift()
          if (waiter !== undefined) {
            clearTimeout(waiter.timer)
            waiter.cb(event)
          } else {
            queue.push(event)
          }
        }
      })
      const next = (timeoutMs: number): Promise<TimedEvent | null> => {
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

function post(url: string, body: Record<string, unknown>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      res.resume()
      res.on('end', () => resolve(res.statusCode ?? 0))
    })
    req.on('error', reject)
    req.write(JSON.stringify(body))
    req.end()
  })
}

function balloonOf(e: TimedEvent): { to: string; text: string } {
  const parsed = JSON.parse(e.data) as { type?: string; to?: string; text?: string }
  return { to: parsed.to ?? 'clippy', text: parsed.text ?? '' }
}

async function main(): Promise<void> {
  // --- 1) Serialization: a second balloon waits for the first -----------------
  const viewer = new ClippyViewer('auto', {
    floor: { enabled: true, readingMs: () => 150, gapMs: 50 },
  })
  await viewer.start(0)
  const token = new URL(viewer.url).searchParams.get('t')
  const sse = await openCollector(`${viewer.origin}/events?t=${token}`)

  viewer.broadcast('clippy', { type: 'balloon', text: 'first message', choices: undefined })
  viewer.broadcast('clippy', { type: 'balloon', to: 'bonzi', text: 'second message', choices: undefined })

  const first = await sse.next(1_000)
  const second = await sse.next(1_000)
  check('first floored balloon delivered', first !== null && balloonOf(first!).text === 'first message' && balloonOf(first!).to === 'clippy')
  check('second floored balloon delivered after the first', second !== null && balloonOf(second!).text === 'second message' && balloonOf(second!).to === 'bonzi')
  if (first !== null && second !== null) {
    const gap = second.at - first.at
    // reading (150) + gap (50) => the second can only start at ~200ms after the first.
    check('second balloon waited for the floor (serialized)', gap >= 120, `gap=${gap}ms`)
  }
  // Nothing else was stacked behind them.
  check('no third balloon', await sse.next(90) === null)
  sse.close()
  viewer.dispose()

  // --- 2) balloon-gone from the addressed window releases early ---------------
  const viewer2 = new ClippyViewer('auto', {
    floor: { enabled: true, readingMs: () => 5_000, gapMs: 30 },
  })
  await viewer2.start(0)
  const token2 = new URL(viewer2.url).searchParams.get('t')
  const sse2 = await openCollector(`${viewer2.origin}/events?t=${token2}`)
  const command = `${viewer2.origin}/command`

  viewer2.broadcast('clippy', { type: 'balloon', text: 'A', choices: undefined })
  const a = await sse2.next(1_000)
  check('balloon A delivered', a !== null && balloonOf(a!).text === 'A')
  viewer2.broadcast('clippy', { type: 'balloon', to: 'bonzi', text: 'B', choices: undefined })
  check('balloon B queued behind A (long fallback)', await sse2.next(120) === null)
  const released = await post(command, { t: token2, action: 'balloon-gone', agent: 'clippy' })
  check('balloon-gone accepted (204)', released === 204, `status=${released}`)
  const b = await sse2.next(1_000)
  check('balloon B voiced after balloon-gone(addrsee)', b !== null && balloonOf(b!).text === 'B' && balloonOf(b!).to === 'bonzi')
  sse2.close()
  viewer2.dispose()

  // --- 3) a stray window cannot cut the live message short --------------------
  const viewer3 = new ClippyViewer('auto', {
    floor: { enabled: true, readingMs: () => 5_000, gapMs: 30 },
  })
  await viewer3.start(0)
  const token3 = new URL(viewer3.url).searchParams.get('t')
  const sse3 = await openCollector(`${viewer3.origin}/events?t=${token3}`)
  const command3 = `${viewer3.origin}/command`

  viewer3.broadcast('clippy', { type: 'balloon', text: 'A', choices: undefined })
  const a3 = await sse3.next(1_000)
  viewer3.broadcast('clippy', { type: 'balloon', to: 'bonzi', text: 'B', choices: undefined })
  await post(command3, { t: token3, action: 'balloon-gone', agent: 'merlin' })
  check('stray balloon-gone does not free the floor', await sse3.next(120) === null)
  await post(command3, { t: token3, action: 'balloon-gone', agent: 'clippy' })
  const b3 = await sse3.next(1_000)
  check('addressee balloon-gone frees the floor', b3 !== null && balloonOf(b3!).to === 'bonzi')
  sse3.close()
  viewer3.dispose()

  const failed = results.filter(r => r.startsWith('FAIL'))
  console.log(results.join('\n'))
  console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
  process.exit(failed.length === 0 ? 0 : 1)
}

void main()
