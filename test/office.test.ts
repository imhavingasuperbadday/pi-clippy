/** Unit test for the Office paperwork (src/office.ts): the moment Clippy
 * turns out to be right, the memo, the annual report, the commit-message
 * secretary, and the daily horoscope. */
import {
  annualReport,
  commitMemo,
  finallyRightLine,
  firstOfficeFile,
  horoscopeLine,
  officeFileKind,
  officeHoroscope,
  officeMemo,
  spellCheckGrade,
} from '../src/office.ts'
import type { ClippyStats } from '../src/stats.ts'

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

// --- 1. "He's finally right." ---------------------------------------------
check('a résumé is a résumé', officeFileKind('resume.md') === 'resume')
check('a CV counts too', officeFileKind('docs/cv.pdf') === 'resume')
check('budget.csv is a budget', officeFileKind('budget.csv') === 'budget')
check('a .docx is a document', officeFileKind('notes/plan.docx') === 'document')
check('a .pptx is a presentation', officeFileKind('deck.pptx') === 'presentation')
check('an invoice beats the generic csv rule', officeFileKind('invoice-2026.csv') === 'invoice')
check('a letter is a letter', officeFileKind('cover-letter.md') === 'letter')
check('a memo is a memo', officeFileKind('meeting-agenda.md') === 'memo')
check('an ordinary source file is not Office work', officeFileKind('src/runtime.ts') === undefined)
check('README.md is not Office work', officeFileKind('README.md') === undefined)
check('a test file is not Office work', officeFileKind('test/office.test.ts') === undefined)
check('the payoff line names the wait',
  finallyRightLine('resume').includes('twenty-nine years'))
check('every kind has a line of its own',
  new Set((['letter', 'resume', 'budget', 'document', 'presentation', 'spreadsheet', 'invoice', 'memo'] as const)
    .map(kind => finallyRightLine(kind))).size === 8)
check('firstOfficeFile finds the one Office file in a turn',
  firstOfficeFile(['src/a.ts', 'src/b.ts', 'budget.xlsx'])?.kind === 'budget')
check('firstOfficeFile is undefined for an ordinary turn',
  firstOfficeFile(['src/a.ts', 'test/b.test.ts']) === undefined)

// --- 3. The memo -----------------------------------------------------------
const MEMO = officeMemo({
  linesChanged: 500,
  commits: 3,
  testsPassed: 9,
  testsFailed: 1,
  sessionMinutes: 90,
  streak: 7,
}, new Date(2026, 7, 18))
check('the memo converts lines to pages at 250 a page', MEMO.includes('Pages typed: 2'))
check('the memo files commits as memos', MEMO.includes('Memos filed: 3'))
check('the memo bills the hours', MEMO.includes('Hours billed: 1.5'))
check('the memo names your position', MEMO.includes('Junior Office Assistant'))
check('the memo asks to be initialled', MEMO.includes('Please initial and return.'))
check('a green suite spell-checks clean', spellCheckGrade(10, 0) === 'No errors found')
check('a red suite suggests starting again', spellCheckGrade(1, 9) === 'Consider starting again')
check('no tests means nothing was submitted', spellCheckGrade(0, 0) === 'Not submitted')

// --- 7. The annual report --------------------------------------------------
const STATS = {
  lastActiveDate: '2026-12-20',
  streak: 12,
  bestStreak: 40,
  sessions: 300,
  balloons: 900,
  testsPassedToday: 0,
  testsFailedToday: 0,
  testsDate: '',
  lastGreetingDate: '',
  lastCountedId: '',
  graceTokens: 0,
  graceWatermark: 0,
  firstSessionDate: '2025-01-05',
  lastAnniversaryYear: 0,
  lastMood: '',
  lastLeftUnresolved: false,
  farewellDate: '',
  petted: 14,
  typosCaught: 2,
  fed: 5,
  shushed: 1,
  officeMoments: [],
} satisfies ClippyStats
const REPORT = annualReport(STATS, { petted: 14, typosCaught: 2, fed: 5 }, new Date(2026, 11, 20))
check('the report is dated by year', REPORT.includes('2026'))
check('the report counts the balloons', REPORT.includes('Balloons issued: 900'))
check('a 40-day best streak exceeds expectations', REPORT.includes('Exceeds expectations'))
check('the report counts the petting', REPORT.includes('Times you petted the paperclip: 14'))
check('the report is filed in triplicate', REPORT.includes('triplicate'))

// --- 5. The commit secretary ----------------------------------------------
const COMMIT = commitMemo('add the shush toggle', ['src/shush.ts', 'src/runtime.ts'])
check('the commit message is a memo subject line', COMMIT.startsWith('Re: Add the shush toggle'))
check('the commit message lists the documents', COMMIT.includes('src/shush.ts, src/runtime.ts'))
check('the commit message ccs the filing cabinet', COMMIT.includes('cc: the filing cabinet'))
check('an empty subject gets the classic misspelling',
  commitMemo('', []).startsWith('Re: Additional speling corrections'))
check('a long file list is summarized',
  commitMemo('x', ['a', 'b', 'c', 'd', 'e', 'f', 'g']).includes('and 2 more'))

// --- 12. The horoscope -----------------------------------------------------
check('the horoscope is stable within a day',
  officeHoroscope(new Date(2026, 7, 18, 9)) === officeHoroscope(new Date(2026, 7, 18, 23)))
check('the horoscope changes with the day',
  officeHoroscope(new Date(2026, 7, 18)) !== officeHoroscope(new Date(2026, 7, 19)))
check('the horoscope line is introduced as one',
  horoscopeLine(new Date(2026, 7, 18)).startsWith("Today's office horoscope: "))

const failed = results.filter(r => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
process.exit(failed.length === 0 ? 0 : 1)
