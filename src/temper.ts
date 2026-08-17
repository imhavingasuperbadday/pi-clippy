/** Clippy's temper: the one part of him that is not cheerful.
 *
 * The paperclip is relentlessly nice, which is exactly why the rare moment
 * he snaps has to be earned. Anger here needs BOTH halves of a bad day:
 * a session that keeps breaking in the same place (the furious climate,
 * src/mood.ts) and a personal grievance — offers refused, tips silenced,
 * questions ignored. Only then may he swear, and even then only sometimes.
 *
 * Pure and unit-tested (test/temper.test.ts): nothing here speaks or
 * schedules; the runtime owns the grievance counter and the balloons.
 */
import type { SessionClimate } from './mood.ts'

/** Refusals/snoozes/ignored questions before he takes it personally. */
export const GRIEVANCE_ANGRY = 3
/** The point where a bad session plus a bad mood earns the strong word. */
export const GRIEVANCE_SEETHING = 5
/** How often a furious line actually carries a swear. Rare on purpose: the
 * joke is that Clippy almost never does this, not that he now does. */
export const SWEAR_CHANCE = 0.25
/** Of the lines that do swear, how often it is the strong one. */
export const STRONG_SWEAR_CHANCE = 0.3

/** Is the paperclip genuinely, unusually angry right now? A furious room on
 * its own is a bad afternoon; a furious room plus being ignored all session
 * is what makes him lose it. */
export function isFurious(climate: SessionClimate | undefined, grievance: number): boolean {
  if (climate === undefined) return false
  if (climate.mood === 'furious') return true
  return grievance >= GRIEVANCE_ANGRY && (climate.mood === 'snippy' || climate.mood === 'concerned')
}

/** May this line swear? Requires the user to have left profanity on, real
 * fury, and a rare roll. `roll` is injected so the decision is testable. */
export function swearingAllowed(
  options: { readonly profanity: boolean; readonly climate: SessionClimate | undefined; readonly grievance: number; readonly roll: number },
): boolean {
  if (!options.profanity) return false
  if (!isFurious(options.climate, options.grievance)) return false
  return options.roll < SWEAR_CHANCE
}

/** How hard he is allowed to swear: mild by default, and the strong word
 * only once the grievance has really piled up. */
export function swearStrength(grievance: number, roll: number): 'mild' | 'strong' {
  return grievance >= GRIEVANCE_SEETHING && roll < STRONG_SWEAR_CHANCE ? 'strong' : 'mild'
}

/** The prompt clause that lets the model swear — added ONLY on the rare
 * lines that earned it, so the default prompt stays clean and Clippy stays
 * a 1997 Office Assistant the other 99% of the time. */
export function swearingDirective(strength: 'mild' | 'strong'): string {
  return strength === 'strong'
    ? 'PROFANITY: you have completely lost it. You may use exactly one strong swear word (for example "for fuck\'s sake") in this line, aimed at the situation and never at the user. One. Not two. Then stop.'
    : 'PROFANITY: you are allowed exactly one mild swear word in this line (damn, damn it, hell, bloody, goddamn), aimed at the situation and never at the user. One only, and keep the rest of the line clean.'
}

/** Canned angry lines, used when the model is unavailable and Clippy still
 * has to say something. The swearing pool is only ever drawn from when
 * `swearingAllowed` said yes. */
const ANGRY_LINES = [
  'you have broken this in exactly the same place again, and I am no longer being cheerful about it',
  'you and I have been here before, several times, and I have stopped counting on purpose',
  'you keep unfiling everything I file, and I am aware of how that sounds',
] as const

const MILD_SWEAR_LINES = [
  'you have broken the damn thing again, and I have run out of nice ways to say it',
  'your build is broken to hell and back, and I am too tired to offer you a memo about it',
  'you have failed the bloody test again, and I did mention it the first four times',
] as const

const STRONG_SWEAR_LINES = [
  "you have hit the same error again and, oh, for fuck's sake, I am a paperclip and even I have limits",
] as const

/** One angry statement in Clippy's voice, at the given heat. A bare
 * statement beginning with "you" (no trailing punctuation), exactly like
 * every other statement, so the usual balloon rendering wraps it as normal. */
export function angryStatement(
  strength: 'clean' | 'mild' | 'strong',
  roll: number,
): string {
  const pool = strength === 'strong' ? STRONG_SWEAR_LINES : strength === 'mild' ? MILD_SWEAR_LINES : ANGRY_LINES
  return pool[Math.floor(roll * pool.length)] ?? pool[0]!
}
