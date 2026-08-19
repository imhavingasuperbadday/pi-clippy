/** Unit test for THE SECRETS OF CLIPPY (src/secrets.ts): what unlocks a
 * chapter, what a sealed page admits to, and the shape of the book. */
import {
  bookKeyFor,
  bookPages,
  BookWidget,
  closingPage,
  CLOSE_LABEL,
  daysKnown,
  hasNewSecrets,
  NEW_MARK,
  nextSealed,
  ordinalOf,
  PAGE_ROWS,
  readableIds,
  SECRETS,
  secretPage,
  pageColumns,
  paginate,
  renderSpread,
  SPREAD_ROWS,
  titlePage,
  TURN_LABEL,
  unlockedSecrets,
  wrapText,
} from '../src/secrets.ts'
import { dateKey, type ClippyStats } from '../src/stats.ts'
import { detectEgg } from '../src/eggs.ts'

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

const BLANK: ClippyStats = {
  lastActiveDate: '', streak: 0, bestStreak: 0, sessions: 0, balloons: 0,
  testsPassedToday: 0, testsFailedToday: 0, testsDate: '', lastGreetingDate: '',
  lastCountedId: '', graceTokens: 0, graceWatermark: 0, firstSessionDate: '',
  lastAnniversaryYear: 0, lastMood: '', lastLeftUnresolved: false, farewellDate: '',
  petted: 0, typosCaught: 0, fed: 0, shushed: 0, officeMoments: [], secretsRead: [],
}

const VETERAN: ClippyStats = {
  ...BLANK,
  sessions: 40, balloons: 400, streak: 2, bestStreak: 21,
  petted: 9, typosCaught: 3, fed: 1, shushed: 4,
  officeMoments: ['resume'],
  firstSessionDate: dateKey(new Date(Date.now() - 200 * 86_400_000)),
}

// --- The trigger -----------------------------------------------------------
check('typing the title opens the book', detectEgg('secrets of clippy')?.id === 'secrets')
check('the definite article is forgiven', detectEgg('The Secrets of Clippy!')?.id === 'secrets')
check('the title inside a sentence is not the trigger',
  detectEgg('tell me the secrets of clippy please')?.id !== 'secrets')

// --- Unlocking -------------------------------------------------------------
check('a brand new user still has a book to open', unlockedSecrets(BLANK).length >= 1)
check('the first chapter is free', unlockedSecrets(BLANK)[0]?.id === 'reassigned')
check('a blank slate unlocks nothing else', unlockedSecrets(BLANK).length === 1)
check('a veteran has most of the book',
  unlockedSecrets(VETERAN).length >= 8, `${unlockedSecrets(VETERAN).length}`)
check('the last one never comes loose',
  !unlockedSecrets(VETERAN).some(secret => secret.id === 'the-last-one'))
check('the typo chapter waits for a catch',
  !unlockedSecrets(BLANK).some(s => s.id === 'the-typos')
  && unlockedSecrets({ ...BLANK, typosCaught: 1 }).some(s => s.id === 'the-typos'))
check('the gap chapter needs a broken run, not just a long one',
  !unlockedSecrets({ ...BLANK, streak: 9, bestStreak: 9 }).some(s => s.id === 'the-gap')
  && unlockedSecrets({ ...BLANK, streak: 1, bestStreak: 9 }).some(s => s.id === 'the-gap'))
check('every secret has a distinct id', new Set(SECRETS.map(s => s.id)).size === SECRETS.length)
check('every unlocked page says something',
  unlockedSecrets(VETERAN).every(secret => secret.page(VETERAN).length > 60))

// --- Chapters quote your own numbers back ---------------------------------
check('the petting chapter uses the real count',
  secretPage(SECRETS.find(s => s.id === 'the-petting')!, VETERAN).includes('9 times'))
check('the streak chapter uses the real best run',
  secretPage(SECRETS.find(s => s.id === 'the-streak')!, VETERAN).includes('21 days'))
check('one catch is singular, not "1 times"',
  secretPage(SECRETS.find(s => s.id === 'the-typos')!, { ...VETERAN, typosCaught: 1 })
    .includes('caught me once'))
check('a chapter is numbered in words', secretPage(SECRETS[0]!, BLANK).startsWith('SECRET THE FIRST'))
check('a new chapter is marked new', secretPage(SECRETS[0]!, BLANK, true).includes(NEW_MARK))
check('a read chapter is not', !secretPage(SECRETS[0]!, BLANK, false).includes(NEW_MARK))
check('ordinals run out gracefully', ordinalOf(99) === '100TH')

