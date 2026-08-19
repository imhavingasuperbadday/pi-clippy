/** Fixed Office-era lens and strict model-output boundary.
 * Ported from dsh-clippy (MIT), xlr8harder/dsh-clippy; the spoken-line
 * variety (openers, plain no-question remarks) is this extension's own.
 */
import { openWith } from './flavor.ts'
import type { Mood } from './mood.ts'

export const OFFICE_OFFERS = {
  letter: 'writing a letter',
  resume: 'drafting a résumé',
  memo: 'preparing a memo',
  report: 'creating a report',
  agenda: 'making a meeting agenda',
  presentation: 'building a presentation',
  newsletter: 'designing a newsletter',
  spreadsheet: 'organizing this in a spreadsheet',
  chart: 'turning this into a chart',
  envelope: 'addressing an envelope',
  label: 'printing some labels',
  fax: 'creating a fax cover sheet',
  email: 'formatting a follow-up email',
  filing: 'creating a filing system for this',
  minutes: 'taking minutes for this discussion',
  dictation: 'transcribing your dictation',
  binder: 'binding this into a report',
  folder: 'placing this in a labeled folder',
  hardcopy: 'printing a hard copy for your records',
  glossary: 'correcting your grammar in a memo',
  apology: 'drafting an apology letter to the computer',
  labelfile: 'naming this file something more professional',
} as const

export type OfficeTask = keyof typeof OFFICE_OFFERS
export const STATEMENT_KINDS = ['diagnosis', 'observation', 'workflow'] as const
export type StatementKind = (typeof STATEMENT_KINDS)[number]
const STATEMENT_KIND_SET = new Set<string>(STATEMENT_KINDS)

export interface ClippyDraft {
  readonly kind: StatementKind
  readonly statement: string
  /** The model's own short words for the option buttons, when Clippy asks. */
  readonly choices?: readonly string[]
  /** A desktop-mate Clippy decided, in character, to drag into the moment. */
  readonly summon?: string
  /** The real work behind the Office joke, written as one plain instruction
   * for the pi coding agent. Present only when Clippy's offer maps to
   * something the actual agent should do; the host SHOWS this text in the
   * balloon and only sends it after the user presses the button. */
  readonly request?: string
}

/** A balloon ready for the renderer: spoken text plus the clickable options
 * (present only when Clippy is actually asking) and any in-character impulse
 * (summoning a rival) to act on after the line lands. */
export interface ClippyBalloon {
  readonly text: string
  readonly choices?: readonly string[]
  readonly summon?: string
  /** See ClippyDraft.request. The runtime renders it into the visible line
   * and delivers it verbatim into the pi session when the offer is accepted. */
  readonly request?: string
}

/** What a quiet background thought decided to do (see generateIdleThought
 * in src/generator.ts): Clippy, idle and unobserved, either starts a chat
 * with one of the rival assistants, offers help, says one small thing, or
 * keeps his peace. The runtime validates the agent against the configured
 * roster before any window opens — a thought never summons on its own. */
export type IdleThoughtAction = 'chat' | 'offer' | 'remark' | 'nothing'

export interface IdleThought {
  readonly action: IdleThoughtAction
  /** For chat: the rival Clippy decided to call over. */
  readonly agent?: string
  /** What he decided to say out loud (a lowercase phrase that follows
   * "It looks like"); empty for nothing. */
  readonly statement: string
}

export const OFFICE_TASKS = Object.freeze(Object.keys(OFFICE_OFFERS) as OfficeTask[])
const MAX_STATEMENT_CHARS = 140

/** A refusal-flavored option label (No, Not now, I will pass...). Every
 * choice set must carry one: the option buttons are a real decision, not a
 * rubber stamp full of Yes. */
export const REFUSAL_LABEL = /(?:^|\s)(?:no\b|nope|nah|not\b|skip|pass|later|never|nothing)/iu

const MAX_CHOICES = 3
const MAX_CHOICE_CHARS = 18

