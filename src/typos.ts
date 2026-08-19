/** Deliberate typos: the meta-game.
 *
 * Rarely, a balloon ships with one planted typo. Call it out in a /clippy
 * message and he is mortified, corrects himself, and the catch is counted
 * forever in the stats file. That is the entire feature — no new machinery,
 * one substitution on the way out and one pattern on the way in.
 *
 * The plant is deliberately conservative: one word, one occurrence, only in
 * lines long enough that the typo reads as a slip rather than as the joke.
 * Pure and unit-tested (test/typos.test.ts).
 */

/** How often a line ships with a planted typo. Rare enough that catching
 * one feels like catching him. */
export const TYPO_CHANCE = 0.04

/** The typo table: the correct word, and the way a paperclip would get it
 * wrong. Classic transpositions only — nothing that changes the meaning,
 * and nothing that could be mistaken for a real instruction. */
const TYPOS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bthe\b/u, 'teh'],
  [/\band\b/u, 'adn'],
  [/\byou\b/u, 'yuo'],
  [/\bthat\b/u, 'taht'],
  [/\bwith\b/u, 'wiht'],
  [/\bwould\b/u, 'wodul'],
  [/\bletter\b/u, 'lettre'],
  [/\bfiling\b/u, 'filign'],
  [/\bspreadsheet\b/u, 'spreadhseet'],
]

/** Lines shorter than this are left alone: a typo in a four-word balloon is
 * the whole balloon, and the gag only works when it is a slip. */
const MIN_WORDS_FOR_TYPO = 8

export interface PlantedTypo {
  readonly text: string
  /** The word as it should have been, so the correction can name it. */
  readonly correct: string
  /** The word as it went out. */
  readonly wrong: string
}

/** Maybe plant one typo. Returns undefined when the line is left alone,
 * which is almost always. `roll` and `pick` are injected so a test can pin
 * the outcome exactly. */
export function plantTypo(
  line: string,
  roll: number = Math.random(),
  pick: number = Math.random(),
): PlantedTypo | undefined {
  if (roll >= TYPO_CHANCE) return undefined
  if (line.trim().split(/\s+/u).length < MIN_WORDS_FOR_TYPO) return undefined
  const candidates = TYPOS.filter(([pattern]) => pattern.test(line))
  if (candidates.length === 0) return undefined
  const chosen = candidates[Math.floor(pick * candidates.length)] ?? candidates[0]!
  const [pattern, wrong] = chosen
  const match = pattern.exec(line)
  if (match === null) return undefined
  return {
    text: line.replace(pattern, wrong),
    correct: match[0],
    wrong,
  }
}

/** Is the user calling him out on the typo he just made? Deliberately
 * generous: any message that names the wrong word, or that says "typo",
 * counts — being pedantic about the pedantry would defeat the point.
 * The misspell family matches its inflections too: "you misspelled that"
 * is the most natural way to catch him, and it never names the word. */
export function isTypoCallout(message: string, planted: PlantedTypo | undefined): boolean {
  if (planted === undefined) return false
  const text = message.toLowerCase()
  if (text.includes(planted.wrong.toLowerCase())) return true
  return /\b(?:typo|misspell(?:ed|ing)?|mispell(?:ed|ing)?|misspelt|spelling|you spelled|spelt)\b/u.test(text)
}

/** The mortified correction. He is a spell-checker by trade; this is the
 * worst thing that has ever happened to him. */
export function mortifiedLine(planted: PlantedTypo, caughtTotal: number): string {
  const base = `I said "${planted.wrong}". I meant "${planted.correct}". I am a spelling and grammar assistant and I said "${planted.wrong}".`
  if (caughtTotal <= 1) return `${base} Please do not tell the others.`
  if (caughtTotal < 5) return `${base} That is ${caughtTotal} you have caught. I am keeping the list too.`
  return `${base} That is ${caughtTotal}. I have stopped being embarrassed and started being impressed.`
}
