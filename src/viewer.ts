/** Localhost HTTP + SSE bridge that drives the Clippy window (real clippyjs
 * sprite art) and rival-assistant cameo windows from a pi session.
 *
 * The pi extension hosts a tiny server bound to 127.0.0.1, serves the Clippy
 * page plus the clippyjs vendor assets (from node_modules/clippyjs/dist), and
 * streams `state` / `balloon` / `party` events to the page over SSE. Clicks
 * POST back to `/command` (e.g. action "clippy", "konami").
 *
 * Cameo windows: `showCameo(agent, text)` opens a second window for a rival
 * assistant (bonzi, genie, ...). The cameo page announces itself with
 * `cameo-ready`; the pending retort is then delivered to that window only
 * (SSE events carry a `to` field), and the window dismisses itself.
 *
 * The page URL carries a per-machine token (persisted in %TEMP%/pi-clippy so
 * the window can reconnect across pi restarts); `/events` and `/command`
 * reject requests without it. Feature toggles (voice, cameo hold time) travel
 * as URL params so the renderer needs no configuration of its own.
 *
 * **The floor**: balloon delivery is serialized so exactly one message is on
 * screen (and voiced) at a time across ALL windows — a buddy's message never
 * loads right after, or on top of, Clippy's. Balloons queue FIFO; the window
 * holding the floor reports `balloon-gone` (POST /command) when its balloon
 * closes or the user answers it, releasing the floor for the next message,
 * with a fallback reading timer as insurance against a dead renderer.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { CAMEO_AGENTS } from './cameos.ts'
import type { ClippyShell } from './config.ts'
import { applyVoiceParams, VOICE_OFF, type VoiceSettings } from './voice.ts'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ASSETS_DIR = join(PACKAGE_ROOT, 'assets')
const CLIPPYJS_DIR = join(PACKAGE_ROOT, 'node_modules', 'clippyjs', 'dist')

const MIME: Record<string, string> = {
  '.mjs': 'text/javascript',
  '.js': 'text/javascript',
  '.html': 'text/html',
  '.css': 'text/css',
  '.png': 'image/png',
  '.mp3': 'audio/mpeg',
  '.json': 'application/json',
  '.d.mts': 'text/plain',
}

const HEARTBEAT_MS = 20_000
const MAX_COMMAND_BODY = 4_096
const WINDOW_SIZE = '280,340'
const DEFAULT_PORT = 8_765
const CAMEO_READY_TIMEOUT_MS = 20_000
/** Dedicated profile so --app always opens a standalone Clippy window even
 * when the user's Edge/Chrome is already running (otherwise the app window
 * can silently become a tab in the existing browser). */
const APP_PROFILE_DIR = join(tmpdir(), 'pi-clippy-browser-profile')
/** Persistent state: the token must stay stable across pi restarts so an
 * already-open Clippy window (Electron shell or browser app window) can
 * reconnect when pi starts again. Same-user localhost trust only. */
const STATE_DIR = join(tmpdir(), 'pi-clippy')
const TOKEN_FILE = join(STATE_DIR, 'token')
const SHELL_MAIN = join(PACKAGE_ROOT, 'shell', 'main.cjs')

function loadOrCreateToken(): string {
  try {
    const existing = readFileSync(TOKEN_FILE, 'utf8').trim()
    if (existing.length >= 16) return existing
  } catch {
    // generate below
  }
  const token = randomBytes(12).toString('hex')
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(TOKEN_FILE, token, { encoding: 'utf8', mode: 0o600 })
  } catch {
    // token still works for this process even if it cannot be persisted
  }
  return token
}

export interface ClippyFloorOptions {
  /** Serialize balloon delivery so only ONE message is on screen at a time:
   * a buddy's message waits until Clippy's (or another buddy's) balloon has
   * been read and voiced before it starts, instead of landing right after or
   * on top of it. Default: on. */
  readonly enabled?: boolean
  /** Fallback reading time per message (ms), used only if the addressed
   * window never reports `balloon-gone` (dead/sleeping renderer). Choice
   * balloons get a longer decision window than plain lines. */
  readonly readingMs?: (hasChoices: boolean) => number
  /** A beat of silence after a message clears before the next is voiced. */
  readonly gapMs?: number
}

export interface ClippyViewerOptions {
  /** Speak balloons aloud via the renderer's speechSynthesis (Electron only). */
  readonly voice: VoiceSettings
  /** How long a cameo window stays before dismissing itself. */
  readonly holdMs: number
  /** Which assistants can be summoned from the right-click menu. */
  readonly friends: readonly string[]
  /** The one-message-at-a-time floor. */
  readonly floor?: ClippyFloorOptions
}

