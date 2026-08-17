/**
 * Diagnostic probe for the runaway-window bug: loads the real shell main and
 * wraps BrowserWindow.prototype.setBounds to count IPC-driven relayouts, then
 * samples every window's position/size twice a second so a drift or a flood
 * is visible in the log. Used by scripts/repro-drift.ts. Not part of the
 * shipped app.
 */
const { BrowserWindow, app } = require('electron')
require('../shell/main.cjs')

let boundsCalls = 0
const origSetBounds = BrowserWindow.prototype.setBounds
BrowserWindow.prototype.setBounds = function (bounds) {
  boundsCalls += 1
  return origSetBounds.call(this, bounds)
}

const t0 = Date.now()
setInterval(() => {
  const wins = BrowserWindow.getAllWindows()
  const rows = wins.map((win) => {
    const [x, y] = win.getPosition()
    const [w, h] = win.getSize()
    return `${x},${y},${w}x${h}`
  })
  console.log(`PROBE +${((Date.now() - t0) / 1000).toFixed(1)}s bounds=${boundsCalls} windows=[${rows.join(' | ')}]`)
  boundsCalls = 0
  // Ground truth: dump every fixed div in the page (the sprite element and
  // the balloon both use position:fixed) with its inline background prefix,
  // display state, size, and text — so a missing, empty, or hidden balloon
  // is visible in the log instead of being masked by the sprite element.
  for (const win of wins) {
    if (!win.__consoleHooked) {
      win.__consoleHooked = true
      // Time the voice race: when the renderer calls speechSynthesis.speak,
      // log the window's ACTUAL bounds at that instant — did the balloon
      // window grow before the voice opened its mouth?
      win.webContents.executeJavaScript(`(() => {
        if (window.__ttsHooked) return;
        window.__ttsHooked = true;
        const orig = speechSynthesis.speak.bind(speechSynthesis);
        speechSynthesis.speak = (u) => {
          console.log('[TIMING] TTS-speak');
          return orig(u);
        };
      })()`).catch(() => {})
      win.webContents.on('console-message', (_e, _level, message) => {
        const msg = typeof message === 'string' ? message : String(_e?.message ?? '')
        if (msg.includes('TTS-speak')) {
          const [x, y] = win.getPosition()
          const [w, h] = win.getSize()
          console.log(`TTS-AT x=${x} y=${y} size=${w}x${h}`)
        } else if (msg.includes('[TIMING]')) {
          console.log('RENDERER ' + msg)
        }
      })
    }
    win.webContents.executeJavaScript(`(() => {
      const boxes = [...document.querySelectorAll('div')];
      const fixed = boxes.filter(d => getComputedStyle(d).position === 'fixed');
      const report = fixed.map(d => ({
        bg: (d.style.background || '').replace(/^url\\([^)]+\\)/, 'url(...)').slice(0, 24),
        disp: d.style.display || 'auto',
        size: d.offsetWidth + 'x' + d.offsetHeight,
        txt: (d.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 48)
      }));
      return JSON.stringify(report);
    })()`).then((result) => {
      const label = win.getTitle() || 'window'
      console.log(`DOM ${label}: ${result}`)
    }).catch(() => {})
  }
}, 500).unref()

setTimeout(() => app.exit(0), 25_000).unref() // hard exit: never leave stray windows behind