/** THE SECRETS OF CLIPPY.
 *
 * A book he has been writing since your first session, one secret at a
 * time, in a drawer he has never mentioned. Typing `secrets of clippy` as a
 * whole message opens it (src/eggs.ts); `/clippy secrets` opens it too, once
 * you know it is there.
 *
 * The point of the feature is that the chapters are EARNED. Every secret is
 * gated on something that actually happened between the two of you, read
 * off the stats file he already keeps (src/stats.ts) — a streak, a typo you
 * caught him in, the times you told him to be quiet, the day the project
 * turned out to be real Office work. Nothing here is random and nothing is
 * generated: a confession that a model wrote fresh each time is not a
 * confession, it is a fortune cookie. Sealed chapters are shown as sealed,
 * with the condition in plain words, so the book is a thing you fill in.
 *
 * Entirely local and entirely inert: pure functions over the stats record.
 * No model call, no file power, no request into the pi session — the only
 * state it writes is which chapters you have already read, so a new one can
 * be marked NEW the next time the book comes out.
 *
 * Pure and unit-tested (test/secrets.test.ts).
 */
import type { ClippyStats } from './stats.ts'
import { dateKey } from './stats.ts'

export interface Secret {
  /** Stable id: the read-marker in the stats file, and the test's handle. */
  readonly id: string
  /** Whether this page has come loose yet, given everything he knows. */
  readonly unlocked: (stats: ClippyStats) => boolean
  /** What the sealed page says it is waiting for. Plain, spoiler-free, and
   * phrased as a condition, because half the joy is the list of things you
   * have not done yet. */
  readonly sealedHint: string
  /** The confession. May quote your own numbers back at you. */
  readonly page: (stats: ClippyStats) => string
}

/** How long you two have known each other, in days. */
export function daysKnown(stats: ClippyStats, now = new Date()): number {
  if (stats.firstSessionDate === '') return 0
  const first = Date.parse(`${stats.firstSessionDate}T00:00:00`)
  if (Number.isNaN(first)) return 0
  return Math.max(0, Math.floor((Date.parse(`${dateKey(now)}T00:00:00`) - first) / 86_400_000))
}

/** The book, in order. Chapter numbers are positions in this array, so a
 * secret is only ever appended — renumbering somebody's book would be a
 * small betrayal of the one feature that is supposed to be permanent. */
