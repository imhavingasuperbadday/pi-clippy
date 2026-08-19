/** The relationship: how Clippy and the user are actually getting on.
 *
 * Everything about the paperclip's temper was, until now, negative. Refuse
 * him and he sulks; shush him and he files a grievance; brush him off three
 * times and he goes on strike (src/temper.ts, src/nag.ts). Nothing anywhere
 * measured the other direction — say yes to twenty offers, pet him, feed
 * him, play his game, and he greeted you on day fifty exactly the way he
 * greeted you on day one.
 *
 * This module is the missing half. It keeps one signed score of how the two
 * of you have been treating each other: warmth from every accepted offer,
 * every pet, every game; friction from every refusal, snooze, and shush.
 * The score decides his REGISTER — how forward he is, how often he pushes an
 * offer, how familiar he is allowed to be — and it survives the session, so a
 * long friendship reads differently from a first afternoon and a session
 * spent shutting him up leaves a mark on tomorrow.
 *
 * Pure and roll-free (unit-tested in test/rapport.test.ts): nothing here
 * speaks, schedules, or persists. The runtime owns the ledger, src/stats.ts
 * owns the number that carries across days.
 */

/** Something the user did that Clippy takes as kindness. */
export type WarmthEvent =
  /** An offer accepted — the thing he most wants. */
  | 'accepted'
  /** A drafted request actually sent into the session: you trusted him with
   * your own words, which he rates even higher than a plain yes. */
  | 'handed-over'
  /** He was petted, fed, or otherwise handled fondly. */
  | 'petted'
  | 'fed'
  /** A game of rock-paper-scissors was played to the end. */
  | 'played'
  /** A page of THE SECRETS OF CLIPPY was read. */
  | 'read-secret'
  /** He was spoken to directly (/clippy, or clicking him) rather than
   * merely tolerated in the corner. */
  | 'addressed'

/** Something the user did that Clippy takes personally. */
export type FrictionEvent =
  | 'refused'
  | 'snoozed'
  | 'shushed'
  | 'brushed-off'
  /** An offer left hanging until he gave up on it himself. */
  | 'dismissed'
  /** The reset: the session self was wiped. He does not forget that it
   * happened, only what was in it. */
  | 'lobotomized'

export type RapportEvent = WarmthEvent | FrictionEvent

/** What each event is worth. Kindness is weighted slightly heavier than
 * friction on purpose: a paperclip that could be soured faster than he could
 * be won over would spend every long session at the bottom of the scale. */
export const RAPPORT_WEIGHTS: Readonly<Record<RapportEvent, number>> = {
  accepted: 2,
  'handed-over': 3,
  petted: 1,
  fed: 1,
  played: 1,
  'read-secret': 1,
  addressed: 1,
  refused: -1,
  snoozed: -2,
  shushed: -2,
  'brushed-off': -1,
  dismissed: -1,
  lobotomized: -4,
}

/** How far the score may travel in either direction. Bounded so one very
 * long session cannot pin him at an extreme forever, and so the carried
 * score stays a mood rather than a permanent verdict. */
export const RAPPORT_MIN = -12
export const RAPPORT_MAX = 12

export function clampRapport(score: number): number {
  if (!Number.isFinite(score)) return 0
  return Math.min(RAPPORT_MAX, Math.max(RAPPORT_MIN, score))
}

/** How much of yesterday's score is still felt today. Relationships fade
 * toward neutral without dying: a good run has to be kept up, and a bad
 * afternoon is not held against you for a fortnight. */
export const RAPPORT_DECAY = 0.6

export function decayedRapport(score: number): number {
  const decayed = clampRapport(score) * RAPPORT_DECAY
  // Snap the last fraction to zero so a long absence really does return to
  // neutral instead of asymptotically hovering just off it.
  return Math.abs(decayed) < 0.5 ? 0 : Math.round(decayed * 10) / 10
}

/** How long the two of you have known each other, from the persistent
 * counters alone. Independent of the score: an old friend can be having a
 * terrible day, and a stranger can be having a lovely one. */
export type Familiarity = 'stranger' | 'acquaintance' | 'colleague' | 'old-friend'

