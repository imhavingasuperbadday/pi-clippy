/** ASCII Clippy frames and speech balloon rendering for the pi TUI.
 * The original dsh-clippy drives the clippyjs DOM sprite atlas; pi has no
 * browser, so this is an original monospace adaptation of the classic
 * paperclip-with-a-face silhouette. Microsoft retains the character artwork
 * and brand; see THIRD_PARTY_NOTICES.md.
 */

export type ClippyState = 'idle' | 'blink' | 'thinking' | 'writing' | 'searching' | 'celebrate' | 'alert' | 'flourish'

export interface Animation {
  readonly frames: readonly (readonly string[])[]
  /** Interval between frames; undefined for static (single-frame) states. */
  readonly intervalMs?: number
}

const clippyIdle: readonly string[] = [
  '    .-~~~-.',
  '   /  o o  \\',
  '  |    __   |',
  '  |  ( o )  |',
  '   \\  \\_/  /',
  '    |     |',
  '    |  |  |',
  '    |__|__|',
]

const clippyBlink: readonly string[] = [
  '    .-~~~-.',
  '   /  - -  \\',
  '  |    __   |',
  '  |  ( o )  |',
  '   \\  \\_/  /',
  '    |     |',
  '    |  |  |',
  '    |__|__|',
]

const clippyThinking: readonly string[] = [
  '    .-~~~-.',
  '   /  ^ ^  \\',
  '  |    __   |',
  '  |  ( · )  |',
  '   \\  \\_/  /',
  '    |     |',
  '    |  |  |',
  '    |__|__|',
]

const clippyWriting: readonly string[] = [
  '    .-~~~-.',
  '   /  o o  \\',
  '  |    __   |',
  '  |  ( O )  |',
  '   \\  \\_/  /',
  '    |     |',
  '    |  |  |',
  '    |__|__|',
]

const clippySearching: readonly string[] = [
  '    .-~~~-.',
  '   /  > <  \\',
  '  |    __   |',
  '  |  ( o )  |',
  '   \\  \\_/  /',
  '    |     |',
  '    |  |  |',
  '    |__|__|',
]

const clippyCelebrate: readonly string[] = [
  '     \\o/',
  '    .-~~~-.',
  '   /  ^ ^  \\',
  '  |    __   |',
  '  |  ( O )  |',
  '   \\  \\_/  /',
  '    |     |',
  '    |  |  |',
  '    |__|__|',
]

const clippyAlert: readonly string[] = [
  '    .-~~~-.',
  '   /  O O  \\',
  '  |    __   |',
  '  |  ( ! )  |',
  '   \\  \\_/  /',
  '    |     |',
  '    |  |  |',
  '    |__|__|',
]

/** Frame shifted down one row: a visible bounce for looping states. */
function shifted(frame: readonly string[]): readonly string[] {
  return ['', ...frame.slice(0, -1)]
}

export const ANIMATIONS: Record<ClippyState, Animation> = {
  idle: { frames: [clippyIdle] },
  blink: { frames: [clippyBlink] },
  thinking: { frames: [clippyThinking, shifted(clippyThinking)], intervalMs: 700 },
  writing: { frames: [clippyWriting, shifted(clippyWriting)], intervalMs: 450 },
  searching: { frames: [clippySearching, shifted(clippySearching)], intervalMs: 350 },
  celebrate: { frames: [clippyCelebrate, shifted(clippyCelebrate)], intervalMs: 250 },
  alert: { frames: [clippyAlert, shifted(clippyAlert)], intervalMs: 350 },
  flourish: { frames: [clippyCelebrate, shifted(clippyCelebrate)], intervalMs: 400 },
}

/** Wrap balloon text into a bubble with a stem pointing at Clippy's head. */
export function balloonLines(text: string, maxWidth = 38): string[] {
  const words = text.split(/\s+/).filter(word => word !== '')
  if (words.length === 0) return []
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (current === '') {
      current = word
    } else if (current.length + 1 + word.length <= maxWidth) {
      current += ` ${word}`
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current !== '') lines.push(current)

  const inner = Math.max(...lines.map(line => line.length))
  const top = `  ╭${'─'.repeat(inner + 2)}╮`
  const body = lines.map(line => `  │ ${line.padEnd(inner)} │`)
  const bottom = `  ╰${'─'.repeat(inner + 2)}╯`
  const stem = '     │'
  return [top, ...body, bottom, stem]
}
