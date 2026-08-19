/** Functional test of the one-message-at-a-time floor: balloons are voiced
 * one at a time — a second message never starts until the first is done —
 * the addressed window's `balloon-gone` (or the fallback reading timer)
 * frees the floor, and a stray window's report cannot cut the live message
 * short. Short zingers (a few words, no buttons) are the exception: they
 * cut another window's voice off and take the floor immediately. */
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
  viewer.broadcast('clippy', { type: 'balloon', to: 'bonzi', text: 'a second message with plenty of words', choices: undefined })

  const first = await sse.next(1_000)
  const second = await sse.next(1_000)
  check('first floored balloon delivered', first !== null && balloonOf(first!).text === 'first message' && balloonOf(first!).to === 'clippy')
  check('second floored balloon delivered after the first', second !== null && balloonOf(second!).text === 'a second message with plenty of words' && balloonOf(second!).to === 'bonzi')
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
  viewer2.broadcast('clippy', { type: 'balloon', to: 'bonzi', text: 'a long message that must wait', choices: undefined })
  check('balloon B queued behind A (long fallback)', await sse2.next(120) === null)
  const released = await post(command, { t: token2, action: 'balloon-gone', agent: 'clippy' })
  check('balloon-gone accepted (204)', released === 204, `status=${released}`)
  const b = await sse2.next(1_000)
  check('balloon B voiced after balloon-gone(addrsee)', b !== null && balloonOf(b!).text === 'a long message that must wait' && balloonOf(b!).to === 'bonzi')
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
  viewer3.broadcast('clippy', { type: 'balloon', to: 'bonzi', text: 'a long message that must wait again', choices: undefined })
  await post(command3, { t: token3, action: 'balloon-gone', agent: 'merlin' })
  check('stray balloon-gone does not free the floor', await sse3.next(120) === null)
  await post(command3, { t: token3, action: 'balloon-gone', agent: 'clippy' })
  const b3 = await sse3.next(1_000)
  check('addressee balloon-gone frees the floor', b3 !== null && balloonOf(b3!).to === 'bonzi')
  sse3.close()
  viewer3.dispose()

  // --- 4) a short zinger cuts another window's voice and jumps the queue ---
  const viewer4 = new ClippyViewer('auto', {
    floor: { enabled: true, readingMs: () => 5_000, gapMs: 30 },
  })
  await viewer4.start(0)
  const token4 = new URL(viewer4.url).searchParams.get('t')
  const sse4 = await openCollector(`${viewer4.origin}/events?t=${token4}`)

  viewer4.broadcast('clippy', { type: 'balloon', text: 'a long prophecy about the spellbook and the ancients', choices: undefined })
  const live = await sse4.next(1_000)
  check('the live message is on the floor', live !== null && balloonOf(live!).to === 'clippy')
  viewer4.broadcast('clippy', { type: 'balloon', to: 'rocky', text: 'Squawk.', choices: undefined })
  // The preemption sends voice-stop (to the interrupted window) before the
  // zinger balloon itself; skip non-balloon events until the zinger lands.
  let zinger: TimedEvent | null = null
  for (let attempts = 0; attempts < 10 && zinger === null; attempts += 1) {
    const candidate = await sse4.next(1_000)
    if (candidate === null) break
    const parsed = JSON.parse(candidate.data) as { type?: string; to?: string; text?: string }
    if (parsed.type === 'balloon') zinger = candidate
  }
  const zingerAt = zinger?.at ?? 0
  check('the zinger is delivered immediately (floor preempted)',
    zinger !== null && balloonOf(zinger!).to === 'rocky' && balloonOf(zinger!).text === 'Squawk.',
    `zinger=${zinger?.data ?? 'none'}`)
  if (live !== null && zinger !== null) {
    check('the zinger did not wait for the reading timer', zingerAt - live.at < 1_000, `delay=${zingerAt - live.at}ms`)
  }
  // The interrupted window's late balloon-gone must not cut the zinger short.
  await post(`${viewer4.origin}/command`, { t: token4, action: 'balloon-gone', agent: 'clippy' })
  check('the interrupted window cannot release the zinger\'s floor', await sse4.next(120) === null)
  // A longer line for the same speaker as the zinger still waits politely.
  viewer4.broadcast('clippy', { type: 'balloon', to: 'rocky', text: 'a longer follow-up line with many words', choices: undefined })
  check('a long follow-up waits behind the zinger', await sse4.next(120) === null)
  await post(`${viewer4.origin}/command`, { t: token4, action: 'balloon-gone', agent: 'rocky' })
  const follow = await sse4.next(1_000)
  check('the follow-up lands after the zinger releases', follow !== null && balloonOf(follow!).to === 'rocky')
  // A zinger addressed to the SAME window that holds the floor does not cut
  // its own message short — it queues.
  viewer4.broadcast('clippy', { type: 'balloon', to: 'rocky', text: 'No.', choices: undefined })
  check('a zinger for the speaker itself waits its turn', await sse4.next(120) === null)
  // Choice balloons never preempt: buttons deserve an uninterrupted turn.
  await post(`${viewer4.origin}/command`, { t: token4, action: 'balloon-gone', agent: 'rocky' })
  const follow2 = await sse4.next(1_000)
  viewer4.broadcast('clippy', { type: 'balloon', to: 'bonzi', text: 'Yes', choices: ['Yes', 'No'] })
  const withChoices = await sse4.next(1_000)
  check('a short line WITH buttons waits like any message', withChoices === null, withChoices?.data ?? 'none')
  sse4.close()
  viewer4.dispose()

  const failed = results.filter(r => r.startsWith('FAIL'))
  console.log(results.join('\n'))
  console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
  process.exit(failed.length === 0 ? 0 : 1)
}

void main()
