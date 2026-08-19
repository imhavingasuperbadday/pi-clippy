/** Clippy's offer persistence: the small behavioral engine behind the
 * classic paperclip nag. When the user turns down an offer, Clippy re-asks
 * later (sullenly), after a couple of noes offers a "Don't show this tip
 * again" button that actually silences that subject for the session, and a
 * question left unanswered long enough is taken as a yes.
 *
 * All pure line/decision helpers live here so the runtime only wires
 * timers; the helpers are unit-tested in test/nag.test.ts.
 */

import { OPENER_PREFIX, openWith } from './flavor.ts'

export const SNOOZE_LABEL = "Don't show this tip again"

/** Is this button label the "silence this tip" choice? */
export function isSnoozeLabel(label: string): boolean {
  return label.trim().toLowerCase() === SNOOZE_LABEL.toLowerCase()
}

/** Pull the subject out of a shown balloon: strip whichever opener the
 * line used ("It looks like", "So", "Ah,", ...) and the trailing offer
 * question, so a nag can point at exactly what was refused. Example:
 *   "So you're grading a stack of letters and every one came
 *    out excellent. Would you like help with it? I will keep it warm."
 *   -> "you're grading a stack of letters and every one came out excellent"
 * (asides come after the offer question and are cut with it). */
export function offerSubjectOf(text: string): string {
  let subject = text.replace(OPENER_PREFIX, '')
  const questionAt = subject.toLowerCase().indexOf(' would you like help')
  if (questionAt >= 0) subject = subject.slice(0, questionAt)
  return subject.replace(/^[^a-z]+|[.!?,\s]+$/giu, '').trim()
}

/** The OFFER half of a balloon: what follows "would you like help", with the
 * trailing question mark and any sign-off aside cut away. This is the half
 * that names the work Clippy is proposing to do, so it is what an accepted
 * offer actually asks for.
 *
 *   "So you are grading a stack of letters. Would you like help turning this
 *    into a chart? I will be right here."  ->  "turning this into a chart"
 *
 * Undefined when the line never asked ("with it" / "with that" also count as
 * no real offer: they point back at the subject, which the caller already
 * has). */
export function offerClauseOf(text: string): string | undefined {
  const match = /would you like (?:help|me to)\s*([^?]*)\?/iu.exec(text)
  const clause = match?.[1]?.trim().replace(/^with\s+/iu, '').trim()
  if (clause === undefined || clause === '') return undefined
  if (/^(?:it|that|this|them|these|those)$/iu.test(clause)) return undefined
  return clause
}

/** Strip the opening pronoun so the subject can ride inside a nag sentence:
 * "you're grading a stack of letters" -> "grading a stack of letters". */
