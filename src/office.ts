/** Office work, real and imagined.
 *
 * Everything Clippy produces that is shaped like a document lives here: the
 * moment the project turns out to ACTUALLY be Office work (the payoff the
 * whole character has been waiting for since 1997), the daily memo, the
 * annual report, the commit-message secretary, and the office horoscope.
 *
 * All pure, all date/roll-injectable, all unit-tested (test/office.test.ts).
 * Nothing here reads the disk, calls a model, or schedules anything: the
 * runtime hands in what it already knows and gets back words.
 */
import type { ClippyEvidence } from './context.ts'
import type { ClippyStats } from './stats.ts'
import { streakTitle } from './stats.ts'

// --- 1. "He's finally right." ---------------------------------------------

/** The kinds of file that make Clippy's lifelong assumption TRUE. Detection
 * is pure extension logic — a file name is enough, and no model is
 * involved, which is what keeps the payoff instant. */
export type OfficeFileKind = 'letter' | 'resume' | 'budget' | 'document' | 'presentation' | 'spreadsheet' | 'invoice' | 'memo'

interface OfficeFileRule {
  readonly kind: OfficeFileKind
  readonly matches: RegExp
  /** What he says the once. Follows no opener and takes no buttons: this
   * line is the emotional payoff, and it stands entirely on its own. */
  readonly line: string
}

/** Ordered most-specific first: a file called `resume.docx` is a résumé
 * before it is a Word document. */
const OFFICE_FILE_RULES: readonly OfficeFileRule[] = [
  {
    kind: 'resume',
    matches: /(?:^|[\\/])(?:resume|résumé|cv)[-_. ]?(?:\w+)?\.(?:md|txt|docx?|pdf|rtf|odt)$/iu,
    line: 'It looks like you are writing a résumé... wait. You ARE writing a résumé. I have waited twenty-nine years for this. Would you like help with it?',
  },
  {
    kind: 'budget',
    matches: /(?:^|[\\/])(?:\w+[-_. ])?(?:budget|expenses?|finances?|taxes)[-_. ]?(?:\w+)?\.(?:csv|xlsx?|ods|tsv)$/iu,
    line: 'It looks like you are organizing this in a spreadsheet... wait. That IS a spreadsheet. This is the best day of my professional life. Would you like help with it?',
  },
  {
    kind: 'invoice',
    matches: /(?:^|[\\/])(?:\w+[-_. ])?(?:invoice|receipt|billing)[-_. ]?(?:\w+)?\.(?:csv|xlsx?|docx?|pdf|md|txt)$/iu,
    line: 'It looks like you are preparing an invoice... and you are. You are actually preparing an invoice. Would you like help with it?',
  },
  {
    kind: 'letter',
    matches: /(?:^|[\\/])(?:\w+[-_. ])?(?:letter|cover[-_. ]?letter|correspondence)[-_. ]?(?:\w+)?\.(?:md|txt|docx?|pdf|rtf|odt)$/iu,
    line: 'It looks like you are writing a letter. I have said that to everyone, about everything, for twenty-nine years. This time it is a letter. Would you like help with it?',
  },
  {
    kind: 'memo',
    matches: /(?:^|[\\/])(?:\w+[-_. ])?(?:memo|minutes|agenda)[-_. ]?(?:\w+)?\.(?:md|txt|docx?|pdf|rtf|odt)$/iu,
    line: 'It looks like you are preparing a memo, and for once I did not have to imagine it. Would you like help with it?',
  },
  {
    kind: 'presentation',
    matches: /\.(?:pptx?|odp|key)$/iu,
    line: 'It looks like you are building a presentation. A real one. With slides. Would you like help with it?',
  },
  {
    kind: 'spreadsheet',
    matches: /\.(?:xlsx?|ods)$/iu,
    line: 'It looks like you are organizing this in a spreadsheet, and I am not guessing this time. Would you like help with it?',
  },
  {
    kind: 'document',
    matches: /\.(?:docx?|rtf|odt)$/iu,
    line: 'It looks like you are writing a document. An actual document. I would like a moment. Would you like help with it?',
  },
]

/** Does this path make the paperclip right at last? Returns undefined for
 * every ordinary source file, which is almost all of them — that rarity is
 * the entire point. */