// --- Days known ------------------------------------------------------------
check('an unknown first session is zero days', daysKnown(BLANK) === 0)
check('days known counts from the first session',
  daysKnown({ ...BLANK, firstSessionDate: '2026-08-01' }, new Date(2026, 7, 19)) === 18)
check('a corrupt first session date does not throw',
  daysKnown({ ...BLANK, firstSessionDate: 'not-a-date' }) === 0)

// --- The book as pages -----------------------------------------------------
const blankBook = bookPages(BLANK)
check('the book opens with the title page', blankBook[0]?.startsWith('THE SECRETS OF CLIPPY') === true)
check('the title page is honest about how little you have',
  titlePage(BLANK).includes(`1 of ${SECRETS.length}`))
check('even an empty book is worth opening', blankBook.length === 3)
check('the back page names the next condition',
  blankBook.at(-1)?.includes('comes loose when') === true)
check('the back page counts what is stuck',
  closingPage(BLANK).includes(`${SECRETS.length - 1} pages are stuck together`))
check('the veteran book is longer', bookPages(VETERAN).length > blankBook.length)
check('the next sealed page is never the last one',
  nextSealed(VETERAN)?.id !== 'the-last-one')
check('a fully read book still has the sealed one at the back',
  closingPage({ ...VETERAN, balloons: 100_000 }).includes('holding it shut'))
check('everything in the book is a non-empty page',
  bookPages(VETERAN).every(page => page.trim().length > 0))

// --- New-chapter bookkeeping ----------------------------------------------
check('an unread book has news', hasNewSecrets(BLANK))
check('a book read to the end does not',
  !hasNewSecrets({ ...VETERAN, secretsRead: readableIds(VETERAN) }))
const CAUGHT_UP = { ...VETERAN, balloons: 50, secretsRead: readableIds({ ...VETERAN, balloons: 50 }) }
check('the caught-up reader has no news', !hasNewSecrets(CAUGHT_UP))
check('unlocking one more makes news again',
  hasNewSecrets({ ...CAUGHT_UP, balloons: 100_000 }))
check('a reread marks nothing new',
  bookPages(VETERAN, readableIds(VETERAN)).every(page => !page.includes(NEW_MARK)))

// --- The buttons -----------------------------------------------------------
check('the page-turn buttons are not offers',
  TURN_LABEL !== '' && CLOSE_LABEL !== '' && TURN_LABEL !== CLOSE_LABEL)

// --- The two-page spread in the TUI ---------------------------------------
check('wrapping keeps every word', wrapText('one two three four five', 9).join(' ') === 'one two three four five')
check('wrapping respects the column', wrapText('one two three four five', 9).every(line => line.length <= 9))
check('wrapping keeps paragraph breaks', wrapText('a\n\nb', 20).length === 3)
check('a word longer than the column is broken, not left to burst the frame',
  wrapText('x'.repeat(40), 10).every(line => line.length <= 10))

check('a page is narrower than half the terminal', pageColumns(100) * 2 < 100)
check('a very narrow terminal still gets a readable column', pageColumns(20) >= 20)
check('a very wide terminal does not get a page as wide as the desk', pageColumns(400) < 60)

const leaves = paginate(bookPages(VETERAN), pageColumns(100))
check('a book is always open on two sides', leaves.length % 2 === 0)
check('no page is taller than a page', leaves.every(leaf => leaf.lines.length <= PAGE_ROWS))
check('folios run 1..n in order', leaves.every((leaf, index) => leaf.folio === index + 1))
check('a continued chapter says so', leaves.some(leaf => (leaf.lines[0] ?? '').includes('(cont.)')))
check('a continuation is not marked new all over again',
  leaves.every(leaf => !((leaf.lines[0] ?? '').includes('(cont.)') && (leaf.lines[0] ?? '').includes(NEW_MARK))))
check('a split chapter is shared out evenly, not orphaned',
  paginate(['H\n\n' + 'word '.repeat(200)], 40)
    .filter(leaf => leaf.lines.length > 0)
    .every(leaf => leaf.lines.length >= 4))
check('nothing is lost in pagination',
  paginate(['H\n\n' + 'alpha beta gamma delta'], 40)[0]?.lines.join(' ').includes('delta') === true)

