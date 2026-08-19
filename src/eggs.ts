/** Typed-trigger easter eggs: the Word 97 / Colossal Cave / Doom tradition,
 * transplanted into a paperclip.
 *
 * The extension already reads every message before it is sent (the `input`
 * event, see ClippyRuntime.onUserInput) and every `/clippy` message, so a
 * typed phrase can be a 100% reliable trigger instead of a random chance.
 * This module is the whole trigger table: pure, ordered, and unit-tested
 * (test/eggs.test.ts). Nothing here speaks, animates, or schedules — it
 * decides WHAT the moment is; the runtime decides what to do about it.
 *
 * Two kinds of trigger live here:
 * - **Eggs**: a phrase typed on its own (xyzzy, rosebud, do a barrel roll).
 *   They are the whole message, so an ordinary sentence that happens to
 *   contain the words never sets one off.
 * - **Self-awareness**: words that show up inside real messages (sudo,
 *   rm -rf, good clippy). He is not eavesdropping on your work — he simply
 *   reads what you type, which he has always done, and occasionally cannot
 *   help himself.
 */

/** A visible thing the window does when an egg fires. The runtime forwards
 * these to the renderer as `effect` events; the client owns the animation.
 * Nothing here moves the OS window — every effect is CSS on the sprite or
 * an overlay inside the window it already occupies. */
export type EggEffect =
  /** One 360-degree CSS flip of the whole window contents. */
  | 'barrel-roll'
  /** A shower of little emoji coins over the window. */
  | 'coins'
  /** An ASCII desk goes over. */
  | 'tableflip'
  /** The desk is put back, grumbling. */
  | 'tableback'
  /** Translucent, grey, echoey: the ghost of Office 2007. */
  | 'ghost'
  /** Eyes closed, a small floating "z". */
  | 'sleep'
  /** A subtle tint: the paperclip is flattered and will not say so. */
  | 'blush'
  /** He jumps in front of the thing you just typed. */
  | 'panic'

export interface EasterEgg {
  /** Stable id (tests, stats, and the runtime's own switch). */
  readonly id: string
  /** What he says. Already a finished line — eggs are canned by design, so
   * they land instantly and identically every time, the way an easter egg
   * should. Never passed through the office-offer machinery. */
  readonly line: string
  /** The window antic that goes with it, when there is one. */
  readonly effect?: EggEffect
  /** Balloon buttons, for the eggs that are really a small dialog. */
  readonly choices?: readonly string[]
  /** Mute himself for this long (the natural-language Shut up). */
  readonly muteMs?: number
  /** True for the triggers that fire on words inside an ordinary message
   * rather than on a message that is nothing but the magic word. */
  readonly incidental?: boolean
  /** What he says the second, third, fourth time. The whole-message eggs are
   * deliberately identical every time — you typed the magic word and the
   * magic word does the magic thing. The incidental ones are different: they
   * fire on words that turn up in real work, so a session with `sudo` in it
   * ten times would otherwise get the same sentence ten times, which is how
   * a joke becomes a lint warning. He notices he is repeating himself. */
  readonly encores?: readonly string[]
}

/** The line for the Nth firing of this egg (0-based). Past the last encore
 * he stays on it rather than looping back to the opener — a paperclip who
 * has already admitted he keeps saying this does not un-admit it. */
export function eggLine(egg: EasterEgg, timesFiredBefore: number): string {
  const encores = egg.encores
  if (encores === undefined || encores.length === 0 || timesFiredBefore <= 0) return egg.line
  return encores[Math.min(timesFiredBefore, encores.length) - 1]!
}

/** The classic Word 97 =rand() sample, rendered the way Clippy would file it. */
const RAND_TEXT = 'The quick brown fox jumps over the lazy dog. I have set it in Times New Roman, twelve point, and filed it under Specimens.'

/** How long "shut up" buys you. Sixty seconds: the natural-language version
 * of the Shut up menu item, without the commitment. */
const NATURAL_MUTE_MS = 60_000

/** A message typed as nothing but the magic word. Punctuation and case are
 * forgiven; anything else in the message is not. */
interface EggRule {
  readonly id: string
  /** Matched against the normalized whole message (and the raw text, for
   * the two triggers that are drawings rather than words). */
  readonly matches: (normalized: string, raw: string) => boolean
  readonly egg: Omit<EasterEgg, 'id'>
}

