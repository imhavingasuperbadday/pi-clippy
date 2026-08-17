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
  /** Subscribe to right-click menu actions (ask, explain, suggest, roast, wave). */
  onMenuAction: (callback) => {
    ipcRenderer.on('clippy:menu', (_event, action) => callback(action))
  },
})