const DEFAULT_VIEWER_OPTIONS: ClippyViewerOptions = {
  voice: VOICE_OFF,
  holdMs: 8_000,
  friends: [...CAMEO_AGENTS],
  // Fallback reading times comfortably exceed the renderer's own close delay
  // (typewriter + CLOSE_BALLOON_DELAY) so the renderer's precise
  // balloon-gone report normally releases the floor first; the fallback only
  // guards against a dead or sleeping window.
  floor: { enabled: true, readingMs: hasChoices => (hasChoices ? 36_000 : 12_000), gapMs: 900 },
}

export class ClippyViewer {
  private server: Server | undefined
  private clients = new Set<ServerResponse>()
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private readonly token: string
  private readonly options: ClippyViewerOptions
  private readonly floor: Required<Omit<ClippyFloorOptions, 'enabled'>> & { enabled: boolean }
  private port: number | undefined
  private readonly pendingCameos = new Map<string, string>()
  /** Choice buttons waiting for a cameo window's opening line. */
  private readonly pendingCameoChoices = new Map<string, readonly string[] | undefined>()
  /** Cameo windows currently known to be open (per agent). */
  private readonly activeCameos = new Set<string>()
  /** One-message-at-a-time floor queue (balloons waiting to be voiced). */
  private readonly floorQueue: Array<{ payload: string; to: string; hasChoices: boolean }> = []
  /** The fallback reading timer for the balloon currently on the floor. */
  private floorTimer: ReturnType<typeof setTimeout> | undefined
  /** The silence gap timer between floored messages. */
  private floorGapTimer: ReturnType<typeof setTimeout> | undefined
  /** The window currently holding the floor (agent of the live balloon). */
  private floorActiveTo: string | undefined

  /** Fired for POST /command actions, e.g. { action: "clippy" } from a click.
   * The second argument carries the requesting window's agent for cameo
   * actions (cameo-ready / cameo-click); the third carries extra fields such
   * as the `target` of a summon or turn-off. */
  onCommand: ((action: string, agent?: string, extra?: Record<string, unknown>) => void) | undefined

  constructor(
    private readonly shell: ClippyShell = 'auto',
    options: Partial<ClippyViewerOptions> = {},
  ) {
    this.token = loadOrCreateToken()
    this.options = { ...DEFAULT_VIEWER_OPTIONS, ...options }
    const floor = options.floor ?? {}
    this.floor = {
      enabled: floor.enabled !== false,
      readingMs: floor.readingMs ?? (hasChoices => (hasChoices ? 36_000 : 12_000)),
      gapMs: floor.gapMs ?? 900,
    }
  }

  get origin(): string {
    return this.port === undefined ? '' : `http://127.0.0.1:${this.port}`
  }

  get url(): string {
    return this.pageUrl()
  }

  private pageUrl(extra: Record<string, string> = {}): string {
    const params = new URLSearchParams({ t: this.token })
    applyVoiceParams(params, this.options.voice)
    params.set('friends', this.options.friends.join(','))
    for (const [key, value] of Object.entries(extra)) params.set(key, value)
    return `${this.origin}/?${params.toString()}`
  }

  async start(preferredPort?: number): Promise<void> {
    const server = createServer((req, res) => {
      void this.handle(req, res)
    })
    const listen = (port: number): Promise<void> =>
      new Promise((resolve, reject) => {
        const onError = (error: NodeJS.ErrnoException): void => {
          server.off('listening', onListening)
          reject(error)
        }
        const onListening = (): void => {
          server.off('error', onError)
          resolve()
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(port, '127.0.0.1')
      })

    try {
      await listen(preferredPort ?? DEFAULT_PORT)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || preferredPort !== undefined) throw error
      console.warn('[pi-clippy] port %d is busy, using an ephemeral port; an already-open Clippy window may not reconnect',
        DEFAULT_PORT)
      await listen(0)
    }

    this.server = server
    const address = server.address()
    this.port = typeof address === 'object' && address !== null ? address.port : undefined
    this.heartbeat = setInterval(() => this.ping(), HEARTBEAT_MS)
  }