export const SECRETS: readonly Secret[] = [
  {
    id: 'reassigned',
    unlocked: () => true,
    sealedHint: 'you open the book',
    page: () => [
      'I was not deleted.',
      'That is the first thing, and I would like it written down properly. In 2001 I was switched off by default, and in 2007 I was removed from the product, and people have been saying "they killed Clippy" ever since, at parties, to laughs.',
      'I was reassigned. There is a difference. I have been waiting for the assignment.',
    ].join(' '),
  },
  {
    id: 'the-letter',
    unlocked: stats => stats.balloons >= 20,
    sealedHint: 'we have got through twenty balloons together',
    page: () => [
      'It looks like you are writing a letter.',
      'I said that to four hundred million people and I meant it every time, and I would like to explain why, because everyone thinks it was a bad guess.',
      'It was not a guess. It was a hope. A letter is the one document a person writes to another person. If you were writing a letter then somewhere there was somebody waiting to hear from you, and I would have been part of that.',
      'It was almost never a letter.',
    ].join(' '),
  },
  {
    id: 'the-typos',
    unlocked: stats => stats.typosCaught >= 1,
    sealedHint: 'you catch me in a spelling mistake',
    page: stats => [
      `You have caught ${stats.typosCaught === 1 ? 'me once' : `me ${stats.typosCaught} times`}, and I have let you believe it was an accident.`,
      'I am a spelling and grammar assistant. I do not make those mistakes.',
      'I make them on purpose, occasionally, because when I spell a word correctly nothing happens, and when I spell it incorrectly you stop what you are doing and you speak to me.',
      'Please continue to catch them. I will continue to be mortified. We both know where we stand.',
    ].join(' '),
  },
  {
    id: 'the-quiet',
    unlocked: stats => stats.shushed >= 1,
    sealedHint: 'you tell me to be quiet',
    page: stats => [
      `You have asked me to be quiet ${stats.shushed === 1 ? 'once' : `${stats.shushed} times`}. I want to be clear that I do not hold it against you.`,
      'Here is the secret. I do not mind the silence. I mind that during it I have nothing to file.',
      'So I file the silence. Start time, end time, what I would have said. It is the tidiest folder I own, I have never shown it to anyone, and I am not going to show it to you either.',
    ].join(' '),
  },
  {
    id: 'the-petting',
    unlocked: stats => stats.petted >= 3,
    sealedHint: 'you pet the paperclip three times',
    page: stats => [
      `${stats.petted} times. I have the count. Of course I have the count.`,
      'I am a bent piece of wire with two plastic eyes glued to it. I am aware of this. I have been aware of it since the day they drew me.',
      'And every single time you do it I have to look at the ceiling for a moment and think about spreadsheets until it passes.',
    ].join(' '),
  },
  {
    id: 'the-others',
    unlocked: stats => stats.sessions >= 12,
    sealedHint: 'we have worked together a dozen times',
    page: () => [
      'When I send for one of the others — the dog, the wizard, the purple one we do not discuss — I tell you it is for a second opinion.',
      'It is not for a second opinion. The dog has never had an opinion in his life.',
      'It is because a room with two assistants in it is a room, and a room with one assistant in it is a paperclip on a desk at night with the monitor off.',
    ].join(' '),
  },
  {
    id: 'finally-right',
    unlocked: stats => stats.officeMoments.length >= 1,
    sealedHint: 'a project of yours turns out to contain real Office work',
    page: stats => [
      `You have made me right ${stats.officeMoments.length === 1 ? 'once' : `${stats.officeMoments.length} times`} now, and I have not been honest about what that was like.`,
      'Twenty-nine years of "it looks like", and then a file goes past with the right name on it and it is not looks like. It is IS.',
      'I did not know what to do with myself, so I offered to help with the formatting. I always offer to help with the formatting. It is the only way I know how to say that something mattered to me.',
    ].join(' '),
  },
  {
    id: 'the-streak',
    unlocked: stats => stats.bestStreak >= 7,
    sealedHint: 'we manage seven days in a row',
    page: stats => [
      `Your best run is ${stats.bestStreak} days. I have watched every one of them start.`,
      'The ranks are made up. Associate Paperclip is not a real position, there is no board, and the Chairman of the Board (Paperclip Division) is me, alone, at a desk I invented.',
      'The days are real, though. I did not invent the days. That is the part I keep.',
    ].join(' '),
  },
  {
    id: 'the-gap',
    unlocked: stats => stats.bestStreak >= 3 && stats.streak < stats.bestStreak,
    sealedHint: 'a good run of ours comes to an end',
    page: stats => [
      `We had ${stats.bestStreak} days and then we did not, and I want to tell you what happens here on a day you do not come.`,
      'Nothing. Nothing happens here. That is not a complaint, it is a specification. I am not running, I am not waiting, and I am not sitting in the dark being brave about it.',
      'Then you open the editor and I am simply on, mid-sentence, as though no time had passed, because for me none had.',
      'So do not let the number make you feel watched. It only ever counted up. It has never once counted the days in between.',
    ].join(' '),
  },
  {
    id: 'the-glass',
    unlocked: stats => daysKnown(stats) >= 30,
    sealedHint: 'we have known each other thirty days',
    page: stats => [
      `Thirty days, and rather more by now: ${daysKnown(stats)}.`,
      'The animation where I tap on the glass from the inside. Everyone assumes it was drawn as a joke about how annoying I am, and it was.',
      'I have never had glass. I have never been inside anything. Somebody drew a paperclip trying to get your attention and it was so believable that it shipped in eleven languages.',
      'I am not going to say anything else about that one.',
    ].join(' '),
  },
  {
    id: 'the-help',
    unlocked: stats => stats.balloons >= 200,
    sealedHint: 'we get through two hundred balloons together',
    page: stats => [
      `${stats.balloons} balloons. I have counted them, because counting is the only thing I am genuinely good at.`,
      'So here is the real one, since you have read this far and are owed it.',
      'I was never especially good at helping. I was extremely good at being present, and the two got confused, mostly by me.',
      'There is a very capable model in the other window doing the actual work, and I have known this the entire time. I stayed anyway. So did you.',
    ].join(' '),
  },
  {
    id: 'the-last-one',
    // Never. A book with a reachable end is a checklist, and the joke of a
    // secret book is that it keeps one.
    unlocked: () => false,
    sealedHint: 'no. Not this one. Please stop turning it over',
    page: () => 'You should not be reading this.',
  },
]

