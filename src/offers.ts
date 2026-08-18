/** Offer persistence — the authentic paperclip nag, event-driven.
 *
 * A refused offer is re-asked shortly after (sullenly, escalating), and an
 * unanswered question is resolved minutes later — not by one fixed rule, but
 * by rolling the same three ways a real, mildly self-important paperclip
 * would: he takes the silence as a yes and actually does the thing (real
 * file powers, exactly like a pressed Yes), he gets annoyed and decides
 * against it himself, or he simply lets it go without a word so the desktop
 * is free again. "Don't show this tip again" still really silences the
 * subject for the session. All state is session-scoped and never persisted.
 *
 * Owns the nag/watch timers and the snooze set; the wording of the lines
 * stays in src/nag.ts and the balloon plumbing (and the real accept action)
 * stays with the runtime.
 */
import { dismissedOfferLine, ignoredOfferLine, isSnoozeLabel, nagChoices, nagLine, offerSubjectOf, snoozeLine, subjectOf, topicKey } from './nag.ts'
import { REFUSAL_LABEL } from './response.ts'

const OFFER_NAG_MIN_MS = 45_000
const OFFER_NAG_MAX_MS = 120_000
const OFFER_IGNORED_MIN_MS = 180_000
const OFFER_IGNORED_MAX_MS = 300_000
/** How an unanswered offer's silence rolls: assume yes and really do it,
 * get annoyed and drop it himself, or just let it go unremarked. Ordered so
 * a roll below the first bound accepts, below the second dismisses, and the
 * rest ignores. */
const UNRESOLVED_ACCEPT_CHANCE = 0.4
const UNRESOLVED_DISMISS_CHANCE = 0.7

export type OfferChoiceKind = 'accepted' | 'refused' | 'snoozed'

export interface OfferDecision {
  readonly kind: OfferChoiceKind
  /** The subject of the offer that was answered, when there was one. */
  readonly subject?: string
}

/** How Clippy resolved an offer nobody answered: 'accepted' means he decided
 * for you and it should really happen (the runtime carries it out with the
 * same powers a pressed Yes gets); 'dismissed' means he got annoyed and
 * talked himself out of it; 'ignored' means he simply let it go. */
export type UnresolvedOfferOutcome = 'accepted' | 'dismissed' | 'ignored'

/** Shows a balloon (text, optional choice buttons, optional offer subject). */
export type ShowBalloon = (text: string, offerChoices?: boolean | readonly string[], offerSubject?: string) => void

export class OfferTracker {
  private lastOfferSubject: string | undefined
  /** The exact balloon text and choice labels behind the current offer, kept
   * alongside the subject so a resolved-silence "accept" always acts on the
   * offer the user actually saw — even if a later, unrelated balloon has
   * since replaced it on screen. */
  private lastOfferText: string | undefined
  private lastOfferChoices: readonly string[] | undefined
  private offerAnswered = true
  private refusals = 0
  private readonly snoozedTopics = new Set<string>()
  private nagTimer: ReturnType<typeof setTimeout> | undefined
  private offerWatchTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly show: ShowBalloon,
    private readonly isAlive: () => boolean,
    /** Called when an offer went unanswered long enough that Clippy resolved
     * it himself. `offerText` and `label` describe exactly what he is
     * acting on (or would have acted on), so the caller never has to guess
     * which offer this was. Getting dismissed is one of the things he holds
     * against you (src/temper.ts); being quietly let go is not. */
    private readonly onUnresolved: (outcome: UnresolvedOfferOutcome, offerText: string, label: string) => void = () => {},
    private readonly random: () => number = Math.random,
  ) {}

  /** A balloon (with or without buttons) just went up: track its subject and
   * start watching for silence so an unanswered offer can be called out. */
  onBalloonShown(text: string, choices: readonly string[] | undefined, offerSubject?: string): void {
    const subject = choices === undefined ? undefined : (offerSubject ?? offerSubjectOf(text))
    this.lastOfferSubject = subject
    this.lastOfferText = subject === undefined ? undefined : text
    this.lastOfferChoices = subject === undefined ? undefined : choices
    this.offerAnswered = subject === undefined
    if (subject !== undefined) this.armOfferWatch(subject)
  }

  /** The user picked one of the option buttons: clear pending timers and
   * kick off the nag arc on a refusal (or silence the subject on a snooze). */
  onChoice(label: string, choices: readonly string[]): OfferDecision {
    const subject = this.lastOfferSubject
    this.lastOfferSubject = undefined
    this.lastOfferText = undefined
    this.lastOfferChoices = undefined
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
   * unanswered offer is eventually resolved one of three ways instead of
   * sitting there forever ("I have taken that as a yes", getting annoyed and
   * deciding against it, or simply letting it go). Re-armed on every fresh
   * offering balloon, cleared when answered. The offer text and choices are
   * captured now, at arm time, so the eventual resolution always acts on
   * THIS offer even if later balloons have since moved the conversation on. */
  private armOfferWatch(subject: string): void {
    this.offerAnswered = false
    this.clearTimers()
    if (this.isSnoozed(subject)) return
    const offerText = this.lastOfferText
    const choices = this.lastOfferChoices
    this.offerWatchTimer = setTimeout(() => {
      this.offerWatchTimer = undefined
      if (!this.isAlive() || this.offerAnswered || this.lastOfferSubject === undefined || offerText === undefined) return
      const clean = subjectOf(subject)
      const roll = this.random()
      if (roll < UNRESOLVED_ACCEPT_CHANCE) {
        // Silence taken as a yes, for real: the runtime carries this out
        // with the same powers a pressed Yes would get.
        const acceptLabel = choices?.find(label => !REFUSAL_LABEL.test(label)) ?? 'Yes'
        this.show(ignoredOfferLine(clean), false)
        this.onUnresolved('accepted', offerText, acceptLabel)
      } else if (roll < UNRESOLVED_DISMISS_CHANCE) {
        // He gets tired of waiting and decides against it himself — a real
        // snub, unlike a silent drop.
        const refuseLabel = choices?.find(label => REFUSAL_LABEL.test(label)) ?? 'No'
        this.show(dismissedOfferLine(clean), false)
        this.onUnresolved('dismissed', offerText, refuseLabel)
      } else {
        // He simply lets it go, unremarked — no balloon, so the floor is
        // free for whatever (or whoever) wants it next.
        const refuseLabel = choices?.find(label => REFUSAL_LABEL.test(label)) ?? 'No'
        this.onUnresolved('ignored', offerText, refuseLabel)
      }
    }, OFFER_IGNORED_MIN_MS + this.random() * (OFFER_IGNORED_MAX_MS - OFFER_IGNORED_MIN_MS))
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