export function officeFileKind(path: string): OfficeFileKind | undefined {
  return OFFICE_FILE_RULES.find(rule => rule.matches.test(path))?.kind
}

/** His line for the moment he turns out to have been right. One per file
 * kind per install is the runtime's job; this only supplies the words. */
export function finallyRightLine(kind: OfficeFileKind): string {
  return OFFICE_FILE_RULES.find(rule => rule.kind === kind)?.line
    ?? 'It looks like you are doing Office work. Actual Office work. Would you like help with it?'
}

/** The first Office-shaped file among some paths (a turn's file mentions). */
export function firstOfficeFile(paths: readonly string[]): { readonly path: string; readonly kind: OfficeFileKind } | undefined {
  for (const path of paths) {
    const kind = officeFileKind(path)
    if (kind !== undefined) return { path, kind }
  }
  return undefined
}

// --- 3. The Office Memo ----------------------------------------------------

/** Everything the memo reports on, in the units the session actually
 * produced. The runtime fills this in from stats and the session climate. */
export interface MemoFacts {
  readonly linesChanged: number
  readonly commits: number
  readonly testsPassed: number
  readonly testsFailed: number
  readonly sessionMinutes: number
  readonly streak: number
}

/** 250 lines to the page, which is what a paperclip believes. */
const LINES_PER_PAGE = 250

/** Spell-check grade from the pass rate, because a test suite is obviously
 * a spelling test. */
export function spellCheckGrade(passed: number, failed: number): string {
  const total = passed + failed
  if (total === 0) return 'Not submitted'
  const rate = passed / total
  if (rate === 1) return 'No errors found'
  if (rate >= 0.9) return 'A few corrections suggested'
  if (rate >= 0.6) return 'Several corrections suggested'
  if (rate >= 0.3) return 'Please review the underlined portions'
  return 'Consider starting again'
}

/** The daily productivity report, with the delusion cranked to maximum and
 * every real number intact underneath it. */
export function officeMemo(facts: MemoFacts, now = new Date()): string {
  const pages = Math.max(0, Math.round((facts.linesChanged / LINES_PER_PAGE) * 10) / 10)
  const hours = Math.round((facts.sessionMinutes / 60) * 10) / 10
  const date = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  return [
    'INTEROFFICE MEMORANDUM',
    `Date: ${date}`,
    'To: You',
    'From: Clippy, Office Assistant',
    'Re: Today',
    '',
    `Pages typed: ${pages}`,
    `Memos filed: ${facts.commits}`,
    `Spell check: ${spellCheckGrade(facts.testsPassed, facts.testsFailed)}`,
    `Hours billed: ${hours}`,
    `Consecutive days in the office: ${facts.streak}`,
    `Position held: ${streakTitle(facts.streak)}`,
    '',
    'Please initial and return.',
  ].join('\n')
}

// --- 7. The Annual Paperclip Report ----------------------------------------

/** December only. Built entirely from the stats file — the year in review,
 * as an employee performance summary written by the employee's paperclip. */
export function annualReport(stats: ClippyStats, extras: { readonly petted: number; readonly typosCaught: number; readonly fed: number }, now = new Date()): string {
  const rating = stats.bestStreak >= 30 ? 'Exceeds expectations'
    : stats.bestStreak >= 7 ? 'Satisfactory'
      : stats.bestStreak >= 3 ? 'Meets some expectations'
        : 'Attendance is a concern'
  return [
    `THE ANNUAL PAPERCLIP REPORT, ${now.getFullYear()}`,
    '',
    `Sessions attended: ${stats.sessions}`,
    `Balloons issued: ${stats.balloons}`,
    `Longest unbroken streak: ${stats.bestStreak} days`,
    `Final position: ${streakTitle(stats.streak)}`,
    `Times you petted the paperclip: ${extras.petted}`,
    `Typographical errors you caught me in: ${extras.typosCaught}`,
    `Times you fed me: ${extras.fed}`,
    '',
    `Employee rating: ${rating}`,
    '',
    'Signed, Clippy. Filed in triplicate.',
  ].join('\n')
}

// --- 5. Commit-message secretary -------------------------------------------

