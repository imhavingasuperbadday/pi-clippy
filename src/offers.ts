/** Offer persistence — the authentic paperclip nag, event-driven.
 *
 * A refused offer is re-asked shortly after (sullenly, escalating), an
 * unanswered question is called out minutes later, and "Don't show this tip
 * again" really silences the subject for the session. All state is
 * session-scoped and never persisted.
 *
 * Owns the nag/watch timers and the snooze set; the wording of the lines
 * stays in src/nag.ts and the balloon plumbing stays with the runtime.
 */
import { ignoredOfferLine, isSnoozeLabel, nagChoices, nagLine, offerSubjectOf, snoozeLine, subjectOf, topicKey } from './nag.ts'
import { REFUSAL_LABEL } from './response.ts'

const OFFER_NAG_MIN_MS = 45_000
const OFFER_NAG_MAX_MS = 120_000
const OFFER_IGNORED_MIN_MS = 180_000
const OFFER_IGNORED_MAX_MS = 300_000

export type OfferChoiceKind = 'accepted' | 'refused' | 'snoozed'

export interface OfferDecision {
  readonly kind: OfferChoiceKind
  /** The subject of the offer that was answered, when there was one. */
  readonly subject?: string
}

/** Shows a balloon (text, optional choice buttons, optional offer subject). */
export type ShowBalloon = (text: string, offerChoices?: boolean | readonly string[], offerSubject?: string) => void

export class OfferTracker {
  private lastOfferSubject: string | undefined
  private offerAnswered = true
  private refusals = 0
  private readonly snoozedTopics = new Set<string>()
  private nagTimer: ReturnType<typeof setTimeout> | undefined
  private offerWatchTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly show: ShowBalloon,
    private readonly isAlive: () => boolean,
    /** Called when an offer went unanswered long enough that Clippy took the
     * silence as a yes. Being ignored is one of the things he holds against
     * you (src/temper.ts), so the runtime counts it. */
    private readonly onIgnored: () => void = () => {},
  ) {}

  /** A balloon (with or without buttons) just went up: track its subject and
   * start watching for silence so an unanswered offer can be called out. */
  onBalloonShown(text: string, choices: readonly string[] | undefined, offerSubject?: string): void {
    const subject = choices === undefined ? undefined : (offerSubject ?? offerSubjectOf(text))
    this.lastOfferSubject = subject
    this.offerAnswered = subject === undefined
    if (subject !== undefined) this.armOfferWatch(subject)
  }

  /** The user picked one of the option buttons: clear pending timers and
   * kick off the nag arc on a refusal (or silence the subject on a snooze). */
  onChoice(label: string, choices: readonly string[]): OfferDecision {
    const subject = this.lastOfferSubject
    this.lastOfferSubject = undefined
    this.offerAnswered = true
    this.clearTimers()
    if (subject !== undefined && isSnoozeLabel(label)) {
      // The classic anti-tip button: this subject stops being nagged (and
      // stops being called out for silence) for the rest of the session.
      this.snoozedTopics.add(topicKey(subject))
      this.show(snoozeLine(subjectOf(subject)), false)
      return { kind: 'snoozed', subject }
    }
    if (subject !== undefined && REFUSAL_LABEL.test(label)) {
      this.scheduleNag(subject, choices)
    }
    return { kind: subject === undefined ? 'accepted' : REFUSAL_LABEL.test(label) ? 'refused' : 'accepted', subject }
  }

  /** A refusal just landed: re-ask the same offer, sullenly, a little
   * later. Each extra no escalates the line and eventually adds the
   * classic "Don't show this tip again" button. */
  private scheduleNag(subject: string, choices: readonly string[]): void {
    if (this.isSnoozed(subject)) return
    this.refusals += 1
    const count = this.refusals
    this.clearTimers()
    this.nagTimer = setTimeout(() => {
      this.nagTimer = undefined
      if (!this.isAlive()) return
      const clean = subjectOf(subject)
      if (this.isSnoozed(clean)) return
      this.show(nagLine(clean, count), nagChoices(choices, count), subject)
    }, OFFER_NAG_MIN_MS + Math.random() * (OFFER_NAG_MAX_MS - OFFER_NAG_MIN_MS))
  }

  /** A balloon with buttons just went up: watch for silence, so an
   * unanswered offer can be called out ("I have taken that as a yes").
   * Re-armed on every fresh offering balloon, cleared when answered. */
  private armOfferWatch(subject: string): void {
    this.offerAnswered = false
    this.clearTimers()
    if (this.isSnoozed(subject)) return
    this.offerWatchTimer = setTimeout(() => {
      this.offerWatchTimer = undefined
      if (!this.isAlive() || this.offerAnswered || this.lastOfferSubject === undefined) return
      this.show(ignoredOfferLine(subjectOf(subject)), false)
      this.onIgnored()
    }, OFFER_IGNORED_MIN_MS + Math.random() * (OFFER_IGNORED_MAX_MS - OFFER_IGNORED_MIN_MS))
  }

  private isSnoozed(subject: string): boolean {
    return this.snoozedTopics.has(topicKey(subject))
  }

  clearTimers(): void {
    if (this.nagTimer !== undefined) clearTimeout(this.nagTimer)
    if (this.offerWatchTimer !== undefined) clearTimeout(this.offerWatchTimer)
    this.nagTimer = undefined
    this.offerWatchTimer = undefined
  }

  dispose(): void {
    this.clearTimers()
    this.snoozedTopics.clear()
  }
}
