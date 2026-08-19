/** `/clippy-settings`: the guided editor for everything under the `clippy`
 * key of `~/.pi/agent/settings.json`.
 *
 * Clippy is configured once and then runs for the whole session — he does not
 * re-read settings mid-flight and does not learn across sessions. That makes
 * a hand-edited JSON file a bad interface: you have to know the key names,
 * the value ranges, and which of thirty dials does the thing you wanted. This
 * module is the schema behind a real editor: every field, its type, its
 * bounds, and one line explaining what it actually does.
 *
 * The schema is the single source of truth for the command in
 * `extensions/index.ts`, and it is what keeps that command honest — the
 * command never invents a key, and a field added here shows up in the editor
 * with no further work.
 *
 * Everything except `readSettingsFile`/`writeClippySettings` is pure and
 * unit-tested (test/settings.test.ts).
 */
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CAMEO_AGENTS } from './cameos.ts'

export type SettingKind = 'boolean' | 'number' | 'chance' | 'ms' | 'text' | 'enum' | 'list'

export const SETTING_GROUPS = [
  'Window & shell',
  'Voice',
  'How much he talks',
  'Buddies',
  'Seasons & whimsy',
  'Working with pi',
  'Model route',
] as const

export type SettingGroup = (typeof SETTING_GROUPS)[number]

export interface SettingField {
  readonly key: string
  readonly label: string
  readonly group: SettingGroup
  readonly kind: SettingKind
  /** One line, plain language: what this actually changes. */
  readonly help: string
  /** The value used when the key is absent, shown as "(default)". */
  readonly fallback: unknown
  readonly options?: readonly string[]
  readonly min?: number
  readonly max?: number
}

/** Every configurable dial, in the order the editor shows them. Kept in
 * lockstep with src/config.ts — a key here that config.ts does not read is a
 * lie to the user, and a key config.ts reads that is missing here is invisible. */