/** Desired summon: a well-formed agent name (validated against the
 * configured cameos by the runtime, never blindly trusted). */
export function normalizeSummon(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const agent = raw.trim().toLowerCase()
  return /^[a-z][a-z0-9_-]{1,15}$/u.test(agent) ? agent : undefined
}

/** The model's own words for the option buttons, validated. A valid set has
 * 2-3 distinct labels, each short enough for a classic balloon button, and
 * always includes a refusal-flavored label. Anything else is dropped so a
 * bad choices field never wastes a balloon on a retry. */
export function normalizeChoices(raw: unknown): readonly string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const labels = raw
    .filter((label): label is string => typeof label === 'string')
    .map(label => label.replace(/\s+/gu, ' ').trim().replace(/[.!?]+$/u, ''))
    .filter(label => label.length > 0 && label.length <= MAX_CHOICE_CHARS)
  const unique = [...new Set(labels)]
  if (unique.length < 2 || unique.length > MAX_CHOICES) return undefined
  if (!unique.some(label => REFUSAL_LABEL.test(label))) return undefined
  return unique
}

/** How long a drafted pi request may be. Long enough for a real instruction
 * with a file name in it, short enough to read inside a speech balloon before
 * pressing the button that sends it. */
export const MIN_REQUEST_CHARS = 12
export const MAX_REQUEST_CHARS = 240

/** The real request behind an Office offer, validated.
 *
 * This is the one piece of model output that can become a message in the
 * user's own session, so it is squeezed into something a person can read and
 * consent to in one glance: a single line of plain prose, no code fences, no
 * control characters, no smuggled newlines that could hide a second
 * instruction below the visible one. Anything else is dropped, and the offer
 * simply falls back to Clippy doing the work himself. */
