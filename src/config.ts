/** Optional configuration for Clippy, read from the `clippy` key of
 * `~/.pi/agent/settings.json`. All keys are optional:
 *
 *   {
 *     "clippy": {
 *       "provider": "openrouter",       // model route override
 *       "model": "some/model",
 *       "renderer": "external",         // "external" (Clippy window) | "ascii" (terminal widget)
 *       "shell": "auto",                // "auto" (Electron if installed) | "electron" | "browser"
 *       "autoOpen": true,               // open the Clippy window on session start
 *       "port": 8765,                   // localhost port for the viewer (stable so the window reconnects)
 *       "voice": false,                 // Clippy and every buddy speak their balloons aloud (Electron shell)
 *       "voiceRate": 1,                 // speech rate (0.5 - 2)
 *       "voicePitch": 1,                // speech pitch (0 - 2)
 *       "cameoChance": 0.2,             // chance Clippy's mood makes him send for a rival (0 = no uninvited arrivals)
 *       "idleThinking": true,            // think in the background while the session is idle, and act on it
 *       "idleThinkAfterMs": 120000,      // how long the session must be quiet before the first thought
 *       "idleThinkCooldownMs": 300000,   // minimum quiet time between one thought and the next
 *       "inputCommentChance": 0.35,      // per-message chance Clippy comments on what you type before it is sent (0 = off)
 *       "profanity": true,              // let Clippy swear on the rare lines where he is genuinely furious
 *       "rapport": true,                // let the relationship (yeses, pets, snubs) colour his register
 *       "crosstalkChance": 0.65,        // per-line chance an open buddy/Clippy replies (0 = off)
 *       "cameos": ["bonzi","genie","merlin","rover","rocky","peedy","links"],
 *       "cameoHoldMs": 8000,            // how long a cameo window stays before dismissing itself
 *       "banterChance": 0.5,            // chance a cameo conjures a partner to argue with (0 = off)
 *       "annoyanceChance": 0.15,        // chance Clippy/a buddy tires of a repeat interrupter and turns it off (0 = off)
 *       "konami": true,                 // ↑↑↓↓←→←→ B A summons Bonzi
 *       "dailyGreeting": true,          // first session of the day gets a stats greeting
 *       "greetingChance": 0.6,          // probability of that greeting
 *       "seasonal": true,               // seasonal/holiday-aware office offers
 *       "hemisphere": "north",          // "north" | "south" (which way the seasons run)
 *       "deskNotes": true,              // splice Clippy's desk notes into the coding agent's context
 *       "agentTools": true,             // register ask_clippy / clippy_remember as pi tools
 *       "destiny": true                 // allow the /clippy destiny background-goal system
 *     }
 *   }
 *
 * When provider/model are absent, Clippy follows the session's active model.
 */
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CAMEO_AGENTS } from './cameos.ts'
import type { Hemisphere } from './seasons.ts'
import { VOICE_OFF, type VoiceSettings } from './voice.ts'

export type ClippyRenderer = 'external' | 'ascii'
export type ClippyShell = 'auto' | 'electron' | 'browser'

export interface ClippyConfig {
  readonly provider?: string
  readonly model?: string
  readonly renderer: ClippyRenderer
  readonly shell: ClippyShell
  readonly autoOpen: boolean
  readonly port?: number
  readonly voice: VoiceSettings
  /** How willing Clippy is to send for a rival on his own initiative. Buddies
   * never simply materialize: every arrival is somebody's doing (Clippy's
   * summon, a buddy dragging in its partner, or the user). 0 means Clippy
   * never sends for anyone and only the user can open a buddy window. */
  readonly cameoChance: number
  /** Whether Clippy thinks quietly in the background while the session is
   * idle and, when he feels like it, acts on his own — starting a chat with
   * a buddy, offering help, or musing out loud. Thoughts never edit files;
   * a file edit still needs a pressed Yes. Chat impulses respect cameoChance
   * (0 = he never calls anyone, even when he wants to). */
  readonly idleThinking: boolean
  /** How long the session must be quiet before Clippy's first background
   * thought (ms). */
  readonly idleThinkAfterMs: number
  /** Minimum quiet time between one background thought and the next (ms). */
  readonly idleThinkCooldownMs: number
  /** Per-message chance that Clippy reads your message before it is sent
   * and says one short thing about WHAT you typed — advice, a jab, or an
   * earnest worry. The send itself is never blocked or rewritten; the
   * comment just lands while the message is already on its way. 0 turns
   * the pre-send commentary off entirely. */
  readonly inputCommentChance: number
  /** Whether Clippy may swear on the rare lines where he is genuinely
   * furious (see src/temper.ts). Off makes him permanently polite. */
  readonly profanity: boolean
  /** Whether the relationship arc (src/rapport.ts) colours how he talks to
   * you: how forward he is, how familiar he is allowed to be, and whether
   * a long friendship — or a session spent shutting him up — is felt at all.
   * Off makes him the same cheerful stranger every session, which is the
   * pre-rapport behaviour. */
  readonly rapport: boolean
  /** Per-line chance an open listener actually replies to a line (0 = crosstalk
   * off entirely; the guaranteed acknowledgment still fires for buddies). */
  readonly crosstalkChance: number
  readonly cameos: readonly string[]
  readonly cameoHoldMs: number
  readonly banterChance: number
  readonly annoyanceChance: number
  readonly konami: boolean
  readonly dailyGreeting: boolean
  readonly greetingChance: number
  /** Let the time of year and the day's holiday colour Clippy's office help
   * (see src/seasons.ts). */
  readonly seasonal: boolean
  /** Which hemisphere's seasons apply, so a January session is not offered
   * snowflake letterhead in Melbourne. */
  readonly hemisphere: Hemisphere
  /** Whether Clippy's running desk notes are spliced into the CODING AGENT'S
   * context before each model call (src/memo.ts). This is the one channel
   * where Clippy affects the agent's answers rather than commenting on them. */
  readonly deskNotes: boolean
  /** Whether the coding agent gets `ask_clippy` and `clippy_remember` as real
   * pi tools, so it can consult him and file notes with him mid-turn. */
  readonly agentTools: boolean
  /** Whether the background-goal system exists at all (`/clippy destiny`,
   * src/destiny.ts). Off means the commands report it is disabled and no
   * background edit can ever be attempted; on still requires an explicit
   * per-session grant before he touches a file. */
  readonly destiny: boolean
}