export const SETTING_FIELDS: readonly SettingField[] = [
  // --- Window & shell ---
  { key: 'renderer', label: 'Renderer', group: 'Window & shell', kind: 'enum', options: ['external', 'ascii'], fallback: 'external',
    help: 'external opens the real Clippy window; ascii draws him in the terminal instead.' },
  { key: 'shell', label: 'Window backend', group: 'Window & shell', kind: 'enum', options: ['auto', 'electron', 'browser'], fallback: 'auto',
    help: 'auto prefers Electron (transparent, always on top) and falls back to a Chromium app window.' },
  { key: 'autoOpen', label: 'Open on session start', group: 'Window & shell', kind: 'boolean', fallback: true,
    help: 'Open the Clippy window automatically; otherwise use /clippy-open.' },
  { key: 'port', label: 'Viewer port', group: 'Window & shell', kind: 'number', min: 1, max: 65535, fallback: '(any free port)',
    help: 'Fixed localhost port for the window bridge, so an open window reconnects across sessions.' },

  // --- Voice ---
  { key: 'voice', label: 'Speak balloons aloud', group: 'Voice', kind: 'boolean', fallback: false,
    help: 'Clippy and every buddy read their lines out loud (Electron shell only).' },
  { key: 'voiceRate', label: 'Speech rate', group: 'Voice', kind: 'number', min: 0.5, max: 2, fallback: 1,
    help: 'How fast he talks. 1 is normal, 2 is a paperclip in a hurry.' },
  { key: 'voicePitch', label: 'Speech pitch', group: 'Voice', kind: 'number', min: 0, max: 2, fallback: 1,
    help: 'How high he talks. Each buddy applies its own offset on top of this.' },

  // --- How much he talks ---
  { key: 'inputCommentChance', label: 'Comment on what you type', group: 'How much he talks', kind: 'chance', fallback: 0.35,
    help: 'Chance he says one thing about a message as you send it. 0 turns pre-send commentary off.' },
  { key: 'crosstalkChance', label: 'Crosstalk chance', group: 'How much he talks', kind: 'chance', fallback: 0.65,
    help: 'Chance an open buddy answers a line it overheard. 0 makes everyone talk only to you.' },
  { key: 'idleThinking', label: 'Think while idle', group: 'How much he talks', kind: 'boolean', fallback: true,
    help: 'Let him think in the background during quiet stretches and sometimes act on it.' },
  { key: 'idleThinkAfterMs', label: 'Quiet before first thought', group: 'How much he talks', kind: 'ms', min: 30_000, max: 900_000, fallback: 120_000,
    help: 'How long the session must be quiet before his first background thought.' },
  { key: 'idleThinkCooldownMs', label: 'Gap between thoughts', group: 'How much he talks', kind: 'ms', min: 60_000, max: 3_600_000, fallback: 300_000,
    help: 'Minimum quiet time between one background thought and the next.' },
  { key: 'profanity', label: 'Allow swearing', group: 'How much he talks', kind: 'boolean', fallback: true,
    help: 'Let him swear on the rare lines where a bad session and being ignored have both piled up.' },
  { key: 'rapport', label: 'Remember how you treat him', group: 'How much he talks', kind: 'boolean', fallback: true,
    help: 'Let the yeses, pets, snubs and shushes build a relationship that sets his register and carries across days.' },

  // --- Buddies ---
  { key: 'cameos', label: 'Buddy roster', group: 'Buddies', kind: 'list', options: CAMEO_AGENTS, fallback: [...CAMEO_AGENTS],
    help: 'Which rival assistants may ever appear. Comma separated.' },
  { key: 'cameoChance', label: 'Uninvited arrivals', group: 'Buddies', kind: 'chance', fallback: 0.2,
    help: 'Chance his mood makes him send for a rival on his own. 0 means only you summon buddies.' },
  { key: 'cameoHoldMs', label: 'How long a buddy stays', group: 'Buddies', kind: 'ms', min: 2_000, max: 60_000, fallback: 8_000,
    help: 'How long a cameo window waits before dismissing itself.' },
  { key: 'banterChance', label: 'Buddies bring friends', group: 'Buddies', kind: 'chance', fallback: 0.5,
    help: 'Chance an arriving cameo drags in a partner to argue with.' },
  { key: 'annoyanceChance', label: 'Turning each other off', group: 'Buddies', kind: 'chance', fallback: 0.15,
    help: 'Chance an assistant tires of a repeat interrupter and closes its window.' },

  // --- Seasons & whimsy ---
  { key: 'seasonal', label: 'Seasonal offers', group: 'Seasons & whimsy', kind: 'boolean', fallback: true,
    help: 'Let the time of year and the day\'s holiday colour his office help.' },
  { key: 'hemisphere', label: 'Hemisphere', group: 'Seasons & whimsy', kind: 'enum', options: ['north', 'south'], fallback: 'north',
    help: 'Which way the seasons run, so a January session is not offered snowflake letterhead in Melbourne.' },
  { key: 'konami', label: 'Konami code', group: 'Seasons & whimsy', kind: 'boolean', fallback: true,
    help: 'Up up down down left right left right B A summons Bonzi.' },
  { key: 'dailyGreeting', label: 'Daily greeting', group: 'Seasons & whimsy', kind: 'boolean', fallback: true,
    help: 'The first session of a day gets a greeting about your streak.' },
  { key: 'greetingChance', label: 'Greeting chance', group: 'Seasons & whimsy', kind: 'chance', fallback: 0.6,
    help: 'How likely that daily greeting actually happens.' },

  // --- Working with pi ---
  { key: 'deskNotes', label: 'Desk notes in agent context', group: 'Working with pi', kind: 'boolean', fallback: true,
    help: 'Give the coding agent Clippy\'s running notes (repeated errors, files being circled, your opening request) before each model call.' },
  { key: 'agentTools', label: 'Let pi call Clippy', group: 'Working with pi', kind: 'boolean', fallback: true,
    help: 'Register ask_clippy and clippy_remember so the coding agent can consult him and file notes with him.' },
  { key: 'destiny', label: 'Background goal', group: 'Working with pi', kind: 'boolean', fallback: true,
    help: 'Allow the /clippy destiny system, where he works on a goal of his own while pi is idle. Each session still needs an explicit grant.' },

  // --- Model route ---
  { key: 'provider', label: 'Provider override', group: 'Model route', kind: 'text', fallback: '(follow the session)',
    help: 'Which provider generates his balloons. Leave unset to follow the session\'s active model.' },
  { key: 'model', label: 'Model override', group: 'Model route', kind: 'text', fallback: '(follow the session)',
    help: 'Which model generates his balloons. Must be set together with the provider.' },
]

export function fieldFor(key: string): SettingField | undefined {
  const needle = key.trim().toLowerCase()
  return SETTING_FIELDS.find(field => field.key.toLowerCase() === needle)
}

export function fieldsInGroup(group: SettingGroup): readonly SettingField[] {
  return SETTING_FIELDS.filter(field => field.group === group)
}

export type ParseResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: string }

const TRUE_WORDS = ['true', 'yes', 'y', 'on', '1']
const FALSE_WORDS = ['false', 'no', 'n', 'off', '0']

/** Turn one typed value into the JSON value that belongs in settings.json,
 * or explain why it cannot. `unset` on any field removes the key. */
