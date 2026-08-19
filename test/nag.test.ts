/** Unit checks for the offer-persistence engine (src/nag.ts): subject
 * extraction, topic keys, snooze detection, and the three nag lines. All
 * pure functions — no timers, no runtime. */
import {
  dismissedOfferLine,
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

  // Nag lines escalate, and each tier is a pool rather than one sentence
  const ROLLS = [0, 0.34, 0.67, 0.99]
  check('nagLine level 1 asks again', nagLine('grading letters', 1, 0).includes('I will ask again'))
  check('nagLine level 2 keeps asking', nagLine('grading letters', 2, 0).includes('twice'))
  check('nagLine level 3+ keeps records', nagLine('grading letters', 5, 0).includes('chart'))
  check('nagLine empty subject fallback', nagLine('', 1, 0).includes('my earlier offer'))
  check('nagLine always asks',
    [1, 2, 3, 9].every(level => ROLLS.every(roll => nagLine('grading letters', level, roll).includes('Would you like help with it?'))))
  check('nagLine always names the subject',
    [1, 2, 3].every(level => ROLLS.every(roll => nagLine('grading letters', level, roll).includes('grading letters'))))
  check('every tier has more than one way of nagging',
    [1, 2, 3].every(level => new Set(ROLLS.map(roll => nagLine('grading letters', level, roll))).size > 1))
  check('the tiers stay distinct from each other',
    new Set([1, 2, 3].map(level => nagLine('grading letters', level, 0))).size === 3)
  check('an out-of-range roll still nags', nagLine('grading letters', 1, 7).includes('grading letters'))

  // Ignored-offer and snooze lines use the subject
  check('ignoredOfferLine takes silence as yes', ignoredOfferLine('grading letters', 0).includes('taken that as a yes'))
  check('ignoredOfferLine empty fallback', ignoredOfferLine('', 0).includes('my earlier offer'))
  check('ignoredOfferLine varies', new Set(ROLLS.map(roll => ignoredOfferLine('grading letters', roll))).size > 1)
  check('snoozeLine files under Do Not Reopen',
    ROLLS.every(roll => snoozeLine('grading letters', roll).includes('Do Not Reopen')))
  check('snoozeLine varies', new Set(ROLLS.map(roll => snoozeLine('grading letters', roll))).size > 1)

  // Dismissed-offer line: the third, annoyed way an unanswered offer ends
  // (distinct from "taken as a yes" and from a silent drop with no balloon)
  check('dismissedOfferLine decides against it himself', dismissedOfferLine('grading letters', 0).includes('decide that one myself'))
  check('dismissedOfferLine empty fallback', dismissedOfferLine('', 0).includes('my earlier offer'))
  check('dismissedOfferLine varies', new Set(ROLLS.map(roll => dismissedOfferLine('grading letters', roll))).size > 1)
  check('dismissedOfferLine is never mistaken for taking it as a yes',
    ROLLS.every(roll => !dismissedOfferLine('grading letters', roll).includes('as a yes')))

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