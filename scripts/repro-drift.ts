/** Repro for the runaway-window bug: opens one Clippy window against a fresh
 * viewer server, broadcasts a balloon with choice buttons (the exact trigger
 * — buddy talks / Clippy talks / a choice is clicked — they all enter the
 * same balloon → relayout → setBounds → resize → reposition path), and lets
 * the probe main (scripts/probe-main.cjs) log position drift and setBounds
 * flood for ten seconds. Red: bounds keeps climbing while a balloon is up.
 * Green: bounds settles near zero and x/y hold still. */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ClippyViewer } from '../src/viewer.ts'
import { VOICE_OFF } from '../src/voice.ts'

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

async function main(): Promise<void> {
  const voiceOn = process.env.VOICE === '1'
  const viewer = new ClippyViewer('electron', voiceOn ? { voice: { enabled: true, rate: 1, pitch: 1 } } : {})
  if (voiceOn) console.log('=== VOICE ON ===')
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

  const child = spawn(electron, [join(PACKAGE_ROOT, 'scripts', 'probe-main.cjs'), `--url=${url}`], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  child.stdout.on('data', (chunk) => process.stdout.write(chunk))

  // Let the window boot, load the sprite, and connect to the SSE stream.
  await new Promise(resolve => setTimeout(resolve, 6_000))

  console.log('=== TRIGGER: balloon with choices ===')
  viewer.broadcast('clippy', {
    type: 'balloon',
    to: 'clippy',
    text: 'It looks like you are debugging the window. Would you like help turning this into a spreadsheet?',
    choices: ['Yes', 'No', 'Not now'],
  })

  // Three seconds later a buddy lands its own window and talks — the
  // "other buddies freeze too" half of the report.
  await new Promise(resolve => setTimeout(resolve, 3_000))
  console.log('=== TRIGGER: buddy talks ===')
  viewer.showCameo('bonzi', 'It looks like you are taking advice from a paperclip. Would you like help getting a real assistant?', true, ['Yes', 'No'])

  // Sample for ten seconds: the loop should visibly flood setBounds and walk x.
  await new Promise(resolve => setTimeout(resolve, 10_000))

  console.log('=== done; closing ===')
  viewer.dispose()
  process.exit(0)
}

void main()