export function defaultClippyConfig(): ClippyConfig {
  return {
    renderer: 'external',
    shell: 'auto',
    autoOpen: true,
    voice: VOICE_OFF,
    cameoChance: 0.2,
    idleThinking: true,
    idleThinkAfterMs: 120_000,
    idleThinkCooldownMs: 300_000,
    inputCommentChance: 0.35,
    profanity: true,
    rapport: true,
    crosstalkChance: 0.65,
    cameos: [...CAMEO_AGENTS],
    cameoHoldMs: 8_000,
    banterChance: 0.5,
    annoyanceChance: 0.15,
    konami: true,
    dailyGreeting: true,
    greetingChance: 0.6,
    seasonal: true,
    hemisphere: 'north',
    deskNotes: true,
    agentTools: true,
    destiny: true,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min
}

/** Read one optional numeric setting with a fallback and clamp bounds. */
function clampSetting(
  record: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  return clamp(typeof record[key] === 'number' ? (record[key] as number) : fallback, min, max)
}

export function readClippyConfig(): ClippyConfig {
  const fallback = defaultClippyConfig()
  try {
    const raw = readFileSync(join(getAgentDir(), 'settings.json'), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return fallback
    const clippy = (parsed as Record<string, unknown>).clippy
    if (typeof clippy !== 'object' || clippy === null) return fallback
    const record = clippy as Record<string, unknown>
    const cameos = Array.isArray(record.cameos)
      ? (record.cameos as unknown[]).filter((c): c is string => typeof c === 'string' && c.length > 0)
      : fallback.cameos
    return {
      ...(typeof record.provider === 'string' ? { provider: record.provider } : {}),
      ...(typeof record.model === 'string' ? { model: record.model } : {}),
      renderer: record.renderer === 'ascii' ? 'ascii' : 'external',
      shell: record.shell === 'electron' ? 'electron' : record.shell === 'browser' ? 'browser' : 'auto',
      autoOpen: record.autoOpen !== false,
      ...(typeof record.port === 'number' && Number.isInteger(record.port) && record.port > 0 && record.port <= 65535
        ? { port: record.port }
        : {}),
      voice: {
        enabled: record.voice === true,
        rate: clampSetting(record, 'voiceRate', 1, 0.5, 2),
        pitch: clampSetting(record, 'voicePitch', 1, 0, 2),
      },
      cameoChance: clampSetting(record, 'cameoChance', 0.2, 0, 1),
      idleThinking: record.idleThinking !== false,
      idleThinkAfterMs: clampSetting(record, 'idleThinkAfterMs', 120_000, 30_000, 900_000),
      idleThinkCooldownMs: clampSetting(record, 'idleThinkCooldownMs', 300_000, 60_000, 3_600_000),
      inputCommentChance: clampSetting(record, 'inputCommentChance', 0.35, 0, 1),
      profanity: record.profanity !== false,
      rapport: record.rapport !== false,
      crosstalkChance: clampSetting(record, 'crosstalkChance', 0.65, 0, 1),
      cameos: cameos.length > 0 ? cameos : fallback.cameos,
      cameoHoldMs: clampSetting(record, 'cameoHoldMs', 8_000, 2_000, 60_000),
      banterChance: clampSetting(record, 'banterChance', 0.5, 0, 1),
      annoyanceChance: clampSetting(record, 'annoyanceChance', 0.15, 0, 1),
      konami: record.konami !== false,
      dailyGreeting: record.dailyGreeting !== false,
      greetingChance: clampSetting(record, 'greetingChance', 0.6, 0, 1),
      seasonal: record.seasonal !== false,
      hemisphere: record.hemisphere === 'south' ? 'south' : 'north',
      deskNotes: record.deskNotes !== false,
      agentTools: record.agentTools !== false,
      destiny: record.destiny !== false,
    }
  } catch {
    return fallback
  }
}