  dispose(): void {
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat)
    this.heartbeat = undefined
    if (this.floorTimer !== undefined) clearTimeout(this.floorTimer)
    if (this.floorGapTimer !== undefined) clearTimeout(this.floorGapTimer)
    this.floorTimer = undefined
    this.floorGapTimer = undefined
    this.floorQueue.length = 0
    this.floorActiveTo = undefined
    for (const client of this.clients) {
      try {
        client.end()
      } catch {
        // already closed
      }
    }
    this.clients.clear()
    this.pendingCameos.clear()
    this.pendingCameoChoices.clear()
    this.activeCameos.clear()
    this.lastLines.clear()
    if (this.server !== undefined) {
      this.server.close()
      this.server = undefined
    }
    this.port = undefined
  }

  /** Last balloon text sent to each agent window (unaddressed balloons
   * count as Clippy's). Filled by broadcast/sayTo/cameo delivery, so any
   * caller can ask "what did <agent> just say?" — the funnel every line
   * passes through. */
  private readonly lastLines = new Map<string, string>()

  /** The last balloon text sent to `agent` (or undefined if it never spoke). */
  lastLineBy(agent: string): string | undefined {
    return this.lastLines.get(agent)
  }

  broadcast(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    if (event === 'clippy' && typeof data === 'object' && data !== null) {
      const record = data as { type?: unknown; to?: unknown; text?: unknown }
      if (record.type === 'balloon' && typeof record.text === 'string') {
        const to = typeof record.to === 'string' ? record.to : 'clippy'
        this.lastLines.set(to, record.text)
        if (this.floor.enabled) {
          // One message at a time: the balloon waits for the floor instead of
          // being written straight to the renderers, so no two windows are
          // ever talking at once.
          this.enqueueBalloon(payload, to, Array.isArray((data as { choices?: unknown }).choices))
          return
        }
      }
    }
    this.writeAll(payload)
  }

  private writeAll(payload: string): void {
    for (const client of this.clients) {
      try {
        client.write(payload)
      } catch {
        client.destroy()
      }
    }
  }

  // --- One-message-at-a-time floor ----------------------------------------

  /** Queue a balloon behind any that are still being read or voiced. The
   * floor sends exactly one balloon at a time (FIFO), so a buddy's message
   * can never land on top of — or immediately after — Clippy's (or another
   * buddy's). The window that heard the message reports `balloon-gone` when
   * its balloon closes so the next can start; the fallback reading timer
   * covers a dead or silent renderer. A short gap after each message keeps
   * consecutive messages from butting up against each other. */
  private enqueueBalloon(payload: string, to: string, hasChoices: boolean): void {
    this.floorQueue.push({ payload, to, hasChoices })
    this.drainFloor()
  }

  private drainFloor(): void {
    if (this.floorTimer !== undefined || this.floorGapTimer !== undefined) return
    const next = this.floorQueue.shift()
    if (next === undefined) {
      this.floorActiveTo = undefined
      return
    }
    this.floorActiveTo = next.to
    this.writeAll(next.payload)
    this.floorTimer = setTimeout(() => this.floorRelease(), this.floor.readingMs(next.hasChoices))
  }

  /** The floor is free: stop the fallback timer and, after a beat of
   * silence, voice the next queued message. Idempotent — a window reporting
   * `balloon-gone` at the same moment the fallback fires only releases once. */
  private floorRelease(): void {
    if (this.floorTimer !== undefined) {
      clearTimeout(this.floorTimer)
      this.floorTimer = undefined
    }
    if (this.floorGapTimer !== undefined) return
    this.floorGapTimer = setTimeout(() => {
      this.floorGapTimer = undefined
      this.drainFloor()
    }, this.floor.gapMs)
  }

  /** A renderer window reported that its balloon is done (closed on its own,
   * or the user answered it). Release the floor early so the next message can
   * be voiced. Only the window currently holding the floor is listened to, so
   * a stray report from another window cannot cut the live message short. */
  onBalloonGone(agent?: string): void {
    if (agent !== undefined && this.floorActiveTo !== undefined && agent !== this.floorActiveTo) return
    this.floorRelease()
  }

  /** Deliver a balloon (with optional choice buttons) to a specific cameo
   * window that is already connected. */
  sayTo(agent: string, text: string, choices?: readonly string[]): void {
    this.broadcast('clippy', { type: 'balloon', to: agent, text, choices })
  }

  /** Open or focus a permanent buddy window and deliver its opening line.
   * Summoned buddies stay until dismissed or turned off; an already-open
   * window is upgraded and addressed in place instead of duplicating. */
  summonCameo(agent: string, text: string, choices?: readonly string[]): void {
    this.openCameo(agent, text, true, choices)
  }

  /** Open a rival assistant window; its retort is delivered when it is ready.
   * `persistent` keeps it around until dismissed; otherwise the window
   * dismisses itself after holdMs. If the buddy is already open, the line is
   * delivered to the existing window (and it is kept around). */
  showCameo(agent: string, text: string, persistent = false, choices?: readonly string[]): void {
    this.openCameo(agent, text, persistent, choices)
  }

  /** The shared opener behind summon and one-shot cameos: registers the
   * window as active, queues the opening line for delivery on `cameo-ready`,
   * and spawns the shell. An already-open buddy is addressed in place. */
  private openCameo(agent: string, text: string, persistent: boolean, choices?: readonly string[]): void {
    if (this.activeCameos.has(agent)) {
      if (persistent) this.keepCameo(agent)
      this.sayTo(agent, text, choices)
      return
    }
    this.activeCameos.add(agent)
    this.pendingCameos.set(agent, text)
    this.pendingCameoChoices.set(agent, choices)
    const extra: Record<string, string> = { agent, holdMs: String(this.options.holdMs) }
    if (persistent) extra['persistent'] = '1'
    this.spawnShell(this.pageUrl(extra))
    const timer = setTimeout(() => {
      // The window never announced itself (spawn failed, or the shell was
      // killed before it connected). Forget the pending line *and* the
      // active-cameo claim: otherwise the agent stays "open" forever, and
      // every line addressed to it takes the floor and stalls the queue
      // until the fallback reading timer expires.
      if (!this.pendingCameos.has(agent)) return
      this.pendingCameos.delete(agent)
      this.pendingCameoChoices.delete(agent)
      this.activeCameos.delete(agent)
    }, CAMEO_READY_TIMEOUT_MS)
    timer.unref?.()
  }

  /** Stop an already-open cameo from dismissing itself. */
  keepCameo(agent: string): void {
    this.broadcast('clippy', { type: 'persist', to: agent })
  }

  /** Turn off a buddy: its window is asked to close itself. */
  closeCameo(agent: string): void {
    this.activeCameos.delete(agent)
    this.pendingCameos.delete(agent)
    this.pendingCameoChoices.delete(agent)
    this.broadcast('clippy', { type: 'close', to: agent })
  }

  isCameoOpen(agent: string): boolean {
    return this.activeCameos.has(agent)
  }

  openWindow(): void {
    this.spawnShell(this.url)
  }

  // --- Internals ---------------------------------------------------------

  private spawnShell(url: string): void {
    if (this.port === undefined) return
    if (this.shell !== 'browser') {
      const electron = this.electronPath()
      if (electron !== undefined) {
        const settingsPath = join(getAgentDir(), 'settings.json')
        const child = spawn(electron, [SHELL_MAIN, `--url=${url}`, `--settings=${settingsPath}`], {
          detached: true,
          stdio: 'ignore',
        })
        child.on('error', () => this.openBrowserWindow(url))
        child.unref()
        return
      }
      if (this.shell === 'electron') {
        console.warn('[pi-clippy] electron shell not found, falling back to a browser app window')
      }
    }
    this.openBrowserWindow(url)
  }

  /** The packaged Electron binary, when the shell is installed. */
  private electronPath(): string | undefined {
    const root = join(PACKAGE_ROOT, 'node_modules', 'electron', 'dist')
    const candidates = [
      join(root, 'electron.exe'),
      join(root, 'Electron.app', 'Contents', 'MacOS', 'Electron'),
      join(root, 'electron'),
    ]
    return candidates.find(candidate => existsSync(candidate))
  }

  /** Launch a small standalone app-mode window: no tabs, no URL bar, just
   * Clippy. Uses a dedicated profile so it never opens inside the user's
   * running browser, and walks every installed Chromium browser before
   * falling back to the default browser. */
  private openBrowserWindow(url: string): void {
    const appArgs = [
      `--app=${url}`,
      `--window-size=${WINDOW_SIZE}`,
      `--user-data-dir=${APP_PROFILE_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
    ]
    const candidates = this.chromiumApps()
    const tryLaunch = (index: number): void => {
      const app = candidates[index]
      if (app === undefined) {
        // Last resort: the platform's default browser (full window; better
        // than nothing).
        const [opener, args] = process.platform === 'win32'
          ? ['cmd', ['/c', 'start', '', url]]
          : process.platform === 'darwin'
            ? ['open', [url]]
            : ['xdg-open', [url]]
        const fallback = spawn(opener as string, args as string[], { detached: true, stdio: 'ignore' })
        fallback.on('error', () => {
          console.warn('[pi-clippy] could not open a window; visit %s manually', url)
        })
        fallback.unref()
        return
      }
      const child = spawn(app, appArgs, { detached: true, stdio: 'ignore' })
      child.on('error', () => tryLaunch(index + 1))
      child.unref()
    }
    tryLaunch(0)
  }

  private chromiumApps(): string[] {
    const candidates = process.platform === 'win32'
      ? this.windowsChromiumApps()
      : process.platform === 'darwin'
        ? [
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
        ]
        : [
          '/usr/bin/microsoft-edge',
          '/usr/bin/google-chrome',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser',
        ]
    return [...new Set(candidates)].filter(candidate => existsSync(candidate))
  }

  private windowsChromiumApps(): string[] {
    const roots = [
      process.env['PROGRAMFILES(X86)'],
      process.env['PROGRAMFILES'],
      process.env['LOCALAPPDATA'],
    ].filter((root): root is string => root !== undefined)
    return [
      ...roots.map(root => join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
      ...roots.map(root => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')),
    ]
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const pathname = url.pathname

    if (req.method === 'POST' && pathname === '/command') {
      let parsed: unknown = null
      try {
        parsed = JSON.parse(await this.readBody(req)) as unknown
      } catch {
        parsed = null
      }
      const record = (parsed ?? {}) as Record<string, unknown>
      if (record.t !== this.token) {
        res.writeHead(403)
        res.end('Forbidden')
        return
      }
      res.writeHead(204)
      res.end()
      const action = typeof record.action === 'string' ? record.action : undefined
      const agent = typeof record.agent === 'string' ? record.agent : undefined
      if (action === 'cameo-ready') {
        if (agent !== undefined && this.pendingCameos.has(agent)) {
          this.broadcast('clippy', { type: 'balloon', to: agent, text: this.pendingCameos.get(agent), choices: this.pendingCameoChoices.get(agent) })
          this.pendingCameos.delete(agent)
          this.pendingCameoChoices.delete(agent)
        }
        return
      }
      if (action === 'cameo-gone') {
        // A cameo window closed itself; forget it so a future summon reopens it.
        if (agent !== undefined) this.activeCameos.delete(agent)
        return
      }
      if (action === 'balloon-gone') {
        // A renderer finished showing a floored balloon (or the user answered
        // it): release the one-message-at-a-time floor so the next can start.
        this.onBalloonGone(agent)
        return
      }
      if (action !== undefined) {
        const extra: Record<string, unknown> = {}
        if (typeof record.target === 'string') extra['target'] = record.target
        if (typeof record.index === 'number') extra['index'] = record.index
        if (typeof record.label === 'string') extra['label'] = record.label
        // The reasoning submenu posts { action: "reasoning", level }; without
        // this the level never reached the runtime and the menu did nothing.
        if (typeof record.level === 'string') extra['level'] = record.level
        this.onCommand?.(action, agent, extra)
      }
      return
    }

    if (req.method !== 'GET') {
      res.writeHead(405)
      res.end()
      return
    }

    if (pathname === '/events') {
      if (url.searchParams.get('t') !== this.token) {
        res.writeHead(403)
        res.end('Forbidden')
        return
      }
      this.handleEvents(res)
      return
    }

    if (pathname === '/') {
      if (url.searchParams.get('t') !== this.token) {
        res.writeHead(403)
        res.end('Forbidden')
        return
      }
      this.serveOrMiss(res, ASSETS_DIR, 'index.html')
      return
    }

    if (pathname === '/assets/client.js') {
      this.serveOrMiss(res, ASSETS_DIR, 'client.js')
      return
    }

    if (pathname.startsWith('/vendor/')) {
      this.serveOrMiss(res, CLIPPYJS_DIR, pathname.slice('/vendor/'.length))
      return
    }

    res.writeHead(404)
    res.end('Not found')
  }

  private handleEvents(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(': connected\n\n')
    this.clients.add(res)
    res.on('close', () => {
      this.clients.delete(res)
    })
  }

  private ping(): void {
    for (const client of this.clients) {
      try {
        client.write(': ping\n\n')
      } catch {
        client.destroy()
      }
    }
  }

  /** Serve a file, answering 404 when it is missing. Every route must end in
   * a response: a route that simply returned on a missing file left the
   * request open until the client timed out. */
  private serveOrMiss(res: ServerResponse, root: string, relative: string): void {
    if (this.serveFile(res, root, relative)) return
    res.writeHead(404)
    res.end('Not found')
  }

  private serveFile(res: ServerResponse, root: string, relative: string): boolean {
    const target = normalize(join(root, relative))
    if (target !== root && !target.startsWith(root + sep)) {
      res.writeHead(403)
      res.end('Forbidden')
      return true
    }
    let body: Buffer
    try {
      body = readFileSync(target)
    } catch {
      return false
    }
    const ext = extname(target).toLowerCase()
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' })
    res.end(body)
    return true
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let size = 0
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_COMMAND_BODY) {
          reject(new Error('command body too large'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
  }
}
