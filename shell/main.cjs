/**
 * pi-clippy Electron shell: frameless, transparent, always-on-top windows
 * that show only the agents. No browser, no window chrome, no Microsoft
 * branding.
 *
 * - The Clippy window starts at exactly Clippy's sprite size; the renderer
 *   resizes it upward via `clippy:set-bounds` only while his dialog box is
 *   visible, keeping Clippy fixed on screen.
 * - Dragging Clippy moves the whole window (`clippy:set-position`), so he
 *   can roam the screen.
 * - Rival assistants (bonzi, genie, ...) open as additional windows spawned
 *   through the single-instance lock; they place themselves next to Clippy.
 *   Summoned buddies (`persistent=1` in the URL) keep their window until
 *   dismissed or turned off; transient ones dismiss themselves after their
 *   retort.
 * - Right-click an agent → the SAME context menu for Clippy and every buddy:
 *   Ask / Explain / Suggest / Roast / Wave, a **Summon a buddy** submenu (so
 *   any window can spawn more buddies), a **Turn off a buddy** submenu (so
 *   Clippy and the buddies can turn each other off, which the session
 *   remembers), Settings…, and Quit Clippy (main) / Turn off <agent> (buddy).
 * - Windows stay open when pi exits; the page reconnects when pi returns and
 *   says so through the dialog box.
 */
const { app, BrowserWindow, Menu, ipcMain, shell: electronShell } = require('electron')
const path = require('node:path')
const os = require('node:os')

app.setPath('userData', path.join(os.tmpdir(), 'pi-clippy', 'electron-profile'))
app.setName('Clippy')

const DEFAULT_FRIENDS = ['bonzi', 'genie', 'merlin', 'rover', 'rocky', 'peedy', 'links']

/** win -> agent name ('clippy' for the main window). */
const agentWindows = new Map()
/** Path to pi's settings.json, passed by the extension so Settings can open it. */
let settingsPath = null

function parseArgv(argv) {
  const url = argv.find(arg => arg.startsWith('--url='))?.slice('--url='.length)
  const settings = argv.find(arg => arg.startsWith('--settings='))?.slice('--settings='.length)
  return { url, settings }
}

function openSettings() {
  const target = settingsPath ?? path.join(os.homedir(), '.pi', 'agent', 'settings.json')
  electronShell.openPath(target).catch(() => {})
}

function agentLabel(agent) {
  return agent.charAt(0).toUpperCase() + agent.slice(1)
}

function friendsFromUrl(url) {
  try {
    const raw = new URL(url).searchParams.get('friends')
    if (!raw) return DEFAULT_FRIENDS
    const parsed = raw.split(',').map(s => s.trim()).filter(Boolean)
    return parsed.length > 0 ? parsed : DEFAULT_FRIENDS
  } catch {
    return DEFAULT_FRIENDS
  }
}

/** Buddies that currently have a window (excluding `self`, and never Clippy
 * — turning off Clippy is Quit Clippy, which lives elsewhere in the menu). */
function activeBuddies(self) {
  return [...agentWindows.values()].filter(name => name !== 'clippy' && name !== self)
}

const CLIPPY_AGENTS = new Set(['bonzi', 'genie', 'merlin', 'rover', 'rocky', 'peedy', 'links', 'clippy'])

/** Selected reasoning mode for Clippy's model route (DeepSeek v4 Flash et
 * al.) — shared across windows so the radio marks survive menu rebuilds. */
const REASONING_LEVELS = ['off', 'low', 'medium', 'high']
let reasoningLevel = 'medium'

function reasoningMenu(win) {
  return REASONING_LEVELS.map(level => ({
    label: level === 'off' ? 'Off' : level.charAt(0).toUpperCase() + level.slice(1),
    type: 'radio',
    checked: reasoningLevel === level,
    click: () => {
      reasoningLevel = level
      sendMenuAction(win, `reasoning:${level}`)
    },
  }))
}

