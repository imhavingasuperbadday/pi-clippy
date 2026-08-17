/** Dry run: verify the viewer server starts and the Windows app-window launch
 * would find an installed Chromium browser. Never launches a window. */
import { ClippyViewer } from '../src/viewer.ts'

async function main(): Promise<void> {
  const viewer = new ClippyViewer()
  await viewer.start(0)
  const apps = (viewer as unknown as { chromiumApps(): string[] }).chromiumApps()
  const electron = (viewer as unknown as { electronPath(): string | undefined }).electronPath()
  console.log('origin:', viewer.origin)
  console.log('url:', viewer.url)
  console.log('electron shell:', electron ?? 'not installed')
  console.log('chromium candidates found:')
  for (const app of apps) console.log('  ' + app)
  console.log(apps.length === 0 ? 'FAIL no browser found' : 'PASS browser found')
  viewer.dispose()
}

void main()
