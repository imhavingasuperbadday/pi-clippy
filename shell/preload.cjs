/** Minimal preload bridge for the Clippy shell: lets the page resize its
 * window (so it hugs the agent exactly and grows only for the dialog box),
 * move it across the screen by dragging the agent, close itself (cameos),
 * and quit (right-click menu on Clippy). */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('clippyShell', {
  setBounds: (bounds) => ipcRenderer.invoke('clippy:set-bounds', bounds),
  setPosition: (x, y) => ipcRenderer.invoke('clippy:set-position', x, y),
  close: () => ipcRenderer.send('clippy:close'),
  quit: () => ipcRenderer.send('clippy:quit'),
  /** Where the mouse pointer is on screen, so the sprite can lean a few
   * degrees toward it. Read-only: the page asks where the cursor is, and
   * nothing here can move the window. */
  cursorPoint: () => ipcRenderer.invoke('clippy:cursor'),
  /** Subscribe to right-click menu actions (ask, explain, suggest, roast, wave). */
  onMenuAction: (callback) => {
    ipcRenderer.on('clippy:menu', (_event, action) => callback(action))
  },
  /** Tell the shell an agent's mute state changed, however it changed — a
   * menu click, the typed "shut up" egg, a brush-off strike, or a timed
   * mute lifting on its own — so the right-click menu's "Shut up" /
   * "Let ... talk again" item stays in sync with reality. */
  setShushed: (agent, shushed) => ipcRenderer.send('clippy:shush-state', agent, shushed),
})