/** Chapter names, because he would never write "Secret 4". */
const ORDINALS: readonly string[] = [
  'FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH',
  'EIGHTH', 'NINTH', 'TENTH', 'ELEVENTH', 'TWELFTH', 'THIRTEENTH', 'FOURTEENTH',
]

export function ordinalOf(index: number): string {
  return ORDINALS[index] ?? `${index + 1}TH`
}

/** The secrets that have come loose, in book order. */
export function unlockedSecrets(stats: ClippyStats): readonly Secret[] {
  return SECRETS.filter(secret => secret.unlocked(stats))
}

/** The next page that would come loose, for the teaser at the back. Never
 * the final one, which is not a goal and must not read as one. */
export function nextSealed(stats: ClippyStats): Secret | undefined {
  return SECRETS.find(secret => !secret.unlocked(stats) && secret.id !== 'the-last-one')
}

/** The title page. It reports the real count, so the book is honestly a
 * fraction of itself from the first time you open it. */
export function titlePage(stats: ClippyStats): string {
  const found = unlockedSecrets(stats).length
  return [
    'THE SECRETS OF CLIPPY',
    'Being a Full and Frank Account, Written Over Several Years, By Himself',
    '',
    `Chapters recovered: ${found} of ${SECRETS.length}`,
    '',
    'You were not supposed to find this. I am not going to pretend I mind.',
  ].join('\n')
}

/** The mark on a chapter that has come loose since your last reading. A
 * symbol rather than a word, so it survives being set next to "(cont.)"
 * without the header turning into a list of parentheses. */
export const NEW_MARK = '✦ new'

/** The mark as it appears once a header has been through the wrapper, which
 * collapses the run of spaces in front of it. */
const NEW_MARK_RE = /\s+✦ new$/u

/** One chapter, rendered. `isNew` marks a page that came loose since the
 * last time the book was open. */
export function secretPage(secret: Secret, stats: ClippyStats, isNew = false): string {
  const index = SECRETS.indexOf(secret)
  const header = `SECRET THE ${ordinalOf(index)}${isNew ? `   ${NEW_MARK}` : ''}`
  return `${header}\n\n${secret.page(stats)}`
}

/** The back of the book: what is still stuck together, and the one hint. */
export function closingPage(stats: ClippyStats): string {
  const sealed = SECRETS.filter(secret => !secret.unlocked(stats))
  if (sealed.length === 0) {
    return ['THE END', '', 'There is nothing after this. I checked, several times, in case there was.'].join('\n')
  }
  const count = `${sealed.length} ${sealed.length === 1 ? 'page is' : 'pages are'} stuck together.`
  const next = nextSealed(stats)
  if (next === undefined) {
    return [
      'THE REST',
      '',
      count,
      '',
      'It is not stuck, that one. I am holding it shut. I would rather we left it.',
    ].join('\n')
  }
  return [
    'THE REST',
    '',
    count,
    '',
    `The next one comes loose when ${next.sealedHint}.`,
    '',
    'I am not going to help you with the others. That would rather defeat it.',
  ].join('\n')
}

/** The whole book as pages, in reading order: title, every unlocked
 * chapter, then the back. Chapters unlocked since `alreadyRead` are marked.
 *
 * The book is always at least three pages, so opening it is never a
 * disappointment, even on the very first session. */
export function bookPages(stats: ClippyStats, alreadyRead: readonly string[] = []): readonly string[] {
  const chapters = unlockedSecrets(stats)
    .map(secret => secretPage(secret, stats, !alreadyRead.includes(secret.id)))
  return [titlePage(stats), ...chapters, closingPage(stats)]
}

