/** Hats.
 *
 * A CSS overlay on the sprite, positioned by the client, decided here. The
 * cheapest charm in the whole extension: no new sprite art, no animation
 * work, and the paperclip in a party hat is worth more than most features
 * that took a week.
 *
 * One hat at a time, most specific first: your birthday beats December,
 * December beats the crown you earned. Pure and unit-tested
 * (test/hats.test.ts).
 */

export type Hat =
  /** Streak milestones and your install anniversary. */
  | 'party'
  /** All of December. */
  | 'santa'
  /** Late October. */
  | 'witch'
  /** A tiny crown, from the day the streak makes you management. */
  | 'crown'
  /** New Year's Eve into the small hours of the first. */
  | 'topper'

/** The streak at which the crown appears — the same rung of the ladder that
 * makes you a Senior Office Assistant in src/stats.ts. */
export const CROWN_STREAK = 30

export interface HatContext {
  readonly streak: number
  /** A milestone celebration is happening right now (party hat wins). */
  readonly celebrating?: boolean
}

/** Which hat the paperclip is wearing, if any. */
export function hatFor(date: Date, context: HatContext): Hat | undefined {
  if (context.celebrating === true) return 'party'
  const month = date.getMonth()
  const day = date.getDate()
  // New Year's Eve and New Year's Day: the top hat, briefly.
  if ((month === 11 && day === 31) || (month === 0 && day === 1)) return 'topper'
  if (month === 9 && day >= 24) return 'witch'
  if (month === 11) return 'santa'
  if (context.streak >= CROWN_STREAK) return 'crown'
  return undefined
}

/** The emoji the client renders as the overlay. Emoji rather than art keeps
 * this to one text node and a transform. */
export function hatGlyph(hat: Hat): string {
  switch (hat) {
    case 'party': return '🎉'
    case 'santa': return '🎅'
    case 'witch': return '🧙'
    case 'crown': return '👑'
    case 'topper': return '🎩'
  }
}

/** What he says the first time you see him in one, once per session. */
export function hatLine(hat: Hat): string {
  switch (hat) {
    case 'party': return 'I have put on a hat. It is a special occasion and I am aware of it.'
    case 'santa': return 'It is December. The hat is not optional; it is policy.'
    case 'witch': return 'I have dressed for the season. It is the only costume that fits a paperclip.'
    case 'crown': return 'You may have noticed the crown. I would rather not discuss how I earned it.'
    case 'topper': return 'Formal wear. It is the end of the year and standards must be maintained.'
  }
}