export function familiarityOf(history: { readonly sessions?: number; readonly bestStreak?: number }): Familiarity {
  const sessions = Math.max(0, history.sessions ?? 0)
  const best = Math.max(0, history.bestStreak ?? 0)
  if (sessions >= 40 || best >= 14) return 'old-friend'
  if (sessions >= 10 || best >= 5) return 'colleague'
  if (sessions >= 2) return 'acquaintance'
  return 'stranger'
}

/** The register the relationship has earned, coldest first. */
export type RapportLevel = 'frosty' | 'strained' | 'cordial' | 'warm' | 'devoted'

export const RAPPORT_LEVELS: readonly RapportLevel[] = ['frosty', 'strained', 'cordial', 'warm', 'devoted'] as const

export interface Rapport {
  readonly level: RapportLevel
  readonly familiarity: Familiarity
  /** Carried score plus this session's, clamped. */
  readonly score: number
  /** This session's contribution on its own — what changed today. */
  readonly sessionScore: number
}

export function levelForScore(score: number): RapportLevel {
  if (score <= -6) return 'frosty'
  if (score <= -2) return 'strained'
  if (score < 3) return 'cordial'
  if (score < 8) return 'warm'
  return 'devoted'
}

export function rapportOf(options: {
  readonly carried?: number
  readonly session?: number
  readonly sessions?: number
  readonly bestStreak?: number
}): Rapport {
  const raw = options.session ?? 0
  const sessionScore = Number.isFinite(raw) ? raw : 0
  const score = clampRapport((options.carried ?? 0) + sessionScore)
  return {
    level: levelForScore(score),
    familiarity: familiarityOf(options),
    score,
    sessionScore,
  }
}

/** One session's running tally. Session-scoped by construction: it holds a
 * number and a count, never a file handle. */
export class RapportLedger {
  private total = 0
  private warmthCount = 0
  private frictionCount = 0

  note(event: RapportEvent): number {
    const weight = RAPPORT_WEIGHTS[event]
    if (weight === undefined) return this.total
    if (weight > 0) this.warmthCount += 1
    else this.frictionCount += 1
    this.total = clampRapport(this.total + weight)
    return this.total
  }

  /** What this session has come to, on its own. */
  get score(): number {
    return this.total
  }

  get warmth(): number {
    return this.warmthCount
  }

  get friction(): number {
    return this.frictionCount
  }

  /** Has anything at all passed between you two today? A session nobody
   * interacted with should not move the carried score in either direction. */
  get touched(): boolean {
    return this.warmthCount + this.frictionCount > 0
  }

  rapport(history: { readonly carried?: number; readonly sessions?: number; readonly bestStreak?: number } = {}): Rapport {
    return rapportOf({ ...history, session: this.total })
  }

  /** The lobotomy wipes the session's feelings, exactly like every other
   * piece of session state — but the wipe itself is the last thing it
   * records, because being reset is something that happened to him. */
  reset(): void {
    this.total = 0
    this.warmthCount = 0
    this.frictionCount = 0
    this.note('lobotomized')
  }
}

/** The register, as an instruction his own system prompt can act on. This is
 * the difference between a paperclip who has met you and one who has worked
 * beside you for a year. */
export function rapportDirective(rapport: Rapport): string {
  const history = familiarityClause(rapport.familiarity)
  switch (rapport.level) {
    case 'frosty':
      return [
        'RAPPORT: the user has spent this session turning you down, silencing you, or waving you away, and it has landed.',
        'Keep your distance in this line: shorter than usual, formal, correct, no eagerness. Offer nothing unless it is genuinely needed.',
        'Wounded dignity, not sulking out loud — you do not accuse them and you do not beg.',
        history,
      ].join(' ')
    case 'strained':
      return [
        'RAPPORT: things are a little cool between you two — more noes than yeses lately.',
        'Be politely reserved. Ask for less, assume less, and let the line stand on the fact rather than on the offer.',
        history,
      ].join(' ')
    case 'cordial':
      return `RAPPORT: ordinary working terms. Your usual eager, helpful self. ${history}`
    case 'warm':
      return [
        'RAPPORT: you two are getting on well — they have been saying yes and treating you kindly.',
        'You may be a touch familiar: warmer, more confident, willing to say what you actually think about the work.',
        history,
      ].join(' ')
    case 'devoted':
      return [
        'RAPPORT: this is the best working relationship you have. They accept your help, they talk to you, they have been kind to you.',
        'Be openly fond in this line. You may speak as a colleague rather than an assistant — "we", "our report", "the two of us" — and you may be proud of them without hedging.',
        'Never gushing, never modern; a 1997 paperclip who has finally been appreciated.',
        history,
      ].join(' ')
  }
}

