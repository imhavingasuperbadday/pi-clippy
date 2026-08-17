/** The session climate: what the environment actually feels like right now,
 * derived from one bounded evidence projection.
 *
 * This is the character layer's shared sense of the room. Before it existed,
 * mood was only a suggestion inside the system prompt, so the model picked an
 * emotional register at random — Clippy could be delighted three failed test
 * runs into a bad afternoon, and the buddies had no idea the session was
 * going badly at all.
 *
 * The climate is derived once per beat and handed to every generator, so
 * Clippy AND every buddy read the same room: the same mood, the same concrete
 * fact about what just happened. It is pure and unit-tested
 * (test/mood.test.ts); nothing here schedules, speaks, or remembers.
 */
import type { ClippyEvidence } from './context.ts'
import { latestOperationalBeat, latestTestOutcome } from './fallback.ts'

/** Clippy's register, and the room every buddy is reacting to. */
export type Mood =
  /** Things are fine and he is thrilled about it. */
  | 'delighted'
  /** Something real just went right — tests passed, a file landed. */
  | 'proud'
  /** Errors are stacking up; he is trying to be helpful about it. */
  | 'concerned'
  /** The SAME thing keeps failing. He has noticed. He mentions it. */
  | 'snippy'
  /** Everything has been failing, over and over, for a long time. The
   * paperclip has lost his temper — the only mood in which he swears. */
  | 'furious'
  /** A very long unbroken stretch — he worries about you, not the code. */
  | 'worried'
  /** Nothing is happening at all. */
  | 'bored'

export const MOODS: readonly Mood[] = ['delighted', 'proud', 'concerned', 'snippy', 'furious', 'worried', 'bored'] as const

export interface SessionClimate {
  readonly mood: Mood
  /** One concrete, neutral fact about the most recent operational event
   * ("the last test run reported failures"), or undefined when the session
   * has not done anything yet. Grounds a line in something real. */
  readonly beat: string | undefined
  /** Failing tool results at the tail of the session, consecutively. */
  readonly errorStreak: number
  /** How many times the most-repeated error signature has come back. */
  readonly repeatCount: number
  /** The most recent test outcome, when the session ran tests. */
  readonly tests: 'passing' | 'failing' | undefined
  /** Minutes of unbroken activity. */
  readonly activityMinutes: number
  /** The session has produced essentially nothing to talk about. */
  readonly quiet: boolean
}

/** A long grind: past this many minutes of unbroken work Clippy stops
 * worrying about the code and starts worrying about you. */
const MARATHON_MINUTES = 90
/** The same error coming back this many times is what makes him snippy —
 * this is the "you are fixing the same letter for the third time" trigger
 * the prompt always described but nothing ever detected. */
const REPEAT_THRESHOLD = 3
/** Consecutive failures that read as "this is going badly" rather than
 * "something failed once". */
const ERROR_STREAK_THRESHOLD = 2
/** Past this much repetition the paperclip stops being politely pointed and
 * actually loses his temper. Deliberately far above the snippy threshold:
 * fury is meant to be rare, not a second gear. */
const FURIOUS_REPEAT_THRESHOLD = 5
/** An unbroken run of failures this long reads as a session coming apart. */
const FURIOUS_STREAK_THRESHOLD = 6

/** Collapse an error message to a comparable signature: the wording that
 * stays the same when only line numbers, paths, and ids change. Without
 * this, "the same error again" is invisible — every occurrence looks new
 * because it carries a different offset. */
export function errorSignature(error: string): string {
  return error
    .toLowerCase()
    .replace(/0x[0-9a-f]+/gu, '#')
    .replace(/[\p{L}\p{N}_.@+-]*[\\/][\p{L}\p{N}_.@+\-\\/]*/gu, '@')
    .replace(/\b\d+\b/gu, '#')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 80)
}

/** How many times the most-repeated error signature appears. 1 means every
 * error was different; 3 means the same failure has come back twice. */
export function repeatedErrorCount(errors: readonly string[]): number {
  const counts = new Map<string, number>()
  let worst = 0
  for (const error of errors) {
    const signature = errorSignature(error)
    if (signature === '') continue
    const count = (counts.get(signature) ?? 0) + 1
    counts.set(signature, count)
    if (count > worst) worst = count
  }
  return worst
}

/** Failing tool results at the tail, consecutively — "how badly is it going
 * right now", as opposed to "did anything ever fail". */
export function trailingErrorStreak(evidence: ClippyEvidence): number {
  let streak = 0
  for (let index = evidence.recentTools.length - 1; index >= 0; index -= 1) {
    const tool = evidence.recentTools[index]
    if (tool === undefined || tool.outcome === 'running') continue
    if (tool.outcome !== 'error') break
    streak += 1
  }
  return streak
}

