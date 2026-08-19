/** Functional test for ClippyViewer: routes, SSE broadcast, token auth, traversal guard. */
import { ClippyViewer } from '../src/viewer.ts'
import { get, request } from 'node:http'

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

function httpGet(url: string): Promise<{ status: number; type: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    get(url, res => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, type: res.headers['content-type'] ?? '', body: Buffer.concat(chunks) }))
    }).on('error', reject)
  })
}

function httpPost(url: string, body: unknown): Promise<number> {
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

function openSse(url: string): Promise<{ data: () => Promise<string>; close: () => void }> {
  return new Promise((resolve, reject) => {
    const req = get(url, res => {
      if (res.statusCode !== 200) {
        reject(new Error(`SSE status ${res.statusCode}`))
        return
      }
      let buffer = ''
      const data = () =>
        new Promise<string>((res2, rej2) => {
          const pump = (): void => {
            for (;;) {
              const idx = buffer.indexOf('\n\n')
              if (idx < 0) return
              const message = buffer.slice(0, idx)
              buffer = buffer.slice(idx + 2)
              if (message.includes('event:')) {
                cleanup()
                res2(message)
                return
              }
            }
          }
          const onChunk = (c: Buffer) => {
            buffer += c.toString()
            pump()
          }
          const onEnd = () => {
            cleanup()
            rej2(new Error('SSE closed before event'))
          }
          const cleanup = () => {
            res.off('data', onChunk)
            res.off('end', onEnd)
          }
          res.on('data', onChunk)
          res.on('end', onEnd)
          pump()
        })
      resolve({ data, close: () => res.destroy() })
    })
    req.on('error', reject)
  })
}

async function main(): Promise<void> {
  const viewer = new ClippyViewer()
  let commands: string[] = []
  const extras: Array<Record<string, unknown> | undefined> = []
  viewer.onCommand = (action, _agent, extra) => {
    commands.push(action)
    extras.push(extra)
  }
  await viewer.start(0)

  // Page with token
  const page = await httpGet(viewer.url)
  check('GET / serves page', page.status === 200 && page.type.startsWith('text/html'), `status=${page.status}`)
  check('page mentions client module', page.body.toString().includes('/assets/client.js'))

  // Page without token
  const forbidden = await httpGet(viewer.origin + '/')
  check('GET / without token is 403', forbidden.status === 403, `status=${forbidden.status}`)

  // Vendor assets (clippyjs dist)
  const vendor = await httpGet(`${viewer.origin}/vendor/index.mjs`)
  check('GET /vendor/index.mjs', vendor.status === 200 && vendor.type.includes('javascript'), `status=${vendor.status}`)
  const agent = await httpGet(`${viewer.origin}/vendor/agents/clippy/index.mjs`)
  check('GET /vendor/agents/clippy/index.mjs', agent.status === 200, `status=${agent.status}`)
  const map = await httpGet(`${viewer.origin}/vendor/agents/clippy/map.mjs`)
  check('GET /vendor/agents/clippy/map.mjs (sprite data uri)', map.status === 200 && map.body.length > 100_000, `bytes=${map.body.length}`)
  const sounds = await httpGet(`${viewer.origin}/vendor/agents/clippy/sounds-mp3.mjs`)
  check('GET /vendor/agents/clippy/sounds-mp3.mjs', sounds.status === 200, `status=${sounds.status}`)

  // Traversal guard: a raw request with literal dot segments must never serve files
  // outside /vendor (the WHATWG URL parser normalizes most of these; the guard
  // catches anything that survives).
  const traversal = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(
      { hostname: '127.0.0.1', port: new URL(viewer.origin).port, path: '/vendor/../../package.json', method: 'GET' },
      res => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
        )
      },
    )
    req.on('error', reject)
    req.end()
  })
  check(
    'path traversal blocked',
    traversal.status !== 200 && !traversal.body.includes('pi-clippy'),
    `status=${traversal.status}`,
  )
  const missing = await httpGet(`${viewer.origin}/vendor/nope.mjs`)
  check('missing vendor file is 404', missing.status === 404, `status=${missing.status}`)

  // SSE stream + broadcast
  const sse = await openSse(`${viewer.origin}/events?t=${new URL(viewer.url).searchParams.get('t')}`)
  viewer.broadcast('clippy', { type: 'state', state: 'thinking' })
  const event = await sse.data()
  check('SSE broadcast received', event.includes('event: clippy') && event.includes('"thinking"'), event.slice(0, 80))
  sse.close()

  // Command auth
  const bad = await httpPost(`${viewer.origin}/command`, { t: 'wrong', action: 'clippy' })
  check('POST /command with bad token is 403', bad === 403, `status=${bad}`)
  const ok = await httpPost(`${viewer.origin}/command`, { t: new URL(viewer.url).searchParams.get('t'), action: 'clippy' })
  check('POST /command with token is 204', ok === 204, `status=${ok}`)
  const cameoReady = await httpPost(`${viewer.origin}/command`, {
    t: new URL(viewer.url).searchParams.get('t'),
    action: 'cameo-ready',
    agent: 'bonzi',
  })
  check('POST /command cameo-ready with no pending cameo is 204', cameoReady === 204, `status=${cameoReady}`)
  await new Promise(r => setTimeout(r, 100))
  check('onCommand fired', commands.includes('clippy'), JSON.stringify(commands))

  // The right-click Reasoning submenu posts { action: "reasoning", level };
  // the level must survive the hop to onCommand or the menu does nothing.
  await httpPost(`${viewer.origin}/command`, {
    t: new URL(viewer.url).searchParams.get('t'),
    action: 'reasoning',
    agent: 'clippy',
    level: 'high',
  })
  await new Promise(r => setTimeout(r, 100))
  const reasoningExtra = extras[commands.indexOf('reasoning')]
  check(
    'reasoning level reaches onCommand',
    reasoningExtra?.['level'] === 'high',
    JSON.stringify(reasoningExtra),
  )

  // --- A buddy window that goes away really goes away ----------------------
  // An agent the viewer still believes is on screen can never be summoned
  // again, is skipped by casting as "already here", and stalls the message
  // floor every time somebody addresses it — which is how a desktop ends up
  // with one rival and no way to reach any of the others.
  const token = new URL(viewer.url).searchParams.get('t')
  viewer.showCameo('rocky', 'Squawk.', true)
  check('a summoned buddy counts as open', viewer.isCameoOpen('rocky'))
  await httpPost(`${viewer.origin}/command`, { t: token, action: 'cameo-gone', agent: 'rocky' })
  await new Promise(r => setTimeout(r, 100))
  check('a departed buddy stops counting as open', !viewer.isCameoOpen('rocky'))
  viewer.showCameo('rocky', 'Squawk. Again.', true)
  check('a departed buddy can be summoned again', viewer.isCameoOpen('rocky'))
  await httpPost(`${viewer.origin}/command`, { t: token, action: 'cameo-gone', agent: 'rocky' })
  await new Promise(r => setTimeout(r, 100))
  // The liveness report keeps a live window alive without reopening a dead one.
  const alive = await httpPost(`${viewer.origin}/command`, { t: token, action: 'cameo-alive', agent: 'rocky' })
  check('a heartbeat from a closed window is harmless',
    alive === 204 && !viewer.isCameoOpen('rocky'), `status=${alive}`)

  viewer.dispose()
  const closed = await httpGet(`${viewer.origin}/`).then(() => 'open', () => 'closed')
  check('dispose closes server', closed === 'closed', closed)

  const failed = results.filter(r => r.startsWith('FAIL'))
  console.log(results.join('\n'))
  console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
  process.exit(failed.length === 0 ? 0 : 1)
}

void main()