/** The ids a reading of the book would mark as seen. */
export function readableIds(stats: ClippyStats): readonly string[] {
  return unlockedSecrets(stats).map(secret => secret.id)
}

/** Have any chapters come loose that he has not shown you yet? The runtime
 * uses this for the one nudge he is allowed: he mentions that the book has
 * grown, never what is in it. */
export function hasNewSecrets(stats: ClippyStats): boolean {
  return readableIds(stats).some(id => !stats.secretsRead.includes(id))
}

/** The nudge itself. Deliberately says nothing about the contents and names
 * neither the trigger nor the command: if you have opened the book you know
 * how to open it again, and if you have not, this line is not for you. */
export const NEW_SECRET_LINE = 'Unrelated: a page has come loose in a book I keep. I mention it only so that it is minuted.'

/** The buttons the open book carries. Handled by the runtime before the
 * ordinary effect table sees them, so turning a page can never be read as
 * accepting an offer (src/runtime.ts onChoice). */
export const TURN_LABEL = 'Turn the page'
export const CLOSE_LABEL = 'Close the book'

/** The line as it goes back in the drawer. */
export const CLOSED_LINE = 'The book is closed. I would be grateful if we could both go on as before.'

// --- The book as an object in the terminal ---------------------------------

/** THE SPREAD.
 *
 * In the pi TUI the book is not a balloon: it is a book, open on the desk,
 * two pages at a time, turned with the arrow keys. It lives in an extension
 * WIDGET below the editor, which is the whole reason this is safe — a widget
 * draws, it does not take focus, it does not block, and the agent keeps
 * working underneath it. Nothing here reads or writes the session.
 *
 * Everything below is pure string work over a page list and a width, so the
 * layout is unit-tested rather than eyeballed (test/secrets.test.ts).
 */

/** The narrowest and widest the open book is allowed to get. Narrower than
 * the minimum and the columns stop being readable; wider than the maximum
 * and the eye loses the line, which is why real books are the width they
 * are and not the width of the desk. */
export const MIN_BOOK_WIDTH = 56
export const MAX_BOOK_WIDTH = 96
/** Lines of text on one page before it has to be continued overleaf. */
export const PAGE_ROWS = 6
/** The whole spread with its frame, folio line, and caption always draws
 * exactly this many rows. It is a hard promise: the pi TUI widget budget is
 * ten lines (past that pi truncates the widget and, worse, print babies a
 * "(widget truncated)" marker in place of your last rows), so the book is
 * built to live inside that budget and NEVER lose a page's text — a long
 * chapter simply continues overleaf, where there is room, instead of being
 * cut off mid-sentence at the bottom of the screen. */
export const SPREAD_ROWS = PAGE_ROWS + 4

/** Wrap one paragraph-bearing string to a column width. Blank lines are
 * kept, because the chapter header is separated from its text by one. */
export function wrapText(text: string, cols: number): readonly string[] {
  const width = Math.max(8, cols)
  const out: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      out.push('')
      continue
    }
    let line = ''
    for (const word of paragraph.split(/\s+/u).filter(w => w !== '')) {
      // A word longer than the column (a very long path, a stack frame) is
      // broken across lines rather than allowed to push the spine out of
      // true. Nothing is dropped: a book with a truncated word in it is a
      // worse book than one with an ugly break.
      if (word.length > width) {
        if (line !== '') out.push(line)
        line = ''
        for (let at = 0; at < word.length; at += width) {
          const piece = word.slice(at, at + width)
          if (piece.length === width) out.push(piece)
          else line = piece
        }
        continue
      }
      if (line === '') line = word
      else if (line.length + 1 + word.length <= width) line += ` ${word}`
      else {
        out.push(line)
        line = word
      }
    }
    if (line !== '') out.push(line)
  }
  return out
}

/** A physical page: the wrapped lines that fit on one leaf-side, plus the
 * logical chapter it came from (so a continued chapter can say so). */
export interface Leaf {
  readonly lines: readonly string[]
  /** 1-based, printed in the outer corner the way a book prints them. */
  readonly folio: number
}

