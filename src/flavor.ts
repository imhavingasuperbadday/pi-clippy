/** Clippy's spoken-line flavor: the paperclip used to open every line with
 * "It looks like" and close every other line with an offer question. This
 * module gives every canned line a varied, in-character way in (and, where
 * the caller opts in, lets a line stand as a plain remark with no question
 * at the end), so the desktop sounds like characters with a full range of
 * expression instead of one sentence template.
 *
 * Kept pure and roll-injected so a test can pin a line down exactly.
 */
import type { Mood } from './mood.ts'

/** Openers that can precede Clippy's lowercase statement fragments
 * ("you are grading a stack of letters", "your report looks tidy",
 * "{name} has opinions again"). The fragment is glued on verbatim; comma
 * openers carry their own punctuation. "It looks like" stays in the mix —
 * classic, but no longer the only way in. */
const OPENERS: readonly string[] = [
  'It looks like {f}',
  'So {f}',
  'Ah, {f}',
  'Well, {f}',
  'I see {f}',
  'Now {f}',
  'From where I sit, {f}',
  'Oh, {f}',
  'Hm, {f}',
  'I notice {f}',
  'Right, {f}',
  'Aha, {f}',
  'It appears {f}',
  'Unless I am mistaken, {f}',
  'If I may, {f}',
  'By my reckoning, {f}',
  'It seems {f}',
  'From here, {f}',
  'I could not help noticing {f}',
  'Between us, {f}',
  'Not to interrupt, but {f}',
  'One moment — {f}',
  'For the record, {f}',
  'Look at that, {f}',
] as const

/** The same job, in a particular register. A furious paperclip does not come
 * in with "From where I sit"; a bored one does not come in with "Right,".
 * When the caller knows the room (src/mood.ts), the way in matches it —
 * which is most of what makes a canned line sound felt rather than filled.
 *
 * These are drawn INSTEAD of the general pool, so each one is a way in this
 * mood would actually use; anything neutral enough for every mood belongs in
 * OPENERS above. */
const MOOD_OPENERS: Partial<Record<Mood, readonly string[]>> = {
  furious: [
    'Right. {f}',
    'No. {f}',
    'Enough. {f}',
    'Again. {f}',
    'Look. {f}',
    'I will say it plainly: {f}',
  ],
  snippy: [
    'Once more, {f}',
    'As I mentioned, {f}',
    'Again, and I did say, {f}',
    'For the third time, {f}',
    'Not that anybody asked, but {f}',
    'Noted, again: {f}',
  ],
  concerned: [
    'Oh dear, {f}',
    'Hm. {f}',
    'I am afraid {f}',
    'Now then, {f}',
    'That is not ideal: {f}',
  ],
  worried: [
    'If you do not mind my saying, {f}',
    'Forgive me, but {f}',
    'I have been watching the clock, and {f}',
    'Gently, now: {f}',
  ],
  proud: [
    'Would you look at that, {f}',
    'There we are, {f}',
    'Splendid — {f}',
    'Very good indeed: {f}',
    'Look at this, {f}',
  ],
  bored: [
    'Well. {f}',
    'Still, {f}',
    'Anyway, {f}',
    'In the meantime, {f}',
    'Nothing much, but {f}',
    'To pass the time: {f}',
  ],
  delighted: [
    'Oh good, {f}',
    'Marvellous, {f}',
    'Right then, {f}',
    'Here we go: {f}',
  ],
}

/** The pool a given register draws from. Mood pools are mixed with the
 * general ones rather than replacing them, so the classic ways in never stop
 * happening and no mood ever gets stuck with six lines. */
export function openersFor(mood?: Mood): readonly string[] {
  const flavored = mood === undefined ? undefined : MOOD_OPENERS[mood]
  return flavored === undefined ? OPENERS : [...flavored, ...OPENERS]
}

/** One opener drawn by roll ([0, 1)). All-caps fragments (Peedy shouting)
 * get an all-caps opener so his volume stays consistent. Pass the room's
 * mood to draw from that register's ways in. */
export function openWith(fragment: string, roll: number = Math.random(), mood?: Mood): string {
  const pool = openersFor(mood)
  const template = pool[Math.floor(roll * pool.length)] ?? pool[0]!
  const [prefix, suffix = ''] = template.split('{f}')
  const head = prefix ?? ''
  const shouting = /[A-Za-z]/u.test(fragment) && fragment === fragment.toUpperCase()
  // Some ways in are a whole sentence of their own ("Right." "Enough."), and
  // the statement that follows one starts a NEW sentence — it has to be
  // capitalized, or the balloon reads "Enough. you have broken it again."
  const body = /[.!?]\s*$/u.test(head) ? capitalize(fragment) : fragment
  return `${shouting ? head.toUpperCase() : head}${body}${suffix}`
}

function capitalize(text: string): string {
  const first = text.charAt(0)
  return first === '' ? text : `${first.toUpperCase()}${text.slice(1)}`
}

/** Only the characters that are actually special. Deliberately NOT a blanket
 * escape: in unicode mode an escape like `\-` (or `\—`) is a syntax error,
 * not a harmless belt-and-braces, and the openers contain both. */
function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/** Matches any opener (case-insensitive) at the start of a spoken line, so
 * the subject of a shown balloon can still be pulled back out of it
 * (src/nag.ts offerSubjectOf) no matter which way in Clippy picked.
 *
 * DERIVED from the opener pools rather than written out a second time: the
 * hand-maintained version silently fell behind every time a way in was
 * added, and a subject that keeps its opener nags about the wrong thing.
 * Longest first, so "I see" wins over "I" and the whole opener is eaten. */
export const OPENER_PREFIX = new RegExp(
  `^(?:${[...new Set([...OPENERS, ...Object.values(MOOD_OPENERS).flat()])]
    .map(template => (template.split('{f}')[0] ?? '').trim())
    .filter(head => head !== '')
    .sort((a, b) => b.length - a.length)
    .map(escapeForRegex)
    .join('|')})\\s+`,
  'iu',
)

export interface FlavorOptions {
  /** Chance ([0, 1)) that a trailing "Would you like help ...?" is dropped,
   * so the line stands as a plain remark with no question at the end.
   * 0 (the default) keeps every question — nag lines must always ask. */
  readonly dropQuestionChance?: number
  /** The room, when the caller has read it: the re-dressed line comes in
   * the way that register would come in. */
  readonly mood?: Mood
}

/** A trailing classic offer question, matched end-to-end so only a question
 * that IS the ending is dropped (an aside after it keeps the question). */
const TRAILING_OFFER = /\s*would you like help[^.!?]*[.!?]?\s*$/iu

/** Re-dress one canned line: a varied opener in place of the usual "It
 * looks like", and (when opted in) a chance to leave the closing question
 * off entirely. Lines that never had either pass through untouched. */
export function flavorize(
  line: string,
  options: FlavorOptions = {},
  random: () => number = Math.random,
): string {
  let flavored = line
  if ((options.dropQuestionChance ?? 0) > 0 && random() < options.dropQuestionChance!) {
    // Strip whatever punctuation the question was hanging off, then give the
    // remark its own full stop: a line that ends bare reads as a truncation
    // rather than as a paperclip choosing not to ask this time.
    const dropped = flavored.replace(TRAILING_OFFER, '').replace(/[.!?,;\s]+$/u, '')
    if (dropped.trim() !== '') flavored = `${dropped}.`
  }
  const match = /^It looks like\s+/iu.exec(flavored)
  if (match !== null) {
    flavored = openWith(flavored.slice(match[0].length), random(), options.mood)
  }
  return flavored
}