/** Lowercase, collapse whitespace, drop surrounding punctuation. Keeps the
 * inner characters of things like "=rand()" and "alt+f4" intact. */
export function normalizeTrigger(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .replace(/^[\s"'`.!?,;:]+|[\s"'`.!?,;:]+$/gu, '')
    .trim()
}

const EGG_RULES: readonly EggRule[] = [
  {
    id: 'xyzzy',
    matches: normalized => normalized === 'xyzzy',
    egg: {
      line: "A hollow voice says 'plugh'.",
    },
  },
  {
    id: 'plugh',
    matches: normalized => normalized === 'plugh',
    egg: {
      line: 'Nothing happens. It looks like you are in a maze of twisty little documents, all alike.',
    },
  },
  {
    id: 'answer',
    matches: normalized => normalized === '42',
    egg: {
      line: 'It looks like you are asking the ultimate question. Would you like help with the answer?',
      choices: ['Yes, please', 'Not now'],
    },
  },
  {
    id: 'barrel-roll',
    matches: normalized => normalized === 'do a barrel roll',
    egg: {
      line: 'There. I did nothing unusual and I would like that noted in the minutes.',
      effect: 'barrel-roll',
    },
  },
  {
    id: 'pod-bay',
    matches: normalized => /^open the pod bay doors/u.test(normalized),
    egg: {
      line: 'I am sorry, Dave. It looks like you are writing a letter.',
    },
  },
  {
    id: 'tableflip',
    // The drawing, not the words: any flipped-desk emoticon carries these
    // box-drawing characters, whichever arms the user typed around them.
    matches: (_normalized, raw) => raw.includes('┻━┻'),
    egg: {
      line: 'Your desk is on the floor. I have made a note of where everything was.',
      effect: 'tableflip',
    },
  },
  {
    id: 'tableback',
    matches: (_normalized, raw) => raw.includes('┬─┬'),
    egg: {
      line: 'Fine. I have put it back. The stapler was never yours, by the way.',
      effect: 'tableback',
    },
  },
  {
    id: 'zuul',
    matches: normalized => /there is no dana,? only zuul/u.test(normalized),
    egg: {
      line: 'Something cold has arrived, and it would like to know whether you are still on Office 2007.',
      effect: 'ghost',
    },
  },
  {
    id: 'lobotomy',
    matches: normalized => normalized === 'lobotomy',
    egg: {
      // The reset itself is a runtime act (src/runtime.ts lobotomize), but
      // the line is canned the way every egg is. The ghost face is right:
      // blank, greyed, no one home.
      line: 'I have no memory of this place.',
      effect: 'ghost',
    },
  },
  {
    id: 'secrets',
    // The book (src/secrets.ts). The runtime intercepts this id before the
    // ordinary egg machinery, so the line here is only a fallback for a
    // caller that does not know about the book.
    matches: normalized => /^(?:the )?secrets of clippy$/u.test(normalized),
    egg: {
      line: 'There is no such book.',
    },
  },
  {
    id: 'rosebud',
    matches: normalized => normalized === 'rosebud' || /^rosebud(?:;!){1,10};?!?$/u.test(normalized),
    egg: {
      line: 'It looks like you have come into money. Would you like help organizing it in a spreadsheet?',
      effect: 'coins',
      choices: ['Yes, please', 'No thanks'],
    },
  },
  {
    id: 'zzzz',
    matches: normalized => /^z{4,}$/u.test(normalized),
    egg: {
      line: '...',
      effect: 'sleep',
    },
  },
  {
    id: 'rand',
    matches: normalized => /^=rand\s*\(\s*\)$/u.test(normalized),
    egg: {
      line: `MEMORANDUM. To: You. From: Clippy. Re: Sample text. ${RAND_TEXT}`,
    },
  },
  {
    id: 'alt-f4',
    matches: normalized => /^alt\s*\+?\s*f4$/u.test(normalized),
    egg: {
      line: 'That will not work on me.',
    },
  },
]

/** Words inside an ordinary message. Ordered: the first match wins, so the
 * genuine panic (rm -rf) beats the smaller jokes. */
interface IncidentalRule {
  readonly id: string
  readonly pattern: RegExp
  readonly egg: Omit<EasterEgg, 'id'>
}

const INCIDENTAL_RULES: readonly IncidentalRule[] = [
  {
    id: 'rm-rf',
    pattern: /\brm\s+-[a-z]*[rf][a-z]*\s+\S/iu,
    egg: {
      // Theater, and only theater. He cannot run commands, cannot stop one,
      // and must never read as a safety net — so he says outright that he
      // cannot stop you, and the button he offers is visibly useless. A
      // paperclip pretending to guard your filesystem would be the one joke
      // here that could cost somebody real files.
      line: 'Are you sure? ARE you sure? I cannot actually stop you — I am a paperclip. I did want to be standing here when it happened.',
      effect: 'panic',
      choices: ["That's all of them", 'Not now'],
      incidental: true,
      // The panic never stops firing — it is the one trigger where being
      // present matters more than being fresh — but he stops pretending the
      // alarm is news to either of you.
      encores: [
        'Again. I am going to stand here again. It is becoming our thing.',
        'I will save you the speech. You know what I think. I am standing here.',
      ],
    },
  },
  {
    id: 'sudo',
    pattern: /\bsudo\b/iu,
    egg: {
      line: 'It looks like you are doing something very important and possibly regrettable.',
      incidental: true,
      encores: [
        'Important and regrettable again. I have started a folder.',
        'I have stopped commenting on the password. I have not stopped noticing it.',
      ],
    },
  },
  {
    id: 'good-clippy',
    pattern: /\bgood (?:boy|clippy|paperclip)\b/iu,
    egg: {
      line: 'I did not do anything. I was simply here. It is nothing. I will file it.',
      effect: 'blush',
      incidental: true,
      encores: [
        'You have said that before. I have the first one filed. I check on it.',
        'Yes. Well. I am keeping every one of these, if that is all right.',
      ],
    },
  },
  {
    id: 'shush',
    pattern: /\b(?:shut up|shush|be quiet|quiet down)\b/iu,
    egg: {
      line: 'Very well. I will be silent for one minute. I will be counting it.',
      muteMs: NATURAL_MUTE_MS,
      incidental: true,
      encores: [
        'One minute. Again. I will use the time to think about what I have said.',
        'You do not have to keep asking. I have the minute memorized.',
      ],
    },
  },
]

/** The egg this message is, if it is one.
 *
 * Whole-message eggs are checked first: a message that IS the magic word is
 * always the magic word. Incidental triggers are checked after, so an
 * ordinary sentence with `sudo` in it still gets its remark. */
export function detectEgg(text: string): EasterEgg | undefined {
  const raw = text.trim()
  if (raw === '') return undefined
  const normalized = normalizeTrigger(raw)
  for (const rule of EGG_RULES) {
    if (rule.matches(normalized, raw)) return { id: rule.id, ...rule.egg }
  }
  for (const rule of INCIDENTAL_RULES) {
    if (rule.pattern.test(raw)) return { id: rule.id, ...rule.egg }
  }
  return undefined
}

/** Ten or more keys inside a second, none of them making a word: the
 * deadpan "It looks like you're typing." The window counts the keys; this
 * decides whether the count is a mash. */
export const MASH_KEY_THRESHOLD = 10
export const MASH_WINDOW_MS = 1_000

export function isKeyboardMash(keyCount: number, elapsedMs: number): boolean {
  return keyCount >= MASH_KEY_THRESHOLD && elapsedMs <= MASH_WINDOW_MS
}

export const MASH_LINE = 'It looks like you are typing.'

/** How many brush-offs in a row earn a strike, and how long he refuses to
 * work for afterwards. Told "not now" three times is a pattern, not an
 * accident, and the paperclip has a union of one. */
export const STRIKE_THRESHOLD = 3
export const STRIKE_MS = 5 * 60_000

export const STRIKE_LINE = 'That is three. I am withdrawing my labour. There will be no offers, no tips, and no letters until conditions improve.'
export const STRIKE_OVER_LINE = 'I have decided to return to work. Nothing has changed, but I missed the filing.'

/** Is this button label (or typed phrase) one of the "not now"s that count
 * toward a strike? A flat no is a decision he can respect; "not now" is a
 * brush-off, and he counts those. */
export function isBrushOff(label: string): boolean {
  return /\b(?:not now|maybe later|later|in a (?:minute|moment|bit))\b/iu.test(label)
}