function assistantMenu(agent, win) {
  const label = agent === 'clippy' ? 'Clippy' : agentLabel(agent)
  const url = win.webContents.getURL()
  const friends = friendsFromUrl(url).filter(friend => CLIPPY_AGENTS.has(friend) && friend !== agent)
  const turnoffCandidates = activeBuddies(agent)

  const summonItems = friends.map(friend => ({
    label: agentLabel(friend),
    click: () => sendMenuAction(win, `summon:${friend}`),
  }))
  const turnOffItems = turnoffCandidates.map(friend => ({
    label: `Turn off ${agentLabel(friend)}`,
    click: () => sendMenuAction(win, `turnoff:${friend}`),
  }))

  const items = [
    { label: `Ask ${label}`, click: () => sendMenuAction(win, 'ask') },
    { label: 'Explain last change', click: () => sendMenuAction(win, 'explain') },
    { label: 'Suggest next step', click: () => sendMenuAction(win, 'suggest') },
    { label: 'Roast me', click: () => sendMenuAction(win, 'roast') },
    { label: 'Wave', click: () => sendMenuAction(win, 'wave') },
    { type: 'separator' },
    {
      label: 'Reasoning mode',
      submenu: reasoningMenu(win),
    },
    { type: 'separator' },
    {
      label: 'Summon a buddy',
      enabled: summonItems.length > 0,
      submenu: summonItems.length > 0 ? summonItems : [{ label: '(no other buddies configured)', enabled: false }],
    },
    {
      label: 'Turn off a buddy',
      enabled: turnOffItems.length > 0,
      submenu: turnOffItems.length > 0 ? turnOffItems : [{ label: '(no buddies are out)', enabled: false }],
    },
    { type: 'separator' },
    { label: 'Settings…', click: () => openSettings() },
    { type: 'separator' },
  ]
  if (agent === 'clippy') {
    items.push({ label: 'Quit Clippy', click: () => app.quit() })
  } else {
    items.push({ label: `Turn off ${label}`, click: () => win.close() })
  }
  return items
}

function sendMenuAction(win, action) {
  win.webContents.send('clippy:menu', action)
}

function agentFromUrl(url) {
  try {
    return new URL(url).searchParams.get('agent') ?? 'clippy'
  } catch {
    return 'clippy'
  }
}

function createAgentWindow(url, nearWin) {
  const agent = agentFromUrl(url)
  const win = new BrowserWindow({
    // Exactly the agent's sprite frame plus a few px of transparent margin;
    // the renderer resizes for the dialog box as needed.
    width: 136,
    height: 105,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  agentWindows.set(win, agent)

  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // Buddies appear next to Clippy (staggered so several can be out at once
  // without stacking in exactly the same spot).
  if (agent !== 'clippy') {
    const ref = nearWin ?? [...agentWindows.entries()].find(([, name]) => name === 'clippy')?.[0]
    if (ref !== undefined && !ref.isDestroyed()) {
      const [x, y] = ref.getPosition()
      const count = [...agentWindows.values()].filter(name => name !== 'clippy').length
      const col = (count % 3) * 150
      const row = Math.floor(count / 3) * 60
      win.setPosition(x + 60 + col, y + 40 + row)
    }
  }

  win.webContents.on('context-menu', () => {
    Menu.buildFromTemplate(assistantMenu(agent, win)).popup()
  })

  win.once('ready-to-show', () => {
    win.show()
  })
  win.on('closed', () => {
    agentWindows.delete(win)
  })

  void win.loadURL(url)
  return win
}

// IPC is routed to the window that sent it, so each agent window sizes and
// moves itself.
ipcMain.handle('clippy:set-bounds', (event, bounds) => {
  BrowserWindow.fromWebContents(event.sender)?.setBounds(bounds)
})
ipcMain.handle('clippy:set-position', (event, x, y) => {
  BrowserWindow.fromWebContents(event.sender)?.setPosition(x, y)
})
ipcMain.on('clippy:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close()
})
ipcMain.on('clippy:quit', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (win !== null && agentWindows.get(win) === 'clippy') app.quit()
  else win?.close()
})

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  // Buddy windows are spawned as new electron invocations; the first instance
  // receives them here. Reopening an agent that already has a window just
  // focuses it (no duplicates); new agents open next to Clippy.
  app.on('second-instance', (_event, argv) => {
    const { url, settings } = parseArgv(argv)
    if (url === undefined) return
    if (settings !== undefined) settingsPath = settings
    const agent = agentFromUrl(url)
    const existing = [...agentWindows.entries()].find(([, name]) => name === agent)
    if (existing !== undefined) {
      const [win] = existing
      if (!win.isDestroyed()) {
        // A settings change (e.g. voice) changes the URL params; reload the
        // live window so the new configuration actually applies instead of
        // silently keeping the old one.
        if (win.webContents.getURL() !== url) void win.loadURL(url)
        if (win.isMinimized()) win.restore()
        win.focus()
        return
      }
    }
    const main = [...agentWindows.entries()].find(([, name]) => name === 'clippy')?.[0]
    createAgentWindow(url, main)
  })

  app.whenReady().then(() => {
    const { url, settings } = parseArgv(process.argv)
    if (settings !== undefined) settingsPath = settings
    createAgentWindow(url ?? 'http://127.0.0.1:8765/')
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}