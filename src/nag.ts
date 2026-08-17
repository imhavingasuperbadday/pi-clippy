/** Clippy's offer persistence: the small behavioral engine behind the
 * classic paperclip nag. When the user turns down an offer, Clippy re-asks
 * later (sullenly), after a couple of noes offers a "Don't show this tip
 * again" button that actually silences that subject for the session, and a
 * question left unanswered long enough is taken as a yes.
 *
 * All pure line/decision helpers live here so the runtime only wires
 * timers; the helpers are unit-tested in test/nag.test.ts.
 */

export const SNOOZE_LABEL = "Don't show this tip again"

/** Is this button label the "silence this tip" choice? */
export function isSnoozeLabel(label: string): boolean {
  return label.trim().toLowerCase() === SNOOZE_LABEL.toLowerCase()
}

/** Pull the subject out of a shown balloon: strip the "It looks like "
 * preamble and the trailing offer question, so a nag can point at exactly
 * what was refused. Example:
 *   "It looks like you're grading a stack of letters and every one came
 *    out excellent. Would you like help with it? I will keep it warm."
 *   -> "you're grading a stack of letters and every one came out excellent"
 * (asides come after the offer question and are cut with it). */
export function offerSubjectOf(text: string): string {
  let subject = text.replace(/^It looks like /iu, '')
  const questionAt = subject.toLowerCase().indexOf(' would you like help')
  if (questionAt >= 0) subject = subject.slice(0, questionAt)
  return subject.replace(/^[^a-z]+|[.!?,\s]+$/giu, '').trim()
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

/** The nag lines, escalating with how many times this offer has been
 * refused. The question always rides along (with buttons), because a nag
 * that does not ask is just standing there being passive-aggressive. */
export function nagLine(subject: string, refusals: number): string {
  const what = subject === '' ? 'my earlier offer' : subject
  if (refusals <= 1) {
    return `It looks like you said no to ${what}. I will ask again, in case it was an accident. Would you like help with it?`
  }
  if (refusals === 2) {
    return `It looks like you said no to ${what} twice. I am going to keep asking anyway. Would you like help with it?`
  }
  return `It looks like you have said no to ${what} several times. I have made a chart of all the noes. Would you like help with it?`
}

/** Balloon for an offer the user never answered: he took the silence as a
 * yes. A statement, not a question — Clippy is not asking, he has decided. */
export function ignoredOfferLine(subject: string): string {
  const what = subject === '' ? 'my earlier offer' : subject
  return `It looks like you did not answer my question about ${what}. I have taken that as a yes.`
}

/** Reaction to pressing "Don't show this tip again". */
export function snoozeLine(subject: string): string {
  const what = subject === '' ? 'that tip' : subject
  return `Very well. I have filed ${what} under Do Not Reopen.`
}

/** Nag balloon buttons: the original choices, plus the classic "Don't show
 * this tip again" once he has been refused a couple of times. */
export function nagChoices(base: readonly string[], refusals: number): readonly string[] {
  if (refusals < 2 || base.includes(SNOOZE_LABEL)) return base
  return [...base, SNOOZE_LABEL]
}