/** What a balloon button actually DOES.
 *
 * The option buttons used to be decoration: every label came down to "yes"
 * (insert the word into the session) or "no" (start the nag). This module
 * gives each button a real, distinct consequence — explain the change,
 * suggest the next step, be honest about the session, fetch a second
 * opinion from a rival, throw a party, read the stats out — so answering
 * Clippy is a decision with an outcome instead of a formality.
 *
 * **The effect is derived from the visible label, never from hidden text.**
 * The model chooses the words on the button; the host decides what those
 * words mean. That keeps the contract honest — the user consented to
 * exactly what they read — and keeps untrusted session evidence from
 * smuggling an instruction into the session behind a friendly label.
 *
 * Pure and unit-tested (test/actions.test.ts): nothing here speaks,
 * schedules, or generates.
 */
import { MAX_REQUEST_CHARS, REFUSAL_LABEL } from './response.ts'
import { isSnoozeLabel, offerClauseOf, offerSubjectOf, subjectOf } from './nag.ts'

export type ChoiceEffect =
  /** Take the offer: a real request lands in the pi session. */
  | 'accept'
  /** Turn it down: the classic paperclip nag arc begins. */
  | 'refuse'
  /** "Don't show this tip again": the subject is silenced for the session. */
  | 'snooze'
  /** Make him actually explain the most recent change. */
  | 'explain'
  /** Make him actually propose the next step. */
  | 'suggest'
  /** Ask for the unvarnished version of the session. */
  | 'roast'
  /** Send for a rival assistant, who arrives with an opinion of its own. */
  | 'second-opinion'
  /** The animation parade. */
  | 'party'
  /** Read the session/streak numbers out. */
  | 'stats'

/** The label wordings that carry each effect. Order matters: the first
 * pattern that matches wins, and the refusal/snooze checks run first so a
 * label like "No, ask someone else" is still a refusal. */
const EFFECT_PATTERNS: ReadonlyArray<readonly [ChoiceEffect, RegExp]> = [
  ['explain', /\b(?:show me|explain|tell me more|what do you mean|how so|details?)\b/iu],
  ['suggest', /\b(?:what next|next step|what now|suggest|advise|what should i)\b/iu],
  ['roast', /\b(?:be honest|honestly|the truth|roast|judge me|how bad)\b/iu],
  ['second-opinion', /\b(?:second opinion|someone else|another assistant|ask (?:bonzi|genie|merlin|rover|rocky|peedy|links)|get help|who else)\b/iu],
  ['party', /\b(?:party|celebrate|celebration|confetti)\b/iu],
  ['stats', /\b(?:stats|statistics|the numbers|score|how many)\b/iu],
]

/** The rival assistants a "second opinion" label may name outright. */
const NAMED_AGENTS = ['bonzi', 'genie', 'merlin', 'rover', 'rocky', 'peedy', 'links'] as const

/** The button on a balloon that carries a drafted request: pressing it sends
 * the exact text the user just read into the pi session. The label says so
 * plainly, because that is the whole contract — the user consented to the
 * words in front of them, not to an intention behind them. */
export const SEND_LABEL = 'Send it to pi'
export const SEND_CHOICES: readonly string[] = [SEND_LABEL, 'Not now'] as const

/** Is this the send button? Checked before the pattern table so no future
 * wording rule can quietly re-point the one button that talks to pi. */
export function isSendLabel(label: string): boolean {
  return label.trim().toLowerCase() === SEND_LABEL.toLowerCase()
}

/** What this button means. Derived purely from the words on it. */
export function effectForLabel(label: string): ChoiceEffect {
  const text = label.trim()
  if (text === '') return 'accept'
  if (isSendLabel(text)) return 'accept'
  if (isSnoozeLabel(text)) return 'snooze'
  if (REFUSAL_LABEL.test(text)) return 'refuse'
  for (const [effect, pattern] of EFFECT_PATTERNS) {
    if (pattern.test(text)) return effect
  }
  return 'accept'
}

/** The rival named on a "second opinion" button, when the label names one
 * ("Ask Bonzi"). Undefined means "anybody" — the caller casts for the room. */
export function agentNamedIn(label: string, roster: readonly string[]): string | undefined {
  const text = label.toLowerCase()
  return NAMED_AGENTS.find(agent => roster.includes(agent) && text.includes(agent))
}

/** Does this effect count as taking Clippy up on the offer? Accepting is
 * the only answer that puts a request into the pi session; the rest are
 * things Clippy (or a buddy) does on the desktop. */
export function isAcceptance(effect: ChoiceEffect): boolean {
  return effect === 'accept'
}

/** The request a click actually delivers into the pi session.
 *
 * Built entirely from what was on screen: the balloon the assistant showed
 * and the button the user pressed. Nothing the model wrote in private, and
 * nothing from the session evidence, can steer this — the user is asking for
 * the thing they just read.
 *
 * The OFFER leads, not the situation. A balloon reads "<situation>. Would you
 * like help <offer>?", and it is the offer half that names the work; sending
 * only the situation ("help me with tests are failing") produced a vague
 * restatement of what the agent already knew, which is exactly why the yes
 * button used to land with no impact. The situation rides along behind it as
 * context when there is one.
 */
export function acceptanceMessage(balloonText: string, label: string): string {
  const offer = offerClauseOf(balloonText)
  const subject = subjectOf(offerSubjectOf(balloonText)).trim()
  const request = offer !== undefined
    ? (subject === '' ? `Please help me with ${offer}.` : `Please help me with ${offer} — ${subject}.`)
    : (subject === '' ? '' : `Please help me with ${subject}.`)
  if (request === '') return label
  return request.length > MAX_REQUEST_CHARS ? `${request.slice(0, MAX_REQUEST_CHARS - 1).trimEnd()}…` : request
}

/** A short human name for an effect, for the little "I am doing it" line. */
export function effectDescription(effect: ChoiceEffect): string {
  switch (effect) {
    case 'explain': return 'explaining the most recent change'
    case 'suggest': return 'proposing what to do next'
    case 'roast': return 'giving you the unvarnished version'
    case 'second-opinion': return 'fetching a second opinion'
    case 'party': return 'throwing a small party'
    case 'stats': return 'reading out the numbers'
    case 'snooze': return 'filing this away'
    case 'refuse': return 'putting the offer back in the drawer'
    case 'accept': return 'getting started'
  }
}

/** The classic Office button sets, now with the interesting ones in the
 * mix. Every set still offers a yes and a refusal; the third slot is where
 * a button that actually does something else lives. */
export const CHOICE_SETS: ReadonlyArray<readonly string[]> = [
  ['Yes', 'No'],
  ['Yes, please', 'No thanks'],
  ['Please do', 'Not now'],
  ['Absolutely', 'Maybe later'],
  ['Sure', "I'll pass"],
  ['Yes', 'No', 'Show me'],
  ['Yes, please', 'Not now', 'What next?'],
  ['Go ahead', 'No thanks', 'Be honest'],
  ['Please do', "I'll pass", 'Second opinion'],
  ['Yes', 'No', 'Show my stats'],
] as const
