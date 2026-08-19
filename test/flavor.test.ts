/** Unit test for spoken-line flavor (src/flavor.ts): varied openers, the
 * optional no-question ending, and opener stripping for offer subjects. */
import { flavorize, openWith, OPENER_PREFIX } from '../src/flavor.ts'
import { offerSubjectOf } from '../src/nag.ts'

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

// --- openWith --------------------------------------------------------------
check('roll 0 picks the classic opener',
  openWith('you are grading letters', 0) === 'It looks like you are grading letters')
check('a later roll picks a different opener',
  openWith('you are grading letters', 0.5) !== 'It looks like you are grading letters',
  openWith('you are grading letters', 0.5))
check('every opener produces a capitalized start',
  [...Array(12).keys()].every(i => /^[A-Z]/u.test(openWith('you are grading letters', i / 12))))
check('all-caps fragments (Peedy) get an all-caps opener',
  openWith('THREE DAYS IN A ROW', 0) === 'IT LOOKS LIKE THREE DAYS IN A ROW')
check('a full roll sweep never throws',
  [...Array(12).keys()].every(i => openWith('your report', i / 12).length > 0))

// --- flavorize -------------------------------------------------------------
check('flavorize keeps a line without an opener or question intact',
  flavorize('I have arranged my paperclips while I wait.') === 'I have arranged my paperclips while I wait.')
// The opener pool grows; what must hold is that the classic way in is
// REPLACED by another one and the fragment survives intact, not that a
// particular roll lands on a particular opener.
check('flavorize varies a leading "It looks like"',
  flavorize('It looks like you are filing papers.', {}, () => 0.76) !== 'It looks like you are filing papers.'
  && flavorize('It looks like you are filing papers.', {}, () => 0.76).includes('you are filing papers.'),
  flavorize('It looks like you are filing papers.', {}, () => 0.76))
check('flavorize keeps questions when not opted in',
  flavorize('It looks like you are filing papers. Would you like help with it?', {}, () => 0) ===
  'It looks like you are filing papers. Would you like help with it?')
check('flavorize drops a trailing question when the roll says so',
  flavorize('It looks like you are filing papers. Would you like help with it?', { dropQuestionChance: 1 }, () => 0) ===
  'It looks like you are filing papers.')
check('a dropped question still leaves the remark punctuated',
  ['It looks like you are filing papers. Would you like help with it?',
    'So your report looks tidy. Would you like help tidying it further?',
    'I have arranged the paperclips. Would you like help?']
    .every(line => /[.!?]$/u.test(flavorize(line, { dropQuestionChance: 1 }, () => 0))))
check('flavorize keeps a question when the roll declines',
  flavorize('It looks like you are filing papers. Would you like help with it?', { dropQuestionChance: 0.5 }, () => 0.99).includes('Would you like help'))
check('flavorize never leaves an empty line',
  flavorize('Would you like help with it?', { dropQuestionChance: 1 }, () => 0) === 'Would you like help with it?')

// --- offerSubjectOf across openers -----------------------------------------
const SUBJECT = 'you are grading a stack of letters'
check('offerSubjectOf strips the classic opener',
  offerSubjectOf(`It looks like ${SUBJECT}. Would you like help with it?`) === SUBJECT)
check('offerSubjectOf strips a varied opener',
  offerSubjectOf(`Ah, ${SUBJECT}. Would you like help with it?`) === SUBJECT)
check('offerSubjectOf strips a comma opener',
  offerSubjectOf(`From where I sit, ${SUBJECT}.`) === SUBJECT)
check('OPENER_PREFIX strips every opener variant',
  ['It looks like ', 'So ', 'Ah, ', 'Well, ', 'I see ', 'Now ', 'From where I sit, ', 'Oh, ', 'Hm, ', 'I notice ', 'Right, ', 'Aha, ']
    .every(prefix => `${prefix}${SUBJECT}`.replace(OPENER_PREFIX, '') === SUBJECT))

// --- Mood-flavored ways in -------------------------------------------------

const MOODS = ['furious', 'snippy', 'concerned', 'worried', 'proud', 'bored', 'delighted'] as const
const SWEEP = [...Array(24).keys()].map(i => i / 24)

check('every mood can open a line at every roll',
  MOODS.every(mood => SWEEP.every(roll => openWith('you are filing papers', roll, mood).includes('you are filing papers')
    || openWith('you are filing papers', roll, mood).includes('You are filing papers'))))
check('a mood pool still reaches the classic ways in',
  SWEEP.some(roll => openWith('you are filing papers', roll, 'furious').startsWith('It looks like')))
check('an angry room has ways in the general pool does not',
  SWEEP.some(roll => /^(?:Right|No|Enough|Again|Look)\./u.test(openWith('you are filing papers', roll, 'furious'))))
// A way in that is a whole sentence of its own must not leave the statement
// running on in lower case: "Enough. you have broken it" is a typo, not a mood.
check('a sentence-shaped opener capitalizes what follows it',
  MOODS.every(mood => SWEEP.every(roll => {
    const line = openWith('you are filing papers', roll, mood)
    return !/[.!?]\s+[a-z]/u.test(line)
  })), openWith('you are filing papers', 0, 'furious'))
check('a comma opener still keeps the statement lower case',
  openWith('you are filing papers', 0, undefined).includes('you are filing papers'))
check('every mood opener is still recognized as an opener',
  MOODS.every(mood => SWEEP.every(roll => OPENER_PREFIX.test(openWith('you are filing papers', roll, mood)))))

const failed = results.filter(r => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
process.exit(failed.length === 0 ? 0 : 1)
