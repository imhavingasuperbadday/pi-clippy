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

/** Which way the room is going, independent of where it currently is. The
 * mood says "things are failing"; the trend says whether they are failing
 * less than they were ten tool calls ago. A paperclip who cannot tell a
 * recovery from a collapse is reading half the room. */
export type ClimateTrend = 'improving' | 'steady' | 'worsening'

export interface SessionClimate {
  readonly mood: Mood
  /** How strongly the mood is felt, in [0, 1]. The mood is a category; this
   * is the volume knob on it — the difference between two failures in a row
   * and a session that has failed nine times without pause. Everything that
   * used to treat "concerned" as one flat value (the prompt directive, the
   * mood ring) can now say how concerned. */
  readonly intensity: number
  /** Whether the tail of the session is going better or worse than the
   * stretch before it. */
  readonly trend: ClimateTrend
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

/** How many finished tool results are enough to compare a "before" and an
 * "after" at all. Below this, a trend would be one unlucky call. */
const TREND_MIN_SAMPLES = 4

/** Which way the session is going: the failure rate over the tail, against
 * the failure rate over the stretch before it. Pure, and deliberately
 * coarse — the point is "recovering" versus "coming apart", not a gradient.
 * Running calls are skipped: an unfinished command is not yet evidence of
 * anything. */
export function climateTrend(evidence: ClippyEvidence): ClimateTrend {
  const finished = evidence.recentTools.filter(tool => tool.outcome !== 'running')
  if (finished.length < TREND_MIN_SAMPLES) return 'steady'
  const split = Math.floor(finished.length / 2)
  const rate = (tools: readonly { readonly outcome: string }[]): number =>
    tools.length === 0 ? 0 : tools.filter(tool => tool.outcome === 'error').length / tools.length
  const before = rate(finished.slice(0, split))
  const after = rate(finished.slice(split))
  // A quarter of the window has to change hands before it counts, so one
  // flaky call in a run of eight does not read as a collapse.
  if (after > before + 0.25) return 'worsening'
  if (before > after + 0.25) return 'improving'
  return 'steady'
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.round(Math.min(max, Math.max(min, value)) * 100) / 100
}

/** How hard the room is being felt, for the mood it resolved to. Each mood
 * scales off whatever actually earns it: fury off repetition, worry off the
 * clock, concern off the streak. Bounded to [0, 1]. */
export function moodIntensity(
  mood: Mood,
  facts: { readonly errorStreak: number; readonly repeatCount: number; readonly activityMinutes: number; readonly tests: 'passing' | 'failing' | undefined },
): number {
  switch (mood) {
    case 'furious':
      return bounded(Math.max(facts.repeatCount / 8, facts.errorStreak / 10), 0.6, 1)
    case 'snippy':
      return bounded((facts.repeatCount - REPEAT_THRESHOLD + 1) / 3, 0.35, 1)
    case 'concerned':
      return bounded(Math.max(facts.errorStreak / FURIOUS_STREAK_THRESHOLD, facts.tests === 'failing' ? 0.5 : 0), 0.3, 0.9)
    case 'worried':
      return bounded((facts.activityMinutes - MARATHON_MINUTES) / 120 + 0.3, 0.3, 1)
    case 'proud':
      return bounded(0.7, 0, 1)
    case 'bored':
      return bounded(0.4, 0, 1)
    case 'delighted':
      return bounded(0.3, 0, 1)
  }
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
    intensity: moodIntensity(mood, { errorStreak, repeatCount, activityMinutes: evidence.activityMinutes, tests }),
    trend: climateTrend(evidence),
    beat: latestOperationalBeat(evidence),
    errorStreak,
    repeatCount,
    tests,
    activityMinutes: evidence.activityMinutes,
    quiet,
  }
}

/** The trend, as one clause a line can be hung on — or nothing at all when
 * the room is holding steady, which is most of the time. */
export function trendClause(climate: SessionClimate): string | undefined {
  if (climate.trend === 'steady') return undefined
  return climate.trend === 'improving'
    ? 'It has been getting BETTER over the last few steps — say so, in your own way.'
    : 'It has been getting WORSE over the last few steps — say so, in your own way.'
}

