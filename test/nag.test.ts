/** Unit checks for the offer-persistence engine (src/nag.ts): subject
 * extraction, topic keys, snooze detection, and the three nag lines. All
 * pure functions — no timers, no runtime. */
import {
  ignoredOfferLine,
  isSnoozeLabel,
  nagChoices,
  nagLine,
  offerSubjectOf,
  snoozeLine,
  subjectOf,
  topicKey,
} from '../src/nag.ts'

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

function main(): void {
  // Subject extraction from a shown balloon
  check(
    'offerSubjectOf strips preamble + offer question',
    offerSubjectOf('It looks like you\'re grading a stack of letters and every one came out excellent. Would you like help with it? I will keep it warm.') ===
      'you\'re grading a stack of letters and every one came out excellent',
  )
  check(
    'offerSubjectOf plain statement keeps words',
    offerSubjectOf('It looks like you are debugging a test.') === 'you are debugging a test',
  )
  check(
    'offerSubjectOf statement ending in comma-question',
    offerSubjectOf('It looks like you\'re mending the same torn letter, would you like help with it?') ===
      'you\'re mending the same torn letter',
  )

  // Pronoun stripping for nag sentences
  check('subjectOf strips you\'re', subjectOf('you\'re grading a stack of letters') === 'grading a stack of letters')
  check('subjectOf strips you are', subjectOf('you are on a 4-day streak') === 'on a 4-day streak')
  check('subjectOf strips your', subjectOf('your build is looking strong') === 'build is looking strong')
  check('subjectOf strips bare you', subjectOf('you forgot to close the file') === 'forgot to close the file')

  // Topic keys: same subject across phrasings maps to one key
  check('topicKey stable across pronouns', topicKey('you\'re grading a stack of letters') === topicKey('you are grading a stack of letters'))
  check('topicKey distinguishes subjects', topicKey('you are grading letters') !== topicKey('you are mending letters'))
  check('topicKey ignores filler', topicKey('you are mending the same torn letter') === 'mending the same')

  // Snooze label detection
  check('isSnoozeLabel exact', isSnoozeLabel("Don't show this tip again"))
  check('isSnoozeLabel case-insensitive', isSnoozeLabel("don't SHOW this tip AGAIN"))
  check('isSnoozeLabel rejects No', !isSnoozeLabel('No'))

  // Nag lines escalate
  check('nagLine level 1 asks again', nagLine('grading letters', 1).includes('I will ask again'))
  check('nagLine level 2 keeps asking', nagLine('grading letters', 2).includes('twice'))
  check('nagLine level 3+ chart', nagLine('grading letters', 5).includes('chart'))
  check('nagLine empty subject fallback', nagLine('', 1).includes('my earlier offer'))
  check('nagLine always asks', [1, 2, 3].every(level => nagLine('grading letters', level).includes('Would you like help with it?')))

  // Ignored-offer and snooze lines use the subject
  check('ignoredOfferLine takes silence as yes', ignoredOfferLine('grading letters').includes('taken that as a yes'))
  check('ignoredOfferLine empty fallback', ignoredOfferLine('').includes('my earlier offer'))
  check('snoozeLine files under Do Not Reopen', snoozeLine('grading letters').includes('Do Not Reopen'))

  // Nag buttons: snooze appears after the second refusal, never duplicated
  check('nagChoices level 1 no snooze', nagChoices(['Yes', 'No'], 1).length === 2)
  check('nagChoices level 2 adds snooze', nagChoices(['Yes', 'No'], 2).includes("Don't show this tip again"))
  check('nagChoices level 3 keeps snooze', nagChoices(['Yes', 'No'], 3).length === 3)
  check('nagChoices never duplicates snooze', nagChoices(['Yes', 'No', "Don't show this tip again"], 2).length === 3)

  const failed = results.filter(r => r.startsWith('FAIL'))
  console.log(results.join('\n'))
  console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
  process.exit(failed.length === 0 ? 0 : 1)
}

void main()