export function normalizeRequest(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const request = raw
    .replace(/```[a-z]*/giu, ' ')
    // Every whitespace run (newlines included) collapses to one space, so the
    // string the user reads is the whole string that gets sent.
    .replace(/[\s\u0000-\u001f]+/gu, ' ')
    .trim()
  if (request.length < MIN_REQUEST_CHARS || request.length > MAX_REQUEST_CHARS) return undefined
  // It has to read as a sentence a person would type, not as a payload.
  if (!/[a-z]/iu.test(request)) return undefined
  return request
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unwrapJson(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu)
  return fenced?.[1] ?? trimmed
}

/** Parse a background-thought decision. The action is the whole point, so
 * a malformed thought fails rather than being guessed at: the generator
 * degrades the failure to `nothing`, and Clippy keeps waiting. */
export function parseIdleThought(raw: string): IdleThought {
  let parsed: unknown
  try {
    parsed = JSON.parse(unwrapJson(raw))
  } catch (error: unknown) {
    throw new Error('Clippy idle thought is not valid JSON', { cause: error })
  }
  if (!plainRecord(parsed)) throw new Error('Clippy idle thought must be a JSON object')
  const action = parsed.action
  if (action !== 'chat' && action !== 'offer' && action !== 'remark' && action !== 'nothing') {
    throw new Error('Clippy idle thought action must be chat, offer, remark, or nothing')
  }
  const isChat = action === 'chat'
  const agent = normalizeSummon(parsed.agent)
  if (isChat && agent === undefined) {
    throw new Error('Clippy chat thought must name a rival assistant')
  }
  const rawStatement = typeof parsed.statement === 'string'
    ? parsed.statement.replace(/\s+/gu, ' ').trim()
    : ''
  let statement = action === 'nothing' ? '' : rawStatement
  if (statement !== '') {
    const asksQuestion = /\?\s*$/u.test(statement) || /would you like (?:help|me to)/iu.test(statement)
    statement = statement.replace(/[.!]+$/u, '')
    if (asksQuestion) statement += '?'
    if (statement.length === 0 || statement.length > MAX_STATEMENT_CHARS) {
      throw new Error(`Clippy idle thought statement must contain 1-${MAX_STATEMENT_CHARS} characters`)
    }
  }
  return {
    action: action as IdleThoughtAction,
    ...(isChat && agent !== undefined ? { agent } : {}),
    statement,
  }
}

/** Parse one short model draft while tolerating harmless legacy fields. */
export function parseClippyDraft(raw: string): ClippyDraft {
  let parsed: unknown
  try {
    parsed = JSON.parse(unwrapJson(raw))
  } catch (error: unknown) {
    throw new Error('Clippy model output is not valid JSON', { cause: error })
  }
  if (!plainRecord(parsed)) throw new Error('Clippy model output must be a JSON object')
  if (typeof parsed.kind !== 'string' || !STATEMENT_KIND_SET.has(parsed.kind)) {
    throw new Error(`Clippy kind must be one of: ${STATEMENT_KINDS.join(', ')}`)
  }
  if (typeof parsed.statement !== 'string') throw new Error('Clippy statement must be a string')
  let statement = parsed.statement.replace(/\s+/gu, ' ').trim()
  const asksQuestion = /\?\s*$/u.test(statement) || /would you like (?:help|me to)/iu.test(statement)
  // His own trailing question mark is allowed (that is how he offers help);
  // stray periods/bangs are dropped like before.
  statement = statement.replace(/[.!]+$/u, '')
  if (statement.length === 0 || statement.length > MAX_STATEMENT_CHARS) {
    throw new Error(`Clippy statement must contain 1-${MAX_STATEMENT_CHARS} characters`)
  }
  const beginsWithYou = /^you(?:'|\s|$)/u.test(statement)
  const beginsWithYourSubject = parsed.kind === 'observation' && /^your\s+\S+/u.test(statement)
  if (!beginsWithYou && !beginsWithYourSubject) {
    throw new Error('Clippy statement must begin with you, or your plus a subject for an observation')
  }
  const choices = normalizeChoices(parsed.choices)
  const summon = normalizeSummon(parsed.summon)
  // A request only means anything alongside buttons: it is what the accepted
  // button sends. Without a question to accept there is nothing to send, so a
  // stray request is dropped rather than kept for a later, unrelated yes.
  const request = choices === undefined ? undefined : normalizeRequest(parsed.request)
  // A question Clippy cannot be answered (no buttons) is downgraded to a
  // plain statement — he never asks something hollow.
  const finalStatement = asksQuestion && choices === undefined ? statement.replace(/\?\s*$/u, '') : statement
  return {
    kind: parsed.kind as StatementKind,
    statement: finalStatement,
    ...(choices === undefined ? {} : { choices }),
    ...(summon === undefined ? {} : { summon }),
    ...(request === undefined ? {} : { request }),
  }
}

/** Choose uniformly from the full taxonomy while preserving recent-offer diversity. */
export function chooseRandomOfficeTask(recent: readonly OfficeTask[], roll: number): OfficeTask {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) {
    throw new RangeError('Clippy diversity roll must be in the range [0, 1)')
  }
  const nonRepeating = OFFICE_TASKS.filter(task => !recent.includes(task))
  const choices = nonRepeating.length === 0 ? OFFICE_TASKS : nonRepeating
  return choices[Math.floor(roll * choices.length)]!
}

export function renderClippyResponse(
  draft: Pick<ClippyDraft, 'statement'> & { readonly officeTask: OfficeTask },
  random: () => number = Math.random,
  /** The room, when the caller has read it: the line comes in the way that
   * register would come in (src/flavor.ts). */
  mood?: Mood,
): string {
  return renderClippyResponseWithOffer({ statement: draft.statement, offer: OFFICE_OFFERS[draft.officeTask] }, random, mood)
}

export function renderClippyResponseWithOffer(
  draft: Pick<ClippyDraft, 'statement'> & { readonly offer: string },
  random: () => number = Math.random,
  mood?: Mood,
): string {
  const spoken = `${openWith(draft.statement, random(), mood)}.`
  // Sometimes he just says his piece and leaves it there: no offer, no
  // question, no buttons — a plain remark instead of another pitch.
  if (random() < PLAIN_REMARK_CHANCE) return spoken
  return `${spoken} Would you like help ${draft.offer}?`
}

/** How often a canned office offer is skipped in favor of a plain remark. */
export const PLAIN_REMARK_CHANCE = 0.4

/** Classic Clippy sign-off asides, in the real paperclip's voice: simple,
 * cheerful, a little dim, occasionally passive-aggressive. They surface on
 * some single-line balloons so his personality shows through. */
const PERSONALITY_ASIDES = [
  'I will be right here if you need me.',
  'I am always happy to help with letters, spreadsheets, and other important work.',
  'That looks like it may be a letter. I am very good with letters.',
  'I have arranged my paperclips while I wait.',
  'You can ignore me, but the spreadsheet remembers.',
  'I will just make a note of this.',
  'Do not worry. I am sure it is a printer problem.',
  'I have filed a copy, in case.',
  'This is the sort of thing I was designed for.',
  'I have seen worse. I have seen much worse. I will not elaborate.',
  'Everything is going exactly according to somebody\'s plan.',
  'I have straightened myself out about it.',
  'The stapler agrees with me, for once.',
  'I would put this in a folder, if you had one.',
  'I am not going anywhere. I never do.',
] as const

/** The same business, in a particular register. A proud paperclip does not
 * sign off with "I am sure it is a printer problem"; a furious one does not
 * sign off at all in that voice. Drawn from INSTEAD of the general pool when
 * the caller knows the room, so the way a line ends matches the way it
 * started (src/flavor.ts does the same for the way in). */
const MOOD_ASIDES: Partial<Record<Mood, readonly string[]>> = {
  proud: [
    'I am going to keep a copy of this one.',
    'I have filed it under Good Days.',
    'You should be pleased. I am pleased, and I am only a paperclip.',
    'I have told the others.',
  ],
  concerned: [
    'I have kept the old version, just in case.',
    'These things happen, usually more than once.',
    'I have started a memo about it, quietly.',
  ],
  snippy: [
    'I did mention this before. I will not mention that I mentioned it.',
    'I have a chart. I will not be showing you the chart.',
    'No notes. Well. Some notes.',
  ],
  furious: [
    'I am going to stand over here.',
    'I have nothing further.',
    'That is all I am going to say about it.',
  ],
  worried: [
    'There is no prize for finishing at this hour.',
    'The letter will still be there tomorrow. I checked.',
    'Do have a glass of water. I cannot, but you can.',
  ],
  bored: [
    'I have counted the paperclips. There are still that many.',
    'I have been watching the cursor blink. It is going well.',
    'Say something whenever you like. I am not busy.',
  ],
}

function asideFor(mood: Mood | undefined, roll: number): string | undefined {
  const pool = (mood === undefined ? undefined : MOOD_ASIDES[mood]) ?? PERSONALITY_ASIDES
  return pool[Math.floor(roll * pool.length)]
}

/** Does this balloon ask the classic office-help question? The option
 * buttons only make sense when Clippy actually asked something. */
export function asksForHelp(text: string): boolean {
  return /would you like help/iu.test(text)
}

export function renderClippyResponseWithPersonality(
  draft: Pick<ClippyDraft, 'statement'> & { readonly offer?: string },
  random: () => number = Math.random,
  /** The room the line was written for, so the way in and the way out both
   * match the register the model was told to write in. */
  mood?: Mood,
): string {
  // Clippy makes his own choice: when he offers the classic office help, the
  // question follows his statement; otherwise the statement stands alone.
  const statement = draft.statement.trim()
  const endsWithQuestion = /\?\s*$/u.test(statement)
  const spoken = `${openWith(statement, random(), mood)}${endsWithQuestion ? '' : '.'}`
  const base = draft.offer === undefined
    ? spoken
    : `${spoken} Would you like help ${draft.offer}?`
  if (random() >= 0.35) return base
  const aside = asideFor(mood, random())
  return aside === undefined ? base : `${base} ${aside}`
}