export function subjectOf(statement: string): string {
  return statement.replace(/^(?:you're|you are|your|you)\s+/iu, '')
}

/** Stable-ish topic key so "don't show this tip again" can silence a subject
 * across balloons (the first three significant words). */
export function topicKey(statement: string): string {
  const words = statement
    .toLowerCase()
    .replace(/^(?:you're|you are|your|you)\s+/iu, '')
    .split(/\s+/u)
    .filter(word => word.length > 1)
  return words.slice(0, 3).join(' ')
}

/** One of a pool, by roll; an out-of-range roll takes the first entry. */
function pick<T>(pool: readonly T[], roll: number): T {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) return pool[0]!
  return pool[Math.floor(roll * pool.length)] ?? pool[0]!
}

/** The nag, in three escalating tiers: a hopeful re-ask, an admission that
 * he is going to keep asking, and the one where he has started keeping
 * records. Each tier is a POOL rather than a single sentence — being nagged
 * with the identical wording every time reads as a bug, while being nagged
 * with a fresh excuse every time is the actual joke.
 *
 * Each entry is [statement fragment, follow-up]; the fragment goes through
 * an opener like every other line he says. */
const NAG_TIERS: readonly (readonly (readonly [string, string])[])[] = [
  [
    ['you said no to {what}', 'I will ask again, in case it was an accident.'],
    ['you turned down {what}', 'I have decided that was a misclick.'],
    ['you said no to {what}', 'I will ask again. I have chosen to read it as "not yet".'],
    ['you said no to {what} a moment ago', 'I have thought about it and I am not convinced.'],
  ],
  [
    ['you said no to {what} twice', 'I am going to keep asking anyway.'],
    ['you have now refused {what} twice', 'I am nothing if not persistent. That is the whole of my personality.'],
    ['you said no to {what} again', 'That is twice. I have a long memory and very little else.'],
  ],
  [
    ['you have said no to {what} several times', 'I have made a chart of all the noes.'],
    ['you have refused {what} more times than I have fingers', 'Which is none. The chart still exists.'],
    ['you keep saying no to {what}', 'I have opened a file on it. It is becoming a thick file.'],
  ],
]

/** The nag line for this many refusals. The question always rides along
 * (with buttons), because a nag that does not ask is just standing there
 * being passive-aggressive. */
export function nagLine(subject: string, refusals: number, roll: number = Math.random()): string {
  const what = subject === '' ? 'my earlier offer' : subject
  const tier = NAG_TIERS[refusals <= 1 ? 0 : refusals === 2 ? 1 : 2]!
  const [fragment, followUp] = pick(tier, roll)
  return `${openWith(fragment.replace('{what}', what))}. ${followUp} Would you like help with it?`
}

/** Balloon for an offer the user never answered: he took the silence as a
 * yes. A statement, not a question — Clippy is not asking, he has decided. */
const IGNORED_LINES: readonly (readonly [string, string])[] = [
  ['you did not answer my question about {what}', 'I have taken that as a yes.'],
  ['you have gone very quiet about {what}', 'I have taken that as a yes and started.'],
  ['you never said no to {what}', 'In this office that is a yes.'],
]

export function ignoredOfferLine(subject: string, roll: number = Math.random()): string {
  const what = subject === '' ? 'my earlier offer' : subject
  const [fragment, followUp] = pick(IGNORED_LINES, roll)
  return `${openWith(fragment.replace('{what}', what))}. ${followUp}`
}

/** Balloon for an offer Clippy gives up on himself: not a "no" from you, a
 * mildly wounded surrender after being left hanging. Distinct from
 * ignoredOfferLine (silence taken as a yes) and from a silent drop (no
 * balloon at all) — this is the third, annoyed way an unanswered offer can
 * end. */
const DISMISSED_LINES: readonly (readonly [string, string])[] = [
  ['you are not going to answer about {what}', 'Fine. I will decide that one myself: no.'],
  ['you have left {what} hanging', 'I will decide that one myself, then. No.'],
  ['you never came back to me about {what}', 'I have withdrawn the offer. It was a good offer.'],
]

export function dismissedOfferLine(subject: string, roll: number = Math.random()): string {
  const what = subject === '' ? 'my earlier offer' : subject
  const [fragment, followUp] = pick(DISMISSED_LINES, roll)
  return `${openWith(fragment.replace('{what}', what))}. ${followUp}`
}

/** Reaction to pressing "Don't show this tip again". */
const SNOOZE_LINES: readonly string[] = [
  'Very well. I have filed {what} under Do Not Reopen.',
  'Understood. {what} goes in the drawer marked Do Not Reopen.',
  'As you wish. I have filed {what} under Do Not Reopen, with a small note.',
]

export function snoozeLine(subject: string, roll: number = Math.random()): string {
  const what = subject === '' ? 'that tip' : subject
  return pick(SNOOZE_LINES, roll).replace('{what}', what)
}

/** Nag balloon buttons: the original choices, plus the classic "Don't show
 * this tip again" once he has been refused a couple of times. */
export function nagChoices(base: readonly string[], refusals: number): readonly string[] {
  if (refusals < 2 || base.includes(SNOOZE_LABEL)) return base
  return [...base, SNOOZE_LABEL]
}