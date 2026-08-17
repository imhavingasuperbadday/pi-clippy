/** Fixed Office-era lens and strict model-output boundary.
 * Ported verbatim from dsh-clippy (MIT), xlr8harder/dsh-clippy.
 */

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
}

/** A balloon ready for the renderer: spoken text plus the clickable options
 * (present only when Clippy is actually asking) and any in-character impulse
 * (summoning a rival) to act on after the line lands. */
export interface ClippyBalloon {
  readonly text: string
  readonly choices?: readonly string[]
  readonly summon?: string
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

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function unwrapJson(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu)
  return fenced?.[1] ?? trimmed
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
  // A question Clippy cannot be answered (no buttons) is downgraded to a
  // plain statement — he never asks something hollow.
  const finalStatement = asksQuestion && choices === undefined ? statement.replace(/\?\s*$/u, '') : statement
  return {
    kind: parsed.kind as StatementKind,
    statement: finalStatement,
    ...(choices === undefined ? {} : { choices }),
    ...(summon === undefined ? {} : { summon }),
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

export function renderClippyResponse(draft: Pick<ClippyDraft, 'statement'> & { readonly officeTask: OfficeTask }): string {
  return renderClippyResponseWithOffer({ statement: draft.statement, offer: OFFICE_OFFERS[draft.officeTask] })
}

export function renderClippyResponseWithOffer(
  draft: Pick<ClippyDraft, 'statement'> & { readonly offer: string },
): string {
  return `It looks like ${draft.statement}. Would you like help ${draft.offer}?`
}

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
] as const

/** Does this balloon ask the classic office-help question? The option
 * buttons only make sense when Clippy actually asked something. */
export function asksForHelp(text: string): boolean {
  return /would you like help/iu.test(text)
}

export function renderClippyResponseWithPersonality(
  draft: Pick<ClippyDraft, 'statement'> & { readonly offer?: string },
  random: () => number = Math.random,
): string {
  // Clippy makes his own choice: when he offers the classic office help, the
  // question follows his statement; otherwise the statement stands alone.
  const statement = draft.statement.trim()
  const endsWithQuestion = /\?\s*$/u.test(statement)
  const spoken = `It looks like ${statement}${endsWithQuestion ? '' : '.'}`
  const base = draft.offer === undefined
    ? spoken
    : `${spoken} Would you like help ${draft.offer}?`
  if (random() >= 0.35) return base
  const aside = PERSONALITY_ASIDES[Math.floor(random() * PERSONALITY_ASIDES.length)]
  return aside === undefined ? base : `${base} ${aside}`
}