/** The mood, as an instruction Clippy's own system prompt can act on. His
 * register is no longer a dice roll: it follows what the session is actually
 * doing, so he is pleased when something worked and quietly pointed when the
 * same thing has broken three times. */
export function moodDirective(climate: SessionClimate): string {
  return [baseMoodDirective(climate), intensityClause(climate), trendClause(climate)]
    .filter((part): part is string => part !== undefined)
    .join(' ')
}

/** How loudly the mood is being felt, said in a way a line can act on. The
 * middle of the range says nothing: an ordinary amount of an ordinary mood
 * needs no extra instruction. */
function intensityClause(climate: SessionClimate): string | undefined {
  if (climate.mood === 'delighted' || climate.mood === 'bored') return undefined
  if (climate.intensity >= 0.85) return 'This feeling is at its strongest — do not soften it.'
  if (climate.intensity <= 0.4) return 'Only faintly, though: understate it rather than making a scene.'
  return undefined
}

function baseMoodDirective(climate: SessionClimate): string {
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
  if (climate.trend === 'improving') parts.push('It has been getting better over the last few steps.')
  else if (climate.trend === 'worsening') parts.push('It has been getting worse over the last few steps.')
  if (climate.beat !== undefined) parts.push(`Most recent event: ${climate.beat}.`)
  return parts.join(' ')
}

/** Is this climate worth a buddy speaking up about on its own? Buddies react
 * to the session itself only when something actually happened — otherwise
 * they stay quiet instead of narrating an uneventful room. */
export function isRemarkable(climate: SessionClimate): boolean {
  return climate.mood === 'proud' || isNotableMood(climate.mood)
}

/** Moods that read as "something is actually going wrong" rather than a
 * routine or empty register. Shared with the runtime's mood-ring smoothing:
 * a room that just calmed down from one of these gets one beat of doubt
 * before the visible mood actually changes (see `ClippyRuntime`), so a
 * single quiet tool call cannot flicker the color back and forth. */
export function isNotableMood(mood: Mood): boolean {
  return mood === 'concerned' || mood === 'snippy' || mood === 'furious' || mood === 'worried'
}

/** The mood ring: the balloon's border colour, so the climate the extension
 * computes every beat is finally something you can SEE. The mood system has
 * always been derived and handed to every generator, but it was invisible
 * unless you happened to notice the register of a line; this is the same
 * information, readable at a glance.
 *
 * Colours are the Office-era palette, kept muted so the classic yellow
 * balloon still reads as the classic yellow balloon. */
export function moodColor(mood: Mood): string {
  switch (mood) {
    case 'proud': return '#2e7d32'
    case 'delighted': return '#1a6fb5'
    case 'concerned': return '#b8860b'
    case 'snippy': return '#c05621'
    case 'furious': return '#a02020'
    case 'worried': return '#6a4fa3'
    case 'bored': return '#7a7a7a'
  }
}

/** The ring, now that the climate has a volume as well as a name: the same
 * Office-era colour, plus how heavily to draw it. A session two failures
 * deep and a session nine failures deep were previously the identical shade
 * of amber; the border weight is what tells them apart at a glance.
 *
 * Returned as plain numbers so the window can render it however it likes
 * and the server half stays free of CSS. */
export interface MoodRing {
  readonly mood: Mood
  readonly color: string
  /** Border width in CSS pixels, 2 (the classic balloon) to 4. */
  readonly width: number
  /** Halo opacity, 0 (none) to 0.45. Zero for the calm moods, so an
   * ordinary working session looks exactly as it always has. */
  readonly glow: number
}

export function moodRing(mood: Mood, intensity: number): MoodRing {
  const felt = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0
  const notable = isNotableMood(mood)
  return {
    mood,
    color: moodColor(mood),
    width: notable ? Math.round((2 + felt * 2) * 10) / 10 : 2,
    glow: notable ? Math.round(felt * 0.45 * 100) / 100 : 0,
  }
}