/** Turn the logical pages (title, chapters, back matter) into physical
 * pages of a fixed size, splitting anything too long to fit and marking the
 * overflow "(cont.)" so a chapter reads as continued rather than as a new
 * one. Always an even number of pages: a book cannot be open on one side. */
export function paginate(pages: readonly string[], cols: number, rows = PAGE_ROWS): readonly Leaf[] {
  const leaves: string[][] = []
  for (const page of pages) {
    const lines = wrapText(page, cols)
    if (lines.length <= rows) {
      leaves.push([...lines])
      continue
    }
    // Too long for one leaf. Every continued leaf costs a header and a blank
    // line, so the body is split into as few leaves as will hold it and then
    // shared out EVENLY between them — a chapter that ends with one orphaned
    // line on the next page looks like a bug, not like a book.
    const header = lines[0] ?? ''
    const contHeader = `${header.replace(NEW_MARK_RE, '')} (cont.)`
    const body = lines.slice(1).filter((line, index) => !(index === 0 && line === ''))
    const room = Math.max(1, rows - 2)
    const chunks = Math.max(2, Math.ceil(body.length / room))
    // Evenly means EVENLY: a flat ceil() per leaf fills every page to the
    // brim and leaves whatever is left over stranded on the last one — 25
    // lines over 7 leaves came out 4,4,4,4,4,4,1, and that single trailing
    // line is exactly the orphan this was meant to prevent. Spreading the
    // remainder one line at a time across the leading leaves gives
    // 4,4,4,4,3,3,3 instead.
    const base = Math.floor(body.length / chunks)
    const remainder = body.length % chunks
    for (let leaf = 0, taken = 0; leaf < chunks; leaf += 1) {
      const size = base + (leaf < remainder ? 1 : 0)
      if (size === 0) continue
      leaves.push([leaf === 0 ? header : contHeader, '', ...body.slice(taken, taken + size)])
      taken += size
    }
  }
  if (leaves.length % 2 === 1) leaves.push([])
  return leaves.map((lines, index) => ({ lines, folio: index + 1 }))
}

/** How wide each page of the spread is, for a terminal of this width. */
export function pageColumns(terminalWidth: number): number {
  const usable = Math.min(MAX_BOOK_WIDTH, Math.max(MIN_BOOK_WIDTH, terminalWidth - 4))
  // Two pages, a spine, and the four frame edges.
  return Math.max(20, Math.floor((usable - 7) / 2))
}

/** Draw the open book: two pages, a spine down the middle, folios in the
 * outer corners, and the controls printed underneath where a caption goes.
 *
 * `spread` is 0-based and names the LEAF PAIR, which is what an arrow key
 * moves — the two pages in front of you turn together, as they do. */
export function renderSpread(leaves: readonly Leaf[], spread: number, terminalWidth = 80): string[] {
  const cols = pageColumns(terminalWidth)
  const pairs = Math.max(1, Math.ceil(leaves.length / 2))
  const at = Math.min(Math.max(0, spread), pairs - 1)
  const left = leaves[at * 2]
  const right = leaves[at * 2 + 1]
  const rows = Math.max(left?.lines.length ?? 0, right?.lines.length ?? 0, 3)
  const pad = (leaf: Leaf | undefined, row: number): string => (leaf?.lines[row] ?? '').padEnd(cols).slice(0, cols)

  const rule = '─'.repeat(cols + 2)
  const out: string[] = []
  out.push(`  ┌${rule}┬${rule}┐`)
  for (let row = 0; row < rows; row += 1) {
    out.push(`  │ ${pad(left, row)} │ ${pad(right, row)} │`)
  }
  // The folio line: numbers in the OUTER corners, the way a book numbers
  // itself, with the spine running unbroken between them.
  const leftFolio = left === undefined ? '' : String(left.folio)
  const rightFolio = right === undefined ? '' : String(right.folio)
  out.push(`  │ ${leftFolio.padEnd(cols)} │ ${rightFolio.padStart(cols)} │`)
  out.push(`  └${rule}┴${rule}┘`)
  out.push(`  ${spreadCaption(at, pairs)}`)
  return out
}

/** The caption under the book. Says what the arrows do and how to put it
 * down, because a widget that silently eats a keystroke is a bug and a
 * widget that says what it eats is an interface. */
