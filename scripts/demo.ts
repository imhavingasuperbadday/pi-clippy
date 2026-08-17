/** Live demo: opens the transparent Electron Clippy shell (frameless, no
 * browser) and feeds it a state sequence + one balloon so the final look can
 * be inspected. Right-click Clippy → "Quit Clippy" to close the window. */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ClippyViewer } from '../src/viewer.ts'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

async function main(): Promise<void> {
  const viewer = new ClippyViewer('electron')
  await viewer.start(0)
  const url = viewer.url

  const electron = [
    join(PACKAGE_ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    join(PACKAGE_ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron'),
    join(PACKAGE_ROOT, 'node_modules', 'electron', 'dist', 'electron'),
  ].find(candidate => existsSync(candidate))
  if (electron === undefined) {
    console.error('electron shell not installed')
    process.exit(1)
  }
  spawn(electron, [join(PACKAGE_ROOT, 'shell', 'main.cjs'), `--url=${url}`], {
    detached: true,
    stdio: 'ignore',
  }).unref()
  console.log('opened electron shell:', electron)

  const events: Array<{ type: string; state?: string; text?: string }> = [
    { type: 'state', state: 'thinking' },
    { type: 'state', state: 'writing' },
    { type: 'state', state: 'searching' },
    { type: 'state', state: 'celebrate' },
    { type: 'balloon', text: 'It looks like you are fixing the Clippy window. Would you like help turning this into a chart?' },
    { type: 'state', state: 'flourish' },
    { type: 'state', state: 'alert' },
    { type: 'state', state: 'idle' },
  ]
  events.forEach((event, index) => {
    setTimeout(() => viewer.broadcast('clippy', event), 3_000 * (index + 1))
  })
  // Rival cameo: Bonzi crashes the party ~8s in, argues with Merlin.
  setTimeout(() => {
    viewer.showCameo('bonzi', 'It looks like you are taking advice from a paperclip. Would you like help getting a real assistant?')
  }, 8_000)
  setTimeout(() => viewer.showCameo('merlin', 'It looks like Bonzi is here again. Would you like help ignoring it?'), 11_500)
  setTimeout(() => viewer.sayTo('bonzi', 'It looks like Merlin keeps interrupting my diagnosis. Would you like help sending it away?'), 16_000)
  // Party parade ~24s in.
  setTimeout(() => viewer.broadcast('clippy', { type: 'party' }), 24_000)
  setTimeout(() => {
    viewer.dispose()
    console.log('demo server closed - right-click Clippy to quit the window')
    process.exit(0)
  }, 3_000 * (events.length + 2))
}

void main()