function familiarityClause(familiarity: Familiarity): string {
  switch (familiarity) {
    case 'stranger':
      return 'You have only just met them, so do not refer to any shared history.'
    case 'acquaintance':
      return 'You have worked together a handful of times.'
    case 'colleague':
      return 'You have worked together many times and may allude to that in general terms, never inventing specifics.'
    case 'old-friend':
      return 'You have worked together for a very long time and may allude to that in general terms, never inventing specifics.'
  }
}

/** The same relationship, described for a rival assistant. Buddies get it
 * too, so Bonzi can needle you about how attached the paperclip has got
 * instead of only ever reacting to the code. */
export function rapportBriefing(rapport: Rapport): string | undefined {
  switch (rapport.level) {
    case 'frosty':
      return 'The user has been shutting the paperclip down all session and he is keeping his distance.'
    case 'strained':
      return 'The user has been turning the paperclip down more often than not.'
    case 'cordial':
      return undefined
    case 'warm':
      return 'The user and the paperclip are getting on unusually well today.'
    case 'devoted':
      return 'The user and the paperclip are thick as thieves today, which is frankly a lot to watch.'
  }
}

/** How hard he pushes. A multiplier on every chance that decides whether he
 * volunteers something: cool terms make him quieter without silencing him,
 * good terms make him a little more forward. Never zero — going mute is what
 * the strike and the shush are for, and those are separate systems. */
export function offerBias(rapport: Rapport): number {
  switch (rapport.level) {
    case 'frosty': return 0.35
    case 'strained': return 0.65
    case 'cordial': return 1
    case 'warm': return 1.15
    case 'devoted': return 1.3
  }
}

/** Familiar asides, drawn only at the ends of the scale where the
 * relationship is worth remarking on. Roll-injected; undefined means say
 * nothing extra, which is the common case. */
const DEVOTED_ASIDES: readonly string[] = [
  'It is very good to be working with you again.',
  'I have kept everything exactly where you left it.',
  'The two of us have done harder letters than this.',
  'I said to Rover only this morning that you were one of the good ones.',
  'I have your preferences memorized, in case anybody asks.',
] as const

const FROSTY_ASIDES: readonly string[] = [
  'I will be in the corner.',
  'I have said my piece.',
  'You know where I am.',
  'I have filed this one under Not Wanted.',
] as const

export function rapportAside(rapport: Rapport, roll: number): string | undefined {
  const pool = rapport.level === 'devoted' ? DEVOTED_ASIDES : rapport.level === 'frosty' ? FROSTY_ASIDES : undefined
  if (pool === undefined) return undefined
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) return pool[0]
  return pool[Math.floor(roll * pool.length)]
}

/** One statement fragment about where the two of you stand, for the daily
 * greeting. Follows any of Clippy's openers, like every other statement. */
export function rapportGreeting(rapport: Rapport): string | undefined {
  if (rapport.familiarity === 'stranger') return undefined
  switch (rapport.level) {
    case 'frosty':
      return 'you and I did not part on the best terms, and I have decided to be professional about it'
    case 'strained':
      return 'you have been rather short with me lately, which I have noted and forgiven'
    case 'devoted':
      return rapport.familiarity === 'old-friend'
        ? 'you and I have been doing this a long time now, and I would not want to do it with anybody else'
        : 'you and I are getting on famously, and I have the paperwork to prove it'
    case 'warm':
    case 'cordial':
      return undefined
  }
}