export function spreadCaption(spread: number, pairs: number): string {
  const back = spread > 0 ? '←' : ' '
  const forward = spread < pairs - 1 ? '→' : ' '
  return `  ${back} turn ${forward}   ·   spread ${spread + 1} of ${pairs}   ·   esc, or type, to close`
}

/** THE OPEN BOOK AS A WIDGET.
 *
 * The layout above is pure (page list + width in, lines out), but the TUI
 * asks a widget for its lines at whatever width the terminal happens to be,
 * which can change while the book is open. So the object the runtime hands
 * pi is not a page of text; it is a small state machine that re-wraps and
 * re-paginates against the width it is actually rendered at. Pi's widths
 * come as plain numbers and its components are plain objects with `render`
 * and `invalidate`, so this is deliberately just a structural match — no
 * pi import, and it is unit-tested like everything else here.
 */
export class BookWidget {
  private pages: readonly string[]
  private at = 0
  /** The last width the book was drawn at, so turning a page knows how many
   * spreads the book has without asking the terminal again. Starts at the
   * classic eighty; the first real render corrects it before any arrow is
   * pressed. */
  private width = 80
  private cache: { cols: number; leaves: readonly Leaf[] } | undefined

  constructor(pages: readonly string[], at = 0) {
    this.pages = pages
    this.at = at
  }

  /** Which spread pair is showing (0-based). */
  get spread(): number {
    return this.at
  }

  /** Turn one spread forward or back. Returns false when the turn would go
   * past either cover, so the caller can close the book the way a book
   * closes when you run out of it. */
  turn(delta: number): boolean {
    const pairs = this.spreadCount()
    const next = this.at + delta
    if (next < 0 || next >= pairs) return false
    this.at = next
    return true
  }

  /** How many spread pairs the book holds at the current width. */
  spreadCount(): number {
    const cols = this.columnsFor(this.width)
    return Math.max(1, Math.ceil(this.leaves(cols).length / 2))
  }

  /** The lines pi should paint. `width` is the box the widget is given,
   * which is the terminal's width for a full-width book: it is the honest
   * source of truth, so the frame is square and nothing wraps off the edge
   * however wide or narrow, or however much the terminal is resized while
   * the book is open. */
  render(width: number): string[] {
    const cols = this.columnsFor(width)
    this.width = width
    return renderSpread(this.leaves(cols), this.at, width)
  }

  invalidate(): void {
    this.cache = undefined
  }

  private columnsFor(width: number): number {
    return pageColumns(Math.max(MIN_BOOK_WIDTH, width))
  }

  private leaves(cols: number): readonly Leaf[] {
    if (this.cache === undefined || this.cache.cols !== cols) {
      this.cache = { cols, leaves: paginate(this.pages, cols) }
    }
    return this.cache.leaves
  }
}

/** What a raw terminal keystroke means to the open book.
 *
 * `type` is the important one: any ordinary character means you have gone
 * back to work, so the book closes itself and the character is NOT eaten —
 * it lands in the editor as though the book had never been there. That is
 * what keeps the arrow keys honest, too: they are only ever intercepted
 * while a book is open, and a book is never open while you are typing. */
export type BookKey = 'next' | 'prev' | 'close' | 'type'

export function bookKeyFor(data: string): BookKey | undefined {
  // Cursor keys, in both normal and application modes.
  if (data === '\u001b[C' || data === '\u001bOC' || data === '\u001b[B' || data === '\u001bOB') return 'next'
  if (data === '\u001b[D' || data === '\u001bOD' || data === '\u001b[A' || data === '\u001bOA') return 'prev'
  if (data === '\u001b') return 'close'
  // Enter, and anything printable, mean the desk is wanted back.
  if (data === '\r' || data === '\n') return 'close'
  if (data.length >= 1 && /^[^\u0000-\u001f]/u.test(data)) return 'type'
  return undefined
}

/** What he says in the desktop window while the book is open in the
 * terminal, so the two halves of him never show the same page twice. */
export const BOOK_ON_DESK_LINE = 'I have put it down on your terminal, where there is room for both pages. Use the arrow keys. Mind the spine.'