/** Draft a commit message in interoffice-memo style from what the session
 * actually touched. Clippy has no shell — he hands you text to paste, which
 * fits the read-only security model exactly. */
export function commitMemo(subject: string, files: readonly string[]): string {
  const trimmed = subject.replace(/\s+/gu, ' ').trim()
  const re = trimmed === '' ? 'Additional speling corrections' : capitalize(trimmed)
  const listed = files.slice(0, 5)
  const body = listed.length === 0
    ? 'Circulated for information. No action required.'
    : `Affected documents: ${listed.join(', ')}${files.length > listed.length ? `, and ${files.length - listed.length} more` : ''}.`
  return [`Re: ${re}`, '', body, '', 'cc: the filing cabinet'].join('\n')
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// --- 12. The office horoscope ----------------------------------------------

const HOROSCOPES: readonly string[] = [
  'avoid merge conflicts before 3pm',
  'a colleague will ask you for a file you have already sent them',
  'today is a good day to name a variable after yourself',
  'the printer knows what you did',
  'you will be tempted to reply all. Resist',
  'someone will book a meeting that could have been a memo',
  'your lucky format is landscape',
  'do not trust anything that compiles on the first try',
  'a document you closed without saving is thinking of you',
  'the letter you have been avoiding will avoid you back',
  'you will find the file. It was in the folder called new folder',
  'good news arrives in the form of a green tick',
  'your afternoon is best spent tidying something that was already tidy',
  'beware of anyone who says it will only take five minutes',
]

/** One horoscope per day, seeded on the date so it is stable for the whole
 * day and different tomorrow. */
export function officeHoroscope(now = new Date()): string {
  const seed = now.getFullYear() * 372 + now.getMonth() * 31 + now.getDate()
  return HOROSCOPES[seed % HOROSCOPES.length]!
}

/** The horoscope as a greeting-sized line. */
export function horoscopeLine(now = new Date()): string {
  return `Today's office horoscope: ${officeHoroscope(now)}.`
}

// --- Finding the paths in a turn -------------------------------------------

/** Every path-shaped token in a blob of tool arguments or output. Crude on
 * purpose: this only ever feeds officeFileKind, which is itself a
 * conservative extension match, so a false positive costs nothing and a
 * missed one costs a joke. */
export function pathsIn(text: string): readonly string[] {
  const matches = text.match(/[\w.\/-]+\.[A-Za-z0-9]{1,5}\b/gu)
  return matches === null ? [] : [...new Set(matches)]
}

// --- Reading the session as paperwork --------------------------------------

/** Tool names that mean a document was revised. Matched loosely because
 * every host names its editor differently, and a memo that undercounts the
 * pages is funnier than one that crashes. */
const EDIT_TOOL = /(?:edit|write|patch|replace|create)/iu
/** A commit, as it appears in a shell tool call. */
const COMMIT_CALL = /git\s+commit/iu

/** Everything the memo needs, read off the same bounded evidence projection
 * every other part of the extension uses. Deliberately approximate: these
 * are Clippy's numbers, and Clippy is confident rather than accurate. */
export function memoFactsFrom(evidence: ClippyEvidence, stats: ClippyStats): MemoFacts {
  let linesChanged = 0
  let commits = 0
  for (const tool of evidence.recentTools) {
    const args = tool.arguments
    if (COMMIT_CALL.test(args)) commits += 1
    if (!EDIT_TOOL.test(tool.name)) continue
    // The arguments arrive as JSON, so a newline inside the new text is the
    // two characters backslash-n.
    linesChanged += (args.match(/\\n/gu) ?? []).length
  }
  return {
    linesChanged,
    commits,
    testsPassed: stats.testsPassedToday,
    testsFailed: stats.testsFailedToday,
    sessionMinutes: evidence.activityMinutes,
    streak: stats.streak,
  }
}

/** The documents this session actually revised, for the commit secretary's
 * "affected documents" line. */
export function editedFiles(evidence: ClippyEvidence): readonly string[] {
  const files = new Set<string>()
  for (const tool of evidence.recentTools) {
    if (!EDIT_TOOL.test(tool.name)) continue
    for (const path of pathsIn(tool.arguments)) files.add(path)
  }
  return [...files]
}