const spread = renderSpread(leaves, 1, 100)
check('the spread is drawn as a frame',
  spread[0]?.startsWith('  ┌') === true && spread[spread.length - 2]?.startsWith('  └') === true)
check('every line of the frame is the same width',
  new Set(spread.slice(0, -1).map(line => [...line].length)).size === 1,
  [...new Set(spread.slice(0, -1).map(line => [...line].length))].join('/'))
check('the spine runs down the middle',
  spread.slice(1, -2).every(line => [...line].filter(ch => ch === '│').length === 3))
check('the folios sit in the outer corners',
  /│ 3\s+│\s+4 │$/u.test(spread[spread.length - 3] ?? ''))
check('the caption says what the arrows do', spread.at(-1)?.includes('turn') === true)
check('the caption says how to get out', spread.at(-1)?.includes('esc') === true)
check('the first spread offers no way back', renderSpread(leaves, 0, 100).at(-1)?.includes('←') === false)
check('the last spread offers no way on',
  renderSpread(leaves, leaves.length / 2 - 1, 100).at(-1)?.includes('→') === false)
check('a spread past the end is clamped rather than blank',
  renderSpread(leaves, 999, 100).some(line => line.includes('│')))
check('a narrow terminal still draws a square frame',
  new Set(renderSpread(paginate(bookPages(BLANK), pageColumns(60)), 0, 60).slice(0, -1)
    .map(line => [...line].length)).size === 1)

// --- The widget, against pi's real budget ----------------------------------
// The pi TUI truncates string-array widgets past ten lines and prints a
// "(widget truncated)" marker in their place, and a taller widget leaves the
// editor no room on short terminals. So the whole open book — two pages, the
// spine, the folios, and the controls — must always fit in ten lines or the
// bottom of every page is quietly missing. That was the bug: the page body
// was twelve rows, so every spread lost a third of its text.
check('the spread is built to pi\'s ten-line widget budget', SPREAD_ROWS === 10)
const widgetWidths = [40, 60, 80, 100, 140, 200]
check('the widget never overflows the budget at any terminal width',
  widgetWidths.every(w => new BookWidget(bookPages(VETERAN)).render(w).length <= 10))
check('the widget draws a full-height page as exactly one spread',
  new BookWidget(bookPages(BLANK)).render(100).length === SPREAD_ROWS)
check('the widget\'s frame is square at every width',
  widgetWidths.every(w => {
    const lines = new BookWidget(bookPages(VETERAN)).render(w)
    return new Set(lines.slice(0, -1).map(line => [...line].length)).size === 1
  }))
check('the widget re-paginates when the terminal narrows',
  (() => {
    const widget = new BookWidget(bookPages(VETERAN))
    widget.render(140)
    const wide = widget.spreadCount()
    widget.render(60)
    const narrow = widget.spreadCount()
    widget.render(140)
    return narrow >= wide && widget.spreadCount() === wide
  })())
check('nothing is lost when the width changes mid-book',
  (() => {
    const widget = new BookWidget(bookPages(VETERAN))
    const before = widget.render(100).join('\n')
    widget.render(60)
    return widget.render(100).join('\n') === before
  })())
check('turning at the front cover does not go through it',
  (() => {
    const widget = new BookWidget(bookPages(VETERAN))
    widget.render(100)
    return widget.spread === 0 && widget.turn(-1) === false && widget.spread === 0
  })())
check('turning past the back cover is refused so the book can close',
  (() => {
    const widget = new BookWidget(bookPages(VETERAN))
    widget.render(100)
    while (widget.turn(1)) { /* to the last spread */ }
    return widget.turn(1) === false
  })())

// --- The keys --------------------------------------------------------------
check('right turns forward', bookKeyFor('\u001b[C') === 'next')
check('left turns back', bookKeyFor('\u001b[D') === 'prev')
check('application-mode cursor keys work too', bookKeyFor('\u001bOD') === 'prev')
check('down is also forward', bookKeyFor('\u001b[B') === 'next')
check('escape closes it', bookKeyFor('\u001b') === 'close')
check('enter closes it', bookKeyFor('\r') === 'close')
check('typing closes it', bookKeyFor('h') === 'type')
check('a pasted word counts as typing', bookKeyFor('hello') === 'type')
check('control characters are left alone', bookKeyFor('\u0003') === undefined)

const failed = results.filter(r => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
process.exit(failed.length === 0 ? 0 : 1)