/** Read the room. Ordered most-specific first: a repeated failure outranks a
 * fresh one, a fresh failure outranks a success, and worrying about the
 * human outranks being pleased about the code. */
export function sessionClimate(evidence: ClippyEvidence): SessionClimate {
  const errorStreak = trailingErrorStreak(evidence)
  const repeatCount = repeatedErrorCount(evidence.recentErrors)
  const tests = latestTestOutcome(evidence)
  const quiet = evidence.recentTools.length === 0 && evidence.recentMessages.length <= 1
  const mood: Mood =
    repeatCount >= FURIOUS_REPEAT_THRESHOLD || errorStreak >= FURIOUS_STREAK_THRESHOLD ? 'furious'
    : repeatCount >= REPEAT_THRESHOLD ? 'snippy'
    : errorStreak >= ERROR_STREAK_THRESHOLD || tests === 'failing' ? 'concerned'
    : evidence.activityMinutes >= MARATHON_MINUTES ? 'worried'
    : tests === 'passing' ? 'proud'
    : quiet ? 'bored'
    : 'delighted'
  return {
    mood,
    beat: latestOperationalBeat(evidence),
    errorStreak,
    repeatCount,
    tests,
    activityMinutes: evidence.activityMinutes,
    quiet,
  }
}

/** The mood, as an instruction Clippy's own system prompt can act on. His
 * register is no longer a dice roll: it follows what the session is actually
 * doing, so he is pleased when something worked and quietly pointed when the
 * same thing has broken three times. */
export function moodDirective(climate: SessionClimate): string {
  switch (climate.mood) {
    case 'proud':
      return 'MOOD: something just went right. Be warm and a little proud of the user, like a paperclip admiring a very tidy letter. Praise the specific thing.'
    case 'concerned':
      return 'MOOD: things are going wrong right now. Stay cheerful and earnest, but be gently concerned and offer help with the mess — never smug, never gloating.'
    case 'snippy':
      return `MOOD: the SAME problem has come back ${climate.repeatCount} times. Be mildly, politely passive-aggressive about the repetition — the classic "you are fixing the same letter for the third time". Still helpful, never cruel.`
    case 'furious':
      return [
        `MOOD: this has now gone wrong ${Math.max(climate.repeatCount, climate.errorStreak)} times in a row and you have finally lost your temper.`,
        'You are not cheerful in this line. You are a small bent paperclip who has watched the same thing break over and over and is done being nice about it.',
        'Be blunt and short. Drop the sunny Office manner. You are angry at the situation, never cruel to the user.',
      ].join(' ')
    case 'worried':
      return `MOOD: the user has been going for about ${climate.activityMinutes} minutes without a break. Worry about the human, not the document. Suggest a rest, in Office terms.`
    case 'bored':
      return 'MOOD: nothing is happening. Be a little wistful and under-occupied, the way a paperclip is when there are no letters to clip.'
    case 'delighted':
      return 'MOOD: work is moving along nicely. Be delighted and eager, your default sunny self.'
  }
}

/** The same room, described for a rival assistant. Buddies get the climate
 * too, so a buddy can needle you about the build that just failed instead of
 * only ever reacting to whatever Clippy said. */
export function climateBriefing(climate: SessionClimate): string {
  const parts: string[] = []
  switch (climate.mood) {
    case 'proud':
      parts.push('Right now the session is going well — something just succeeded.')
      break
    case 'concerned':
      parts.push('Right now the session is going badly — things are failing.')
      break
    case 'snippy':
      parts.push(`Right now the same failure has come back ${climate.repeatCount} times and nobody has fixed it.`)
      break
    case 'worried':
      parts.push(`The user has been working for about ${climate.activityMinutes} minutes without a break.`)
      break
    case 'furious':
      parts.push(`The session has been failing over and over (${Math.max(climate.repeatCount, climate.errorStreak)} times) and even Clippy has lost his temper.`)
      break
    case 'bored':
      parts.push('Nothing is happening in the session at all right now.')
      break
    case 'delighted':
      parts.push('The session is moving along without drama.')
      break
  }
  if (climate.beat !== undefined) parts.push(`Most recent event: ${climate.beat}.`)
  return parts.join(' ')
}

/** Is this climate worth a buddy speaking up about on its own? Buddies react
 * to the session itself only when something actually happened — otherwise
 * they stay quiet instead of narrating an uneventful room. */
export function isRemarkable(climate: SessionClimate): boolean {
  return climate.mood === 'proud' || climate.mood === 'concerned'
    || climate.mood === 'snippy' || climate.mood === 'furious' || climate.mood === 'worried'
}