export function parseSettingValue(field: SettingField, raw: string): ParseResult {
  const text = raw.trim()
  if (text === '' || text.toLowerCase() === 'unset' || text.toLowerCase() === 'default') {
    return { ok: true, value: undefined }
  }
  switch (field.kind) {
    case 'boolean': {
      const lower = text.toLowerCase()
      if (TRUE_WORDS.includes(lower)) return { ok: true, value: true }
      if (FALSE_WORDS.includes(lower)) return { ok: true, value: false }
      return { ok: false, error: 'that is not a yes or a no' }
    }
    case 'enum': {
      const lower = text.toLowerCase()
      const match = field.options?.find(option => option.toLowerCase() === lower)
      if (match === undefined) return { ok: false, error: `pick one of: ${field.options?.join(', ') ?? ''}` }
      return { ok: true, value: match }
    }
    case 'chance': {
      const value = Number(text.replace(/%$/u, ''))
      if (!Number.isFinite(value)) return { ok: false, error: 'that is not a number' }
      // "35" and "35%" both mean 0.35; 0-1 is taken literally.
      const scaled = text.endsWith('%') || value > 1 ? value / 100 : value
      if (scaled < 0 || scaled > 1) return { ok: false, error: 'a chance runs from 0 to 1 (or 0% to 100%)' }
      return { ok: true, value: Math.round(scaled * 1000) / 1000 }
    }
    case 'ms': {
      const seconds = /^\d+(?:\.\d+)?s$/iu.test(text)
      const minutes = /^\d+(?:\.\d+)?m$/iu.test(text)
      const base = Number(text.replace(/[sm]$/iu, ''))
      if (!Number.isFinite(base)) return { ok: false, error: 'give a number of milliseconds, or a value like 90s or 5m' }
      const value = seconds ? base * 1_000 : minutes ? base * 60_000 : base
      return boundedNumber(field, value)
    }
    case 'number': {
      const value = Number(text)
      if (!Number.isFinite(value)) return { ok: false, error: 'that is not a number' }
      return boundedNumber(field, value)
    }
    case 'list': {
      const parts = text.split(/[,\s]+/u).map(part => part.trim().toLowerCase()).filter(part => part !== '')
      const allowed = field.options
      if (allowed !== undefined) {
        const unknown = parts.filter(part => !allowed.includes(part))
        if (unknown.length > 0) return { ok: false, error: `unknown: ${unknown.join(', ')}. Pick from: ${allowed.join(', ')}` }
      }
      if (parts.length === 0) return { ok: false, error: 'that list is empty' }
      return { ok: true, value: [...new Set(parts)] }
    }
    case 'text':
      return { ok: true, value: text }
  }
}

function boundedNumber(field: SettingField, value: number): ParseResult {
  if (field.min !== undefined && value < field.min) return { ok: false, error: `the smallest allowed value is ${field.min}` }
  if (field.max !== undefined && value > field.max) return { ok: false, error: `the largest allowed value is ${field.max}` }
  return { ok: true, value }
}

/** How a stored value reads in the editor's list. */
export function formatSettingValue(field: SettingField, value: unknown): string {
  if (value === undefined) return `${describeFallback(field.fallback)} (default)`
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (field.kind === 'chance' && typeof value === 'number') return `${Math.round(value * 100)}%`
  if (field.kind === 'ms' && typeof value === 'number') return formatMs(value)
  return String(value)
}

function describeFallback(fallback: unknown): string {
  if (Array.isArray(fallback)) return fallback.join(', ')
  if (typeof fallback === 'boolean') return fallback ? 'yes' : 'no'
  return String(fallback)
}

export function formatMs(value: number): string {
  if (value >= 60_000 && value % 60_000 === 0) return `${value / 60_000}m`
  if (value >= 1_000 && value % 1_000 === 0) return `${value / 1_000}s`
  return `${value}ms`
}

/** The one-line row for a field in the editor's picker. */
export function settingRow(field: SettingField, current: Record<string, unknown>): string {
  return `${field.label} — ${formatSettingValue(field, current[field.key])}`
}

/** The whole current configuration, rendered for `/clippy-settings show`. */
export function renderSettings(current: Record<string, unknown>): string {
  const lines: string[] = []
  for (const group of SETTING_GROUPS) {
    lines.push(`${group}:`)
    for (const field of fieldsInGroup(group)) {
      lines.push(`  ${field.key} = ${formatSettingValue(field, current[field.key])}`)
    }
  }
  return lines.join('\n')
}

/** Apply one change to a settings object, returning a new object. An
 * undefined value removes the key so the built-in default applies again. */
export function applySetting(
  current: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const next = { ...current }
  if (value === undefined) delete next[key]
  else next[key] = value
  return next
}

// --- The settings file itself ----------------------------------------------

export function settingsPath(): string {
  return join(process.env['PI_CLIPPY_SETTINGS_DIR'] ?? getAgentDir(), 'settings.json')
}

/** The whole settings.json, or an empty object when it is missing or
 * unreadable. Deliberately not merged with defaults: the editor shows what
 * is actually written, and everything else as "(default)". */
export function readSettingsFile(): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(), 'utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

/** Just the `clippy` key. */
export function readClippySettings(): Record<string, unknown> {
  const clippy = readSettingsFile().clippy
  if (typeof clippy !== 'object' || clippy === null || Array.isArray(clippy)) return {}
  return { ...(clippy as Record<string, unknown>) }
}

export type WriteResult =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly error: string }

/** Write the `clippy` key back, leaving every other key in settings.json
 * exactly as it was. pi owns the rest of that file; this extension owns one
 * key of it and must not reformat or drop anything else. */
export function writeClippySettings(clippy: Record<string, unknown>): WriteResult {
  const path = settingsPath()
  try {
    const whole = readSettingsFile()
    const next = Object.keys(clippy).length === 0
      ? (() => { const copy = { ...whole }; delete copy.clippy; return copy })()
      : { ...whole, clippy }
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return { ok: true, path }
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
