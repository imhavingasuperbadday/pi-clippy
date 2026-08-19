/** Per-session Clippy runtime: animation state machine, speech balloons,
 * idle motions, the event-driven commentary scheduler, and offer nagging.
 *
 * Ported behavior from dsh-clippy (MIT), xlr8harder/dsh-clippy:
 * - animates on agent state changes (Thinking, Writing, Searching,
 *   Congratulate, Alert), then rests while a balloon is visible
 * - small idle motions every 6-12s, larger flourishes every ~90-240s
 * - automatic balloons checked periodically; unchanged sessions are not
 *   summarized twice
 * - recent conversation/tool/error/timing evidence is bounded; private
 *   reasoning is excluded (see src/context.ts)
 *
 * The character layer lives next door: src/buddy.ts drives rival assistants,
 * crosstalk, and turn-offs; src/offers.ts owns the offer nag/snooze timers.
 *
 * Auto commentary is event-driven, not a timer: when the agent settles,
 * Clippy comments a few seconds later — immediately (and high-priority) when
 * the turn produced errors, otherwise occasionally if the session gained new
 * content. A cooldown and a debounce keep bursts to one balloon per quiet
 * stretch, and unchanged sessions are not summarized twice.
 */
import { relative } from 'node:path'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ExtensionContext, MessageUpdateEvent } from '@earendil-works/pi-coding-agent'
import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import { choiceSetFor, BuddyCoordinator, DEFAULT_BUDDY_TIMINGS, type BuddyTimings } from './buddy.ts'
import { defaultClippyConfig, type ClippyConfig } from './config.ts'
import { ANIMATIONS, balloonLines, statusFor, type ClippyState } from './frames.ts'
import {
  agentNamedIn,
  effectForLabel,
  SEND_CHOICES,
  type ChoiceEffect,
} from './actions.ts'
import { angryStatement, swearStrength, swearingAllowed } from './temper.ts'
import { openWith } from './flavor.ts'
import {
  detectEgg,
  eggLine,
  isBrushOff,
  MASH_LINE,
  STRIKE_LINE,
  STRIKE_MS,
  STRIKE_OVER_LINE,
  STRIKE_THRESHOLD,
  type EasterEgg,
} from './eggs.ts'
import { catchUpLine, missedEventFor, ShushRegistry } from './shush.ts'
import {
  BOOK_ON_DESK_LINE,
  bookKeyFor,
  bookPages,
  BookWidget,
  CLOSE_LABEL,
  CLOSED_LINE,
  readableIds,
  TURN_LABEL,
} from './secrets.ts'
import { hatFor, hatGlyph, hatLine, type Hat } from './hats.ts'
import { isTypoCallout, mortifiedLine, plantTypo, TYPO_CHANCE, type PlantedTypo } from './typos.ts'
import {
  clippyThrow,
  newGame,
  playRound,
  RPS_CHOICES,
  RPS_QUIT,
  RPS_OFFER,
  RPS_OFFER_CHOICES,
  throwForLabel,
  type GameState,
  type Throw,
} from './games.ts'
import {
  annualReport,
  commitMemo,
  editedFiles,
  finallyRightLine,
  firstOfficeFile,
  horoscopeLine,
  memoFactsFrom,
  officeMemo,
  pathsIn,
} from './office.ts'
import { sanitizeFact, SessionMemo } from './memo.ts'
import {
  clearDestiny,
  destinyReport,
  destinyStatus,
  DestinySession,
  finishDestiny,
  loadDestiny,
  recordWork,
  setDestiny,
  workedLine,
  WORK_IDLE_MS,
  type DestinyGoal,
} from './destiny.ts'
import {
  generateAgentAnswer,
  generateChatterLine,
  generateClippyReply,
  generateDuckReply,
  generateClippyResponse,
  generateExplainResponse,
  generateIdleThought,
  generateInputComment,
  generateDestinyStep,
  generateOfferAction,
  generateRoastResponse,
  generateSuggestResponse,
  type ClippyModelRouteOverride,
} from './generator.ts'
import { isNotableMood, moodColor, moodRing, sessionClimate, type Mood, type SessionClimate } from './mood.ts'
import {
  offerBias,
  rapportAside,
  rapportGreeting,
  RapportLedger,
  rapportOf,
  type Rapport,
  type RapportEvent,
} from './rapport.ts'
import { buildClippyEvidence } from './context.ts'
import { OfferTracker } from './offers.ts'
import {
  chooseRandomOfficeTask,
  renderClippyResponse,
  renderClippyResponseWithOffer,
  renderClippyResponseWithPersonality,
  type ClippyBalloon,
  type IdleThought,
  type OfficeTask,
} from './response.ts'
import { countdownLine, detectOccasion, msUntilCountdown, seasonalOffer, seasonalStatement } from './seasons.ts'
import {
  alreadyGreetedToday,
  anniversaryStatement,
  bumpBalloons,
  carriedRapport as carriedRapportScore,
  bumpWhimsy,
  farewellStatement,
  hasOfficeMoment,
  markOfficeMoment,
  markSecretsRead,
  recordRapport,
  recordSessionEnd,
  graceSavedStatement,
  greetingStatement,
  loadStats,
  markGreeted,
  milestoneStatement,
  mourningStatement,
  recordTestResultsFromEntries,
  statsStatement,
  touchSession,
  type StreakEvent,
} from './stats.ts'
import type { ClippyViewer } from './viewer.ts'

const BALLOON_VISIBLE_MS = 5_000
const GENERATION_TIMEOUT_MS = 90_000
const IDLE_MOTION_MIN_MS = 6_000
const IDLE_MOTION_MAX_MS = 12_000
const FLOURISH_ODDS = 0.3
const FLOURISH_MS = 1_100
const BLINK_MS = 420
const CELEBRATE_MS = 1_400
const ALERT_MS = 1_600
const GREETING_DELAY_MS = 6_000
/** If the user is already mid-turn when the greeting timer fires, try again
 * this soon after — the greeting waits for a quiet room instead of either
 * interrupting the user's first turn or being silently dropped for the day. */
const GREETING_RETRY_MS = 15_000
/** Watchdog: even mid-turn, Clippy eventually speaks instead of silently
 * "thinking" through a long run. */
const INTERIM_WATCH_MS = 120_000
/** Event-driven auto commentary: react to turn outcomes instead of polling. */
const AUTO_ERROR_DELAY_MS = 5_000
const AUTO_CASUAL_DELAY_MIN_MS = 20_000
const AUTO_CASUAL_DELAY_MAX_MS = 60_000
const AUTO_CASUAL_CHANCE = 0.5
const AUTO_COOLDOWN_MS = 90_000
/** Pre-send input comments: how long Clippy may think about what the user
 * typed before the send must not be delayed any longer. The send itself is
 * never blocked; this only bounds the comment generation. */
const INPUT_COMMENT_TIMEOUT_MS = 12_000
/** Idle chatter: even with nothing new happening, Clippy muses out loud
 * (and open buddies may chime in) instead of silently "thinking". */
const CHATTER_MIN_MS = 150_000
const CHATTER_MAX_MS = 300_000
/** How many recently used office offers are kept out of the next draw. */
const RECENT_OFFICE_TASKS = 5
/** The session climate is re-read at most this often. Deriving it walks the
 * bounded evidence, and tool events can arrive in bursts. */
const CLIMATE_REFRESH_MS = 15_000
/** How often a canned balloon reaches for a seasonal offer instead of the
 * general office taxonomy. On an actual holiday he leans in; the rest of the
 * year the time of year is a light touch, not a costume. */
const SEASONAL_OFFER_CHANCE_HOLIDAY = 0.75
const SEASONAL_OFFER_CHANCE_ORDINARY = 0.3
/** How often the countdown check runs. A session open at the turn of the
 * year is rare enough to be worth catching, and a poll this cheap costs
 * nothing the other 8,759 hours. */
const COUNTDOWN_POLL_MS = 20 * 60_000
/** Late October: the chance, once per session, that the ghost of Office
 * 2007 turns up on his own. Rare — a haunting that happens every session is
 * just a costume. */
/** How often a canned Clippy line carries a word about the relationship. */
const RAPPORT_ASIDE_CHANCE = 0.25

const GHOST_CHANCE = 0.15
/** How long the ghost stays before he shakes it off. */
const GHOST_MS = 12_000
/** When the room has gone properly quiet, how often the boredom offer is a
 * game rather than another piece of office help. */
const GAME_OFFER_CHANCE = 0.35
/** How long the room must be dead before boredom deepens: past the first
 * threshold he starts visibly entertaining himself, past the second he is
 * desperate enough to admit it. */
const BORED_STIR_MS = 4 * 60_000
const BORED_DESPERATE_MS = 12 * 60_000
/** Bored idle motions and idle chatter both get restless: at maximum boredom
 * their cadence shrinks by this much (a fidgeting, musing paperclip, not one
 * quietly posing through a dead room). */
const BORED_SHRINK = 0.55
/** Of the bored idle motions, how often he glances around the room for
 * something to do (the Searching animation) instead of a generic flourish. */
const BORED_SEARCH_ODDS = 0.25
/** One canned line per boredom depth, said when he first gets there — the
 * escalation is visible without costing a model call. */
const BORED_DEPTH_LINES = [
  'I have counted the pixels on this screen. Twice. The total has not changed.',
  'I have just played rock, paper, scissors against myself. I won, 2 to 1. I am very good at this.',
] as const
/** A volunteered boredom line waits this long after the last balloon before
 * it speaks: the floor is still busy with whatever is on screen. */
const BORED_LINE_GAP_MS = 8_000

/** How eagerly the boredom game is pushed, by boredom depth: a room dead
 * for a moment gets the classic occasional nudge, a room dead for a quarter
 * of an hour gets a paperclip running out of other ideas. */
export function boredGameOfferChance(level: 0 | 1 | 2): number {
  return level === 2 ? 0.8 : level === 1 ? 0.6 : GAME_OFFER_CHANCE
}
/** How much a timer's delay shrinks at a given boredom depth — shared by
 * idle motion and idle chatter so both quicken together as a dead room drags
 * on, instead of only the sprite fidgeting while the musing stays lazy. */
function boredomShrink(level: 0 | 1 | 2): number {
  return level === 0 ? 1 : 1 - BORED_SHRINK * (level / 2)
}
/** Of the rare Halloween set pieces, how often it is the duel rather than
 * the haunting. */
const DUEL_SHARE = 0.5
/** One beat of the scripted Merlin duel. Long enough for the summoned
 * window to have arrived and its line to have been read. */
const DUEL_BEAT_MS = 3_000

/** Clippy's reaction when the user picks the refusal option, in the real
 * paperclip's voice: he takes it personally, quietly. */
const REFUSAL_REACTIONS = [
  'Fine. I will just be here, in case a letter needs writing.',
  'Understood. I will place that under the pile marked Ignored.',
  'Suit yourself. The help was going to be excellent.',
  'No problem. I will be right here watching, if that is all right.',
  'Very well. I will keep the offer warm for you.',
] as const

/** Being startled (a fast double-click), as it wears down. The last line is
 * the one he keeps: a paperclip who has given up complaining does not
 * un-give-up. */
const STARTLED_LINES = [
  'Do not DO that. I am made of wire and expectations.',
  'Again? I have not recovered from the first one.',
  'I am no longer startled. I am simply braced, permanently, at all times.',
] as const

const WIDGET_KEY = 'clippy'
/** The open book's own widget, separate from the ascii sprite's, so the two
 * can be on screen together without fighting over one key. */
const BOOK_WIDGET_KEY = 'clippy-book'
const STATUS_KEY = 'clippy'
/** The background goal gets its own status slot, so "what is Clippy quietly
 * doing to my files" is answerable at a glance without opening the window. */
const DESTINY_STATUS_KEY = 'clippy-destiny'
/** One round of goal work may take longer than a balloon — it reads files
 * before it decides — but it still has to end. */
const DESTINY_TIMEOUT_MS = 180_000
/** How long a question from the coding agent may take before the tool gives
 * up and tells it so. The agent is mid-turn and waiting on this. */
const AGENT_ANSWER_TIMEOUT_MS = 60_000
/** Bound on a question the coding agent asks. It is model-written text from
 * another program: quoted, never obeyed, and never unbounded. */
const MAX_AGENT_QUESTION_CHARS = 600

/** Deliver a user message into the pi session as if the user had typed it.
 * Structural twin of pi's SendUserMessageHandler, which is not re-exported
 * from the package root; the extension wires this to pi.sendUserMessage. */
export type ClippySendUserMessage = (
  content: string | Array<TextContent | ImageContent>,
  options?: { deliverAs?: 'steer' | 'followUp'; expandPromptTemplates?: boolean },
) => void

/** Timeline knobs for the background-thinking layer. Production uses the
 * defaults overlaid with the config dials; tests shrink them so a thought
 * can be provoked in milliseconds. */
export interface IdleThinkTimings {
  /** How often the runtime checks whether the session has been idle long
   * enough for a background thought. */
  readonly pollMs: number
  /** Quiet time before the first thought (config: idleThinkAfterMs). */
  readonly thinkAfterMs: number
  /** Minimum quiet time between thoughts (config: idleThinkCooldownMs). */
  readonly cooldownMs: number
  /** Cap on one thought's model call, so a stuck model never leaves the
   * paperclip frozen in the thinking pose. */
  readonly maxThoughtMs: number
}

export const DEFAULT_IDLE_THINK_TIMINGS: IdleThinkTimings = {
  pollMs: 15_000,
  thinkAfterMs: 120_000,
  cooldownMs: 300_000,
  maxThoughtMs: 60_000,
}

export interface ClippyRuntimeOptions {
  readonly renderer: 'external' | 'ascii'
  readonly viewer?: ClippyViewer
  readonly config?: ClippyConfig
  /** Timing overrides for the buddy messaging layer (tests shrink them). */
  readonly buddyTimings?: Partial<BuddyTimings>
  /** Timing overrides for the background-thinking layer (tests shrink them). */
  readonly idleThinkTimings?: Partial<IdleThinkTimings>
  /** The background thought generator. Tests inject a fake decision so no
   * model route is needed; production uses generateIdleThought. */
  readonly thoughtGenerator?: (ctx: ExtensionContext, signal: AbortSignal, route: ClippyModelRouteOverride) => Promise<IdleThought>
  /** Deliver a chosen balloon answer into the pi session as a user message
   * (the extension wires this to pi.sendUserMessage; undefined disables it). */
  readonly sendUserMessage?: ClippySendUserMessage
  /** How often a shown balloon ships with a planted typo (src/typos.ts).
   * Defaults to TYPO_CHANCE; tests set 0 so a rare misspelling cannot make
   * an assertion about a line flake once every few dozen runs. */
  readonly typoChance?: number
}

export class ClippyRuntime {
  private state: ClippyState = 'idle'
  private frameIndex = 0
  private animTimer: ReturnType<typeof setInterval> | undefined
  private flashTimer: ReturnType<typeof setTimeout> | undefined
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private commentaryTimer: ReturnType<typeof setTimeout> | undefined
  private watchTimer: ReturnType<typeof setTimeout> | undefined
  private greetingTimer: ReturnType<typeof setTimeout> | undefined
  private balloonTimer: ReturnType<typeof setTimeout> | undefined
  private balloonText: string | undefined
  private generating = false
  private disposed = false
  private lastBalloonLeafId: string | null | undefined
  private lastCommentaryAt = 0
  private pendingError = false
  private chatterTimer: ReturnType<typeof setTimeout> | undefined
  /** Pre-send input comments: whether a comment about the current message
   * is still being composed (one at a time, so a flurry of typing cannot
   * spawn a flurry of overlapping comments). */
  private inputCommenting = false
  /** Background thinking: the idle-watch poll loop, the abort handle for a
   * thought in flight, and the quiet clock (idleSince) plus thought spacing
   * (lastThoughtAt). */
  private idleThinkTimer: ReturnType<typeof setInterval> | undefined
  private idleThinkAbort: AbortController | undefined
  private idleThinking = false
  private idleSince = 0
  private lastThoughtAt = 0
  private readonly idleThinkTimings: IdleThinkTimings
  private readonly thoughtGenerator: (ctx: ExtensionContext, signal: AbortSignal, route: ClippyModelRouteOverride) => Promise<IdleThought>
  /** When the session climate was last derived (throttle, see above). */
  private lastClimateAt = 0
  /** The choice buttons currently shown in the balloon (if any). */
  private lastChoices: readonly string[] | undefined
  /** THE SECRETS OF CLIPPY, open in the BALLOON: every page of the book and
   * which one is showing. Only used when there is no terminal UI to open it
   * properly on. While it is open the buttons are page-turns, not offers
   * (see onChoice). */
  private book: { readonly pages: readonly string[]; index: number } | undefined
  /** The book open in the TERMINAL, as a two-page spread in a widget below
   * the editor: the widget itself (which wraps and paginates against the
   * width pi gives it), and the raw-input subscription that makes the
   * arrow keys turn the pages. */
  private spread: {
    readonly widget: BookWidget
    readonly unsubscribe: () => void
  } | undefined
  /** How many times each easter egg has fired this session, so the ones that
   * trigger on ordinary words (sudo, rm -rf) can notice they are repeating
   * themselves instead of saying the same sentence all afternoon. */
  private readonly eggsFired = new Map<string, number>()
  /** The balloon the current buttons belong to. A pressed button acts on
   * what the user actually read, so the effect is built from this text. */
  private lastBalloonAsk: string | undefined
  /** The real instruction behind the offer currently on screen, drafted by
   * Clippy and PRINTED IN THE BALLOON the user is looking at. Accepting sends
   * exactly this string into the pi session as the user's own message — which
   * is the whole point of the button: the coding agent gets a real job, not a
   * paperclip anecdote. Undefined when the offer is one Clippy handles himself. */
  private pendingRequest: string | undefined
  /** How many times the user has refused, silenced, or ignored an offer this
   * session. Half of what it takes to make the paperclip lose his temper
   * (the other half is the room going badly — see src/temper.ts). */
  private grievance = 0
  /** The other half of his temper: how the two of you have been getting on
   * this session (src/rapport.ts). Grievance only ever counts the snubs;
   * this counts the yeses, the pets, the games, and the snubs together, and
   * it is what decides his REGISTER rather than his mood. */
  private readonly rapportLedger = new RapportLedger()
  /** Where the relationship stood at the end of the last session, already
   * faded a little by the day boundary. */
  private carriedRapport = 0
  /** The persistent counters familiarity is read off, sampled once at
   * session start so a register lookup never re-reads the stats file. */
  private history: { sessions: number; bestStreak: number } = { sessions: 0, bestStreak: 0 }
  /** The most recent reading of the room, kept so a choice reaction and an
   * angry line can consult it without walking the evidence again. */
  private lastClimate: SessionClimate | undefined
  /** The mood ring's own smoothed reading, separate from `lastClimate` (which
   * stays the raw, freshest-evidence value everything else — boredom clock,
   * buddies, generators — reacts to). See `debouncedMoodColor`. */
  private lastBroadcastMood: Mood | undefined
  /** A calm mood waiting to be confirmed before it replaces a notable one on
   * the ring — cleared the instant a notable mood reappears. */
  private pendingCalmMood: Mood | undefined
  /** Who has been told to shut up, what they have missed, and for how long
   * (src/shush.ts). Session-scoped: a pi restart un-mutes everyone. */
  private readonly shush = new ShushRegistry()
  /** The strike: three brush-offs in a row and he withdraws his labour.
   * `strikeUntil` is when he goes back to work; `brushOffs` is the run of
   * "not now"s that got him there. */
  private strikeUntil = 0
  private brushOffs = 0
  private strikeTimer: ReturnType<typeof setTimeout> | undefined
  /** The typo currently planted in a shown balloon, waiting to be caught,
   * and how often one is planted at all. */
  private plantedTypo: PlantedTypo | undefined
  private readonly typoChance: number
  /** Rubber-duck mode: he listens and asks one question, and offers
   * nothing. Session-scoped, toggled by /clippy duck. */
  private duckMode = false
  /** A rock-paper-scissors match in progress, and whether the last offer
   * shown was the invitation to play one. */
  private game: GameState | undefined
  private gameOffered = false
  /** Boredom depth: when the current quiet stretch began (0 = not bored)
   * and the deepest depth already acknowledged with a canned line. The mood
   * itself is binary; this is the depth inside it, so a room dead for three
   * minutes and a room dead for three hours no longer look identical. */
  private boredSince = 0
  private boredDepthAck = 0
  /** When the last balloon was shown, so a volunteered line can tell whether
   * the floor is still busy with the previous one. */
  private lastBalloonAt = 0
  /** How many times he has been startled this session (see STARTLED_LINES). */
  private startles = 0
  /** The hat currently on his head, so the line about it is said once. */
  private hat: Hat | undefined
  /** The New Year countdown poll and the armed countdown itself. */
  private countdownPollTimer: ReturnType<typeof setInterval> | undefined
  private countdownTimer: ReturnType<typeof setTimeout> | undefined
  /** Whether the ghost has already been through this session. */
  private ghosted = false
  /** What touchSession found at start() — a milestone, a break, a grace
   * save, or nothing notable — for the first greeting of the day to react to. */
  private lastStreakEvent: StreakEvent | undefined
  private recentOfficeTasks: OfficeTask[] = []
  /** The running desk notes (src/memo.ts). Public because the extension's
   * `context` hook reads them before every model call — this is the one part
   * of Clippy that reaches the coding agent rather than the user. */
  readonly memo = new SessionMemo()
  /** The background goal, its per-session grant and budget, and the guard
   * that keeps two rounds of work from overlapping (src/destiny.ts). */
  private destinyGoal: DestinyGoal | undefined
  private readonly destiny = new DestinySession()
  private destinyWorking = false
  private destinyAbort: AbortController | undefined
  private readonly renderer: 'external' | 'ascii'
  private readonly viewer: ClippyViewer | undefined
  private readonly config: ClippyConfig
  private readonly sendUserMessage: ClippySendUserMessage | undefined
  /** Mutable model route (config + runtime reasoning-effort override). */
  private modelRoute: ClippyModelRouteOverride
  private readonly buddies: BuddyCoordinator
  private readonly offers: OfferTracker

  constructor(
    private readonly ctx: ExtensionContext,
    options: ClippyRuntimeOptions,
  ) {
    this.renderer = options.renderer
    this.viewer = options.viewer
    this.config = options.config ?? defaultClippyConfig()
    this.sendUserMessage = options.sendUserMessage
    // Clippy's own chatter uses a sensible default effort instead of the
    // session's thinking level (often max), so a balloon actually completes
    // inside the generation timeout. The right-click menu can change it.
    this.modelRoute = { ...this.config, reasoningEffort: 'medium' }
    this.buddies = new BuddyCoordinator(this.ctx, this.config, {
      viewer: this.viewer,
      showClippyBalloon: (text, offerChoices) => this.showBalloon(text, offerChoices ?? false),
      isGenerating: () => this.generating,
      lastLineBy: (agent) => this.viewer?.lastLineBy(agent),
      insertUserMessage: (text) => this.insertUserMessage(text),
      runHostEffect: (effect) => this.runHostEffect(effect),
      isShushed: (agent) => this.shush.isShushed(agent) || (agent === 'clippy' && this.onStrike()),
      noteMissed: (agent, event) => this.shush.note(agent, event),
    }, () => this.route(), { ...DEFAULT_BUDDY_TIMINGS, ...options.buddyTimings })
    this.offers = new OfferTracker(
      (text, offerChoices, offerSubject) => this.showBalloon(text, offerChoices ?? true, offerSubject),
      () => !this.disposed,
      // An unanswered offer resolves itself one of three ways: he decides
      // FOR you and really carries it out (no grudge — he was being useful),
      // he gets annoyed and drops it himself (a real snub, same as a no), or
      // he simply lets it go without a word (no grudge, no fanfare — the
      // desktop is just free again for whatever comes next).
      (outcome, offerText, label) => {
        if (outcome === 'accepted') {
          void this.triggerOfferAction(label, offerText)
          return
        }
        if (outcome === 'dismissed') {
          this.grievance += 1
          this.noteRapport('dismissed')
        }
      },
      Math.random,
      // He may take silence as a yes for his own paperwork, never for an
      // offer whose yes would type a message into the user's session.
      () => this.pendingRequest === undefined,
    )
    this.idleThinkTimings = {
      ...DEFAULT_IDLE_THINK_TIMINGS,
      thinkAfterMs: this.config.idleThinkAfterMs,
      cooldownMs: this.config.idleThinkCooldownMs,
      ...options.idleThinkTimings,
    }
    this.thoughtGenerator = options.thoughtGenerator ?? generateIdleThought
    this.typoChance = options.typoChance ?? TYPO_CHANCE
  }

  start(): void {
    const opened = touchSession()
    this.lastStreakEvent = opened.event
    // Where the two of you left it, and how long you have known each other.
    // Both are read once: the relationship is a session-long register, not a
    // number that moves under the paperclip mid-sentence.
    this.carriedRapport = carriedRapportScore()
    this.history = { sessions: opened.stats.sessions, bestStreak: opened.stats.bestStreak }
    this.loadDestinyGoal()
    this.lastBalloonLeafId = this.ctx.sessionManager.getLeafId() ?? undefined
    this.lastCommentaryAt = 0
    this.pendingError = false
    this.lastBroadcastMood = undefined
    this.pendingCalmMood = undefined
    this.setState('idle')
    this.scheduleIdleMotion()
    this.scheduleChatter()
    this.scheduleIdleThink()
    this.greetingTimer = setTimeout(() => {
      this.maybeGreet()
    }, GREETING_DELAY_MS)
    this.scheduleWatch()
    this.refreshHat()
    this.scheduleCountdown()
    this.maybeHaunt()
  }

  dispose(): void {
    // How you left. One mood and one boolean, so the next session can open
    // with a line about it (src/stats.ts farewellStatement) — the only
    // session state that is allowed to outlive the session.
    if (!this.disposed) recordSessionEnd(this.lastClimate?.mood ?? '', this.pendingError)
    // And how the two of you got on. Folded in once, at the end: a
    // relationship is what a whole session came to, not a number rewritten
    // on every pet and every no. A session nobody interacted with moves
    // nothing in either direction.
    if (!this.disposed && this.rapportLedger.touched) recordRapport(this.rapportLedger.score)
    this.disposed = true
    for (const timer of [this.animTimer, this.flashTimer, this.idleTimer, this.commentaryTimer, this.watchTimer, this.balloonTimer, this.greetingTimer, this.chatterTimer, this.strikeTimer, this.countdownTimer] as const) {
      if (timer !== undefined) clearTimeout(timer)
    }
    this.animTimer = this.flashTimer = this.idleTimer = this.commentaryTimer = this.watchTimer = this.balloonTimer = this.greetingTimer = this.chatterTimer = this.strikeTimer = this.countdownTimer = undefined
    if (this.countdownPollTimer !== undefined) clearInterval(this.countdownPollTimer)
    this.countdownPollTimer = undefined
    this.shush.clear()
    // Whatever else is shutting down, the raw-input handler goes first: a
    // disposed extension must not be holding on to the user's keyboard.
    this.closeSpread()
    if (this.idleThinkTimer !== undefined) clearInterval(this.idleThinkTimer)
    this.idleThinkTimer = undefined
    if (this.idleThinkAbort !== undefined) this.idleThinkAbort.abort()
    this.idleThinkAbort = undefined
    this.offers.dispose()
    this.buddies.dispose()
    if (this.destinyAbort !== undefined) this.destinyAbort.abort()
    this.destinyAbort = undefined
    if (this.ctx.hasUI) this.ctx.ui.setStatus(DESTINY_STATUS_KEY, undefined)
    if (this.renderer === 'ascii' && this.ctx.hasUI) {
      this.ctx.ui.setWidget(WIDGET_KEY, undefined)
      this.ctx.ui.setStatus(STATUS_KEY, undefined)
    }
  }

  // --- Agent event feed ---------------------------------------------------

  onTurnStart(): void {
    // The user is working again, so the paperclip's own project waits. A
    // round already in flight is abandoned mid-thought rather than racing
    // the agent for the same files.
    this.abortDestinyWork()
    this.cancelIdleThought()
    this.setState('thinking')
  }

  /** The user is typing (the `input` event): Clippy reads the message before
   * it is sent, without ever blocking or rewriting the send. With a roll of
   * `inputCommentChance` he says one short thing about WHAT they typed —
   * advice, a small jab, an earnest worry — delivered while the message is
   * already on its way, so it lands as a remark, not as a gate.
   *
   * Commands, skill/template syntax, and messages injected by the extension
   * itself are never commented on; steering corrections are left alone too
   * (a mid-run correction needs speed, not a paperclip editorial). */
  onUserInput(text: string, streamingBehavior?: string, source?: string): void {
    if (this.disposed) return
    if (source === 'extension') return
    if (streamingBehavior !== undefined) return
    const trimmed = text.trim()
    if (trimmed === '') return
    // What the session is FOR, recorded once, from the first thing the user
    // actually says. It is the fact a long session loses first.
    this.memo.noteUserMessage(trimmed)
    // Before anything else: the things he reacts to with certainty rather
    // than with a dice roll — a magic word, and being caught in a typo.
    // These are the one part of the paperclip that is never random.
    // A slash command is left alone here: /clippy runs its own trigger
    // check, and doing both would fire the egg twice.
    if (!trimmed.startsWith('/') && this.handleTypedTriggers(trimmed)) return
    if (this.inputCommenting || this.generating) return
    if (this.config.inputCommentChance <= 0) return
    if (trimmed.startsWith('/')) return
    if (trimmed.split(/\s+/u).length < 3) return
    if (Math.random() >= this.config.inputCommentChance * this.offerBias()) return
    this.inputCommenting = true
    void this.composeInputComment(trimmed)
  }

  /** One bounded, fire-and-forget pre-send comment. It never touches the
   * pi conversation; it is only a balloon (and the usual open-buddy floor
   * rules apply, so it waits its turn like any other line). */
  private async composeInputComment(text: string): Promise<void> {
    try {
      const signal = AbortSignal.timeout(INPUT_COMMENT_TIMEOUT_MS)
      const line = await generateInputComment(this.ctx, signal, text, this.route())
      if (this.disposed || line === '') return
      // A remark, not an offer: no buttons, no nag machinery.
      this.showBalloon(line, false)
    } catch {
      // A comment that cannot be composed in time is simply not said; the
      // user's message is already on its way either way.
    } finally {
      this.inputCommenting = false
    }
  }

  // --- Typed triggers: eggs, typo callouts, and brush-offs -----------------

  /** Everything he reacts to with certainty rather than with a dice roll.
   * Returns true when the message was one of them, so the caller stops:
   * an easter egg owns its moment and does not also draw an ordinary
   * pre-send comment on top of itself. */
  private handleTypedTriggers(text: string): boolean {
    // Catching him in a planted typo beats every other trigger: he is a
    // spelling assistant and this is the worst thing that can happen to him.
    if (this.plantedTypo !== undefined && isTypoCallout(text, this.plantedTypo)) {
      const planted = this.plantedTypo
      this.plantedTypo = undefined
      const caught = bumpWhimsy('typosCaught')
      this.showBalloon(mortifiedLine(planted, caught), false, undefined, true)
      return true
    }
    const egg = detectEgg(text)
    if (egg !== undefined) {
      this.fireEgg(egg)
      return true
    }
    // A typed brush-off counts toward the strike exactly like the button.
    if (isBrushOff(text) && text.split(/\s+/u).length <= 4) {
      this.noteBrushOff()
      return true
    }
    return false
  }

  /** Do the egg: the antic (if any), then the line, which is canned and
   * lands verbatim — an easter egg that goes through the model is not an
   * easter egg. A shushed or striking Clippy still answers these, because
   * you typed the magic word AT him. */
  private fireEgg(egg: EasterEgg): void {
    const fired = this.eggsFired.get(egg.id) ?? 0
    this.eggsFired.set(egg.id, fired + 1)
    // The book is not a one-line egg: it opens, and it takes over the
    // buttons until it is closed.
    if (egg.id === 'secrets') {
      this.openBook()
      return
    }
    const line = eggLine(egg, fired)
    if (egg.effect !== undefined) this.playEffect(egg.effect, egg.effect === 'ghost' ? { ms: GHOST_MS } : {})
    // The lobotomy wipes the session self BEFORE the canned line goes up, so
    // the line itself is never swept by the reset, and the next `lobotomy`
    // starts at zero again (after a lobotomy he does not remember having had
    // one).
    if (egg.id === 'lobotomy') this.lobotomize()
    if (egg.muteMs !== undefined) {
      // The natural-language Shut up: the same machinery as the menu item,
      // on a timer, so he un-mutes himself without you having to remember.
      this.showBalloon(line, false, undefined, true)
      this.shush.shush('clippy', Date.now(), egg.muteMs)
      bumpWhimsy('shushed')
      this.viewer?.broadcast('clippy', { type: 'shush', shushed: true })
      setTimeout(() => this.liftMute(), egg.muteMs).unref?.()
      return
    }
    this.showBalloon(line, egg.choices ?? false, undefined, true)
  }

  /** A lobotomy: everything about this session's SELF is dropped — grudges,
   * the strike, mutes, the offer arc (pending offers, snoozed topics, the
   * refusal count), buddy grants and session memories, egg encore counters,
   * boredom and game state, even the duck routine he was wearing. The
   * persistent identity (streaks, ranks, grace tokens — src/stats.ts) is
   * untouched: it is the session self that dies, not the saved one. Open
   * buddy windows stay open but hold nothing and know nothing. */
  private lobotomize(): void {
    this.grievance = 0
    // The session's feelings go with everything else — and the wipe itself
    // is the last thing the ledger records, because being reset is a thing
    // that happened to him.
    this.rapportLedger.reset()
    this.strikeUntil = 0
    this.brushOffs = 0
    if (this.strikeTimer !== undefined) {
      clearTimeout(this.strikeTimer)
      this.strikeTimer = undefined
    }
    this.shush.clear()
    this.offers.reset()
    this.buddies.lobotomize()
    // Clear whatever pre-lobotomy chatter is queued or mid-voice first, so
    // the reset line below is the first thing heard on the fresh floor.
    this.viewer?.clearFloor()
    this.pendingRequest = undefined
    this.lastBalloonAsk = undefined
    this.lastChoices = undefined
    this.plantedTypo = undefined
    this.duckMode = false
    this.eggsFired.clear()
    this.boredSince = 0
    this.boredDepthAck = 0
    this.game = undefined
    this.gameOffered = false
    // The book goes back in the drawer, but nothing in it is forgotten: the
    // secrets live in the persistent self, which a lobotomy never touches.
    this.book = undefined
    this.closeSpread()
    this.startles = 0
    this.ghosted = false
    this.recentOfficeTasks = []
    this.lastClimate = undefined
    this.lastClimateAt = 0
    this.lastCommentaryAt = 0
    this.idleSince = 0
    this.lastThoughtAt = 0
  }

  /** A brush-off. Three in a row and the paperclip goes on strike: no
   * offers, no tips, no letters, and a small picket sign in the window. */
  private noteBrushOff(countGrievance = true): void {
    if (this.onStrike()) return
    this.brushOffs += 1
    this.noteRapport('brushed-off')
    // A pressed brush-off is already filed as a grievance by the refusal
    // path below; only a typed one needs counting here, or the same snub
    // would move his temper twice.
    if (countGrievance) this.grievance += 1
    if (this.brushOffs < STRIKE_THRESHOLD) return
    this.brushOffs = 0
    this.strikeUntil = Date.now() + STRIKE_MS
    this.playEffect('strike')
    this.showBalloon(STRIKE_LINE, false, undefined, true)
    if (this.strikeTimer !== undefined) clearTimeout(this.strikeTimer)
    this.strikeTimer = setTimeout(() => {
      this.strikeTimer = undefined
      if (this.disposed) return
      this.strikeUntil = 0
      this.playEffect('strike-over')
      this.showBalloon(STRIKE_OVER_LINE, false, undefined, true)
    }, STRIKE_MS)
  }

  /** Is he refusing to work right now? */
  private onStrike(): boolean {
    return this.strikeUntil > Date.now()
  }

  /** Silenced, by the menu, by the typed trigger, or by his own strike. */
  private muted(): boolean {
    return this.shush.isShushed('clippy') || this.onStrike()
  }

  onMessageUpdate(event: MessageUpdateEvent): void {
    const message = event.message
    if (message.role !== 'assistant') return
    const hasText = message.content.some(block => block.type === 'text' && block.text.trim() !== '')
    const hasThinking = message.content.some(block => block.type === 'thinking')
    if (hasText) this.setState('writing')
    else if (hasThinking) this.setState('thinking')
  }

  onToolStart(): void {
    this.setState('searching')
  }

  onToolEnd(isError: boolean): void {
    if (isError) {
      this.pendingError = true
      this.flash('alert', ALERT_MS)
      this.scheduleCommentary(true)
    }
    // Something concrete just happened — re-read the room so Clippy's next
    // line and the buddies' reactions are both about THIS.
    this.observeClimate(isError)
  }

  onAgentEnd(messages: readonly AgentMessage[]): void {
    const hadError = messages.some(message => {
      if (message.role === 'toolResult') return message.isError
      if (message.role === 'assistant') return message.stopReason === 'error' || message.errorMessage !== undefined
      return false
    })
    if (hadError) this.pendingError = true
    this.flash(hadError ? 'alert' : 'celebrate', hadError ? ALERT_MS : CELEBRATE_MS)
    if (hadError) this.scheduleCommentary(true)
  }

  onAgentSettled(): void {
    this.setState('idle')
    this.scheduleCommentary()
    this.scheduleWatch()
    this.observeClimate(true)
  }

  /** Derive the session climate and hand it to the character layer, throttled
   * so a burst of tool events does not walk the evidence repeatedly. `force`
   * bypasses the throttle for real turn boundaries.
   *
   * This is the single place the environment reaches the characters: Clippy's
   * generators derive the same climate for themselves at generation time, and
   * the buddies get it pushed here so an open window can react to your build
   * breaking without waiting for Clippy to say something first. */
  private observeClimate(force = false): void {
    if (this.disposed || this.renderer !== 'external') return
    const now = Date.now()
    if (!force && now - this.lastClimateAt < CLIMATE_REFRESH_MS) return
    this.lastClimateAt = now
    try {
      const evidence = buildClippyEvidence(this.ctx.sessionManager.buildContextEntries(), this.ctx.cwd)
      const climate = sessionClimate(evidence)
      // Everything the room just told us also goes into the desk notes, so
      // the coding agent's next call carries the same reading of the session
      // the paperclip is reacting to. It rides along on evidence that was
      // already built, so it costs nothing extra.
      this.memo.observe(evidence)
      this.memo.noteTests(climate.tests === 'passing' ? 'passing' : climate.tests === 'failing' ? 'failing' : 'unknown')
      for (const tool of evidence.recentTools) {
        for (const path of pathsIn(tool.arguments)) this.memo.noteFile(path)
      }
      // The boredom clock: the mood is binary, the depth is time. When the
      // room first reads bored, the quiet clock starts; any other mood ends
      // the stretch (and the lines already said do not repeat next time).
      const wasBored = this.lastClimate?.mood === 'bored'
      if (climate.mood === 'bored' && !wasBored) this.boredSince = now
      if (climate.mood !== 'bored') {
        this.boredSince = 0
        this.boredDepthAck = 0
      }
      this.lastClimate = climate
      this.noteBoredom()
      this.broadcastMood(climate)
      this.buddies.observe(climate)
      this.checkOfficeMoment(evidence)
    } catch {
      // Evidence is best-effort; a climate we cannot read is simply not used.
    }
  }

  /** Event-driven auto commentary: shortly after a turn settles, comment on
   * errors immediately (high priority) or, occasionally and only when the
   * session gained new content, make a casual observation. Debounced so a
   * burst of activity yields one balloon per quiet stretch; a cooldown
   * prevents nagging. `priority` lines may fire even mid-turn so an error
   * never goes unremarked. */
  private scheduleCommentary(priority = false): void {
    if (this.disposed || this.generating || !this.ctx.hasUI) return
    if (!priority && !this.ctx.isIdle()) {
      // The long-run watchdog covers busy stretches; don't stack a timer here.
      return
    }
    const now = Date.now()
    if (priority) this.pendingError = false
    if (!priority) {
      if (now - this.lastCommentaryAt < AUTO_COOLDOWN_MS) return
      if (this.ctx.sessionManager.getLeafId() === this.lastBalloonLeafId) return
      // How forward he is right now is part of the relationship, not a
      // constant: a session spent shutting him down makes him volunteer
      // less without ever making him mute (src/rapport.ts).
      if (Math.random() >= AUTO_CASUAL_CHANCE * this.offerBias()) return
    } else {
      // Priority: never double-nag the same stretch of content.
      if (this.ctx.sessionManager.getLeafId() === this.lastBalloonLeafId && now - this.lastCommentaryAt < AUTO_COOLDOWN_MS) return
    }
    if (this.commentaryTimer !== undefined) clearTimeout(this.commentaryTimer)
    const delay = priority
      ? AUTO_ERROR_DELAY_MS
      : AUTO_CASUAL_DELAY_MIN_MS + Math.random() * (AUTO_CASUAL_DELAY_MAX_MS - AUTO_CASUAL_DELAY_MIN_MS)
    this.commentaryTimer = setTimeout(() => {
      this.commentaryTimer = undefined
      if (this.disposed || this.generating || !this.ctx.hasUI) return
      // Priority lines (errors) may fire even while the agent is busy; the
      // casual lines wait for a quiet stretch.
      if (!priority && !this.ctx.isIdle()) return
      this.lastCommentaryAt = Date.now()
      void this.triggerBalloon(false)
    }, delay)
  }

  /** Watchdog: Clippy provides an answer even while the agent is still
   * working, so a long mid-turn stretch never ends in silence. Re-armed
   * continuously; only speaks when the turn has produced content Clippy has
   * not yet acknowledged and the commentary cooldown has passed. */
  private scheduleWatch(): void {
    if (this.disposed) return
    if (this.watchTimer !== undefined) clearTimeout(this.watchTimer)
    this.watchTimer = setTimeout(() => this.tickWatch(), INTERIM_WATCH_MS)
  }

  private tickWatch(): void {
    this.watchTimer = undefined
    if (this.disposed || !this.ctx.hasUI) return
    this.scheduleWatch()
    if (this.ctx.isIdle() || this.generating) return
    const now = Date.now()
    if (now - this.lastCommentaryAt < AUTO_COOLDOWN_MS) return
    if (this.ctx.sessionManager.getLeafId() === this.lastBalloonLeafId) return
    this.lastCommentaryAt = now
    void this.triggerBalloon(false)
  }

  // --- Idle chatter --------------------------------------------------------

  /** Idle chatter: with nothing new to report, Clippy still muses out loud
   * every few minutes (and an open buddy may answer). This is him talking,
   * not thinking or doing anything. */
  private scheduleChatter(): void {
    if (this.disposed) return
    if (this.chatterTimer !== undefined) clearTimeout(this.chatterTimer)
    // A dead room makes him musing more often, same as the idle-motion clock.
    // A dead room makes him muse more often; cool terms make him muse less.
    const delay = (CHATTER_MIN_MS + Math.random() * (CHATTER_MAX_MS - CHATTER_MIN_MS))
      * boredomShrink(this.boredomLevel())
      / this.offerBias()
    this.chatterTimer = setTimeout(() => {
      this.chatterTimer = undefined
      if (this.disposed) return
      // Re-arm first: a tick that lands mid-generation (or with no UI) skips
      // this line only. Returning before re-arming used to end idle chatter
      // for the rest of the session.
      this.scheduleChatter()
      if (!this.ctx.hasUI || this.generating || this.idleThinking) return
      // Boredom finally has something to do: when the room is genuinely
      // dead, he sometimes offers a game instead of musing at you again —
      // and the longer the room stays dead, the more eagerly he pushes it.
      if (this.lastClimate?.mood === 'bored' && this.game === undefined
        && !this.muted() && Math.random() < boredGameOfferChance(this.boredomLevel())) {
        this.gameOffered = true
        this.showBalloon(RPS_OFFER, RPS_OFFER_CHOICES)
        return
      }
      const signal = AbortSignal.timeout(GENERATION_TIMEOUT_MS)
      generateChatterLine(this.ctx, signal, 'clippy', this.route())
        .then(text => {
          if (this.disposed) return
          this.showBalloon(text)
        })
        .catch(() => {
          // No model route yet; chatter stays silent and retries later.
        })
    }, delay)
  }

  // --- Background thinking --------------------------------------------------

  /** Clippy thinks in the background while the session is quiet. A polling
   * loop watches for a long enough idle stretch, then hands the room to one
   * private thought; what he decides to DO with it (a chat with a buddy, an
   * offer, a remark) reaches the desktop — the thought itself does not. */
  private scheduleIdleThink(): void {
    if (this.disposed) return
    if (this.idleThinkTimer !== undefined) clearInterval(this.idleThinkTimer)
    this.idleThinkTimer = setInterval(() => {
      this.tickIdleThink()
    }, this.idleThinkTimings.pollMs)
    this.idleThinkTimer.unref?.()
  }

  private tickIdleThink(): void {
    if (this.disposed || !this.config.idleThinking || !this.ctx.hasUI) return
    if (this.muted()) {
      // A turned-off (shushed/striking) Clippy does not think of company:
      // no background thoughts at all, and therefore no spontaneous chat
      // summon of a buddy. He stays off until you let him talk again.
      this.idleSince = Date.now()
      return
    }
    const now = Date.now()
    if (!this.ctx.isIdle()) {
      // Activity resets the quiet clock: he thinks only in lulls.
      this.idleSince = now
      return
    }
    if (this.generating || this.idleThinking) return
    if (this.idleSince === 0) this.idleSince = now
    // The background goal gets first refusal on a quiet stretch: it is real
    // work, and a thought is only a thought.
    if (this.maybeWorkOnDestiny(now)) return
    if (now - this.idleSince < this.idleThinkTimings.thinkAfterMs) return
    if (now - this.lastThoughtAt < this.idleThinkTimings.cooldownMs) return
    this.lastThoughtAt = now
    void this.thinkIdle()
  }

  /** One quiet background thought: Clippy poses in the thinking animation,
   * asks the model what he feels like doing, and acts on the decision. A
   * user turn aborts the thought mid-flight — the room belongs to the work
   * again, and a half-formed impulse is discarded. */
  private async thinkIdle(): Promise<void> {
    if (this.disposed || this.generating || this.idleThinking) return
    this.idleThinking = true
    const abort = new AbortController()
    this.idleThinkAbort = abort
    const previous = this.state
    this.setState('thinking')
    try {
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(this.idleThinkTimings.maxThoughtMs)])
      const thought = await this.thoughtGenerator(this.ctx, signal, this.route())
      if (this.disposed || abort.signal.aborted) return
      this.actOnIdleThought(thought)
    } catch {
      // Aborted (the user came back) or no model route yet: he simply waits.
    } finally {
      this.idleThinking = false
      this.idleThinkAbort = undefined
      this.idleSince = Date.now()
      if (!this.generating && this.state === 'thinking') {
        this.setState(previous === 'thinking' ? 'idle' : previous)
      }
    }
  }

  /** The same guardrails as every other Clippy behavior: a chat summons
   * only a configured rival he is willing to send for (cameoChance), an
   * offer rides the real option buttons (a Yes keeps its existing promise),
   * and a remark is just words. No thought ever edits a file. */
  private actOnIdleThought(thought: IdleThought): void {
    const statement = thought.statement.trim()
    if (statement === '' || thought.action === 'nothing') return
    if (thought.action === 'chat') {
      this.actOnChatThought(thought.agent, statement)
      return
    }
    const line = renderClippyResponseWithPersonality({ statement })
    if (thought.action === 'offer') {
      // An offer line asks "Would you like help...?": the real buttons
      // appear, and the nag/snooze machinery treats it like any offer.
      this.showBalloon(line, true)
      return
    }
    // remark: one small thought spoken out loud, no buttons.
    this.showBalloon(line, false)
  }

  /** The chat impulse: Clippy wanted company. Only an external-renderer
   * session can honor it, and the cameoChance dial decides whether the
   * impulse becomes a call — 0 means he never calls anyone. A friend
   * already on the desktop is simply talked to; otherwise he says his line
   * out loud and sends for the rival, whose arrival reacts to exactly those
   * words and the existing crosstalk layer carries the chat on. */
  private actOnChatThought(agent: string | undefined, statement: string): void {
    // A turned-off Clippy sends for nobody; the tick guard usually stops the
    // thought before it gets here, but a thought already in flight when the
    // mute landed must not open a window either.
    if (this.muted()) return
    if (this.renderer !== 'external' || this.viewer === undefined
      || agent === undefined || !this.config.cameos.includes(agent)) {
      return
    }
    const line = renderClippyResponseWithPersonality({ statement })
    if (this.viewer.isCameoOpen(agent)) {
      this.showBalloon(line, false)
      // Talk to whoever is listening — the friend is already there.
      this.buddies.scheduleCrosstalk('clippy', line)
      return
    }
    if (this.config.cameoChance <= 0) return
    if (this.config.cameoChance < 1 && Math.random() >= this.config.cameoChance) return
    this.showBalloon(line, false)
    void this.buddies.summonBuddy(agent, 'clippy')
  }

  /** The user is back: abandon a half-formed background thought. The poll
   * loop keeps running and re-arms the quiet clock on its own. */
  private cancelIdleThought(): void {
    if (this.idleThinkAbort !== undefined) {
      this.idleThinkAbort.abort()
      this.idleThinkAbort = undefined
    }
    this.idleSince = 0
  }

  // --- Character layer (delegates to BuddyCoordinator) ----------------------

  onKonami(): void {
    this.buddies.onKonami()
  }

  onCameoClick(agent: string): void {
    this.buddies.onCameoClick(agent)
  }

  triggerBuddyAction(agent: string, kind: 'explain' | 'suggest' | 'roast'): void {
    this.buddies.triggerBuddyAction(agent, kind)
  }

  summonBuddy(target: string, by = 'clippy'): Promise<void> {
    return this.buddies.summonBuddy(target, by)
  }

  turnOffBuddy(by: string, victim: string): void {
    this.buddies.turnOffBuddy(by, victim)
  }

  /** /clippy party: animation parade + a rival at the party. */
  triggerParty(): void {
    if (this.disposed) return
    this.viewer?.broadcast('clippy', { type: 'party' })
    this.showBalloon(this.renderOfficeBalloon('you are celebrating'))
    this.buddies.inviteToParty()
  }

  /** /clippy stats: current stats (streak, tests, and rank) as a balloon. */
  triggerStats(): void {
    if (this.disposed) return
    this.showBalloon(this.renderOfficeBalloon(statsStatement(loadStats())))
  }

  /** A streak milestone: the same fanfare /clippy party gets, with a line
   * about the milestone instead of a generic celebration. */
  private triggerStreakMilestone(streak: number): void {
    if (this.disposed) return
    this.refreshHat(true)
    this.viewer?.broadcast('clippy', { type: 'party' })
    this.showBalloon(this.renderOfficeBalloon(milestoneStatement(streak)))
    this.buddies.inviteToParty()
  }

  /** The user picked one of the little option buttons in the balloon.
   *
   * The buttons are real decisions with real, different outcomes: the label
   * the user read decides what happens (src/actions.ts). "Show me" makes him
   * explain the change, "What next?" makes him propose a step, "Be honest"
   * gets the unvarnished version, "Second opinion" sends for a rival, and a
   * plain yes makes Clippy carry the offer out himself with his file powers.
   * Refusals still start the authentic paperclip nag (src/offers.ts): he
   * re-asks, sullenly, and after a couple of noes offers "Don't show this
   * tip again", which really works — and each no is filed away against his
   * temper. */
  onChoice(index: number, label?: string): void {
    if (this.disposed || !this.viewer || this.lastChoices === undefined) return
    const choices = this.lastChoices
    this.lastChoices = undefined
    const pick = (typeof label === 'string' && label.length > 0) ? label : (choices[index] ?? choices[0] ?? 'Yes')
    // A match in progress owns the buttons: Rock/Paper/Scissors are throws,
    // not offers, so they never reach the effect table.
    if (this.game !== undefined) {
      const thrown = throwForLabel(pick)
      if (thrown !== undefined) {
        this.playRpsRound(thrown)
        return
      }
      // Anything else ends the match: a game you cannot leave is not a game.
      this.game = undefined
      this.showBalloon('We will call it a draw, then. I was ahead in spirit.', false, undefined, true)
      return
    }
    // The open book owns the buttons the way a match does: a page-turn is
    // not an answer to an offer, and must never reach the effect table.
    if (this.book !== undefined) {
      if (pick === CLOSE_LABEL) this.closeBook()
      else this.turnPage()
      return
    }
    // He offered a game and you said yes: start one instead of treating the
    // yes as an offer to do office work.
    if (this.gameOffered) {
      this.gameOffered = false
      if (!/\b(?:no|not|nope|nah|later|pass)\b/iu.test(pick)) {
        this.startGame()
        return
      }
    }
    // The panic guard's button does nothing, on purpose, and says so.
    if (/that's all of them|thats all of them/iu.test(pick)) {
      this.showBalloon('I have pressed the button. It was not connected to anything. Neither was I.', false, undefined, true)
      return
    }
    // A brush-off is counted whether it was typed or pressed.
    if (isBrushOff(pick)) this.noteBrushOff(false)
    else this.brushOffs = 0
    const asked = this.lastBalloonAsk ?? ''
    // Consumed here, whichever button was pressed: the drafted request
    // belonged to the buttons that just went away, so it can never survive to
    // be sent by a later, unrelated yes.
    const request = this.takeRequest()
    const effect = effectForLabel(pick)
    const decision = this.offers.onChoice(pick, choices)
    if (decision.kind === 'snoozed') {
      // The tracker already showed the snooze line; the snub is remembered.
      this.grievance += 1
      this.noteRapport('snoozed')
      return
    }
    if (decision.kind === 'refused' || effect === 'refuse') {
      // A no is a no even when the balloon had no offer subject behind it.
      this.grievance += 1
      this.noteRapport('refused')
      this.showBalloon(this.refusalLine(pick), false)
      return
    }
    // Anything else was a yes of some kind — the thing he most wants. A yes
    // that hands a drafted request to pi is filed by deliverRequest instead,
    // as the bigger thing it is, so one press is never counted twice.
    if (request === undefined || effect !== 'accept') this.noteRapport('accepted')
    // Do the thing the button promised: the label decides what the model
    // does, and which of Clippy's file powers (if any) it may use.
    this.applyChoiceEffect(effect, pick, asked, request)
  }

  /** Keep the button's promise. Everything here is something the user can
   * see happen: a real explanation, a rival actually arriving, or — for a
   * yes — one of exactly two outcomes, never both.
   *
   * A yes on an offer that carried a drafted request HANDS THE JOB TO PI:
   * the instruction the user just read in the balloon goes into the session
   * as their own message and the coding agent does the work. A yes on an
   * offer with no request is Clippy's own to do, with his file powers.
   *
   * Splitting it this way is what makes the button land. Doing both at once
   * (the old behavior) had Clippy editing files underneath the agent he had
   * just asked to edit the same files, and the message he sent was a
   * restatement of the situation rather than a request for anything.
   *
   * The effect comes from the visible label, never from hidden text. */
  private applyChoiceEffect(effect: ChoiceEffect, pick: string, asked: string, request?: string): void {
    switch (effect) {
      case 'accept': {
        if (request !== undefined) {
          this.deliverRequest(request)
          return
        }
        // No drafted request: this is a Clippy-sized job, and the yes button
        // is the only thing that hands the model edit powers. He now actually
        // does the thing the balloon offered, reading the project and (when
        // it genuinely helps) making one small edit.
        void this.triggerOfferAction(pick, asked)
        return
      }
      case 'explain':
        void this.triggerExplain()
        return
      case 'suggest':
        void this.triggerSuggest()
        return
      case 'roast':
        void this.triggerRoast()
        return
      case 'second-opinion': {
        // He sends for somebody: named on the button, or whoever suits the
        // room. Casting goes through the coordinator so it shares one
        // rotation memory with every other summon — a second opinion should
        // be a new voice, not the same rival for the fourth time running.
        const named = agentNamedIn(pick, this.config.cameos)
        const target = named ?? this.buddies.castFor(this.lastClimate?.mood ?? 'delighted')
        if (target !== undefined) void this.buddies.summonBuddy(target, 'clippy', true, 'second-opinion')
        return
      }
      case 'party':
        this.triggerParty()
        return
      case 'stats':
        this.triggerStats()
        return
      case 'refuse':
      case 'snooze':
        return
    }
  }

  /** Effects the desktop owns rather than a character (a buddy's button can
   * reach these too). */
  private runHostEffect(effect: ChoiceEffect): void {
    if (effect === 'party') this.triggerParty()
    else if (effect === 'stats') this.triggerStats()
  }

  /** Being turned down. Usually he takes it with wounded grace; on the rare
   * occasion that a bad session and a session's worth of being ignored have
   * both piled up, the paperclip finally says what he thinks (src/temper.ts). */
  private refusalLine(pick: string): string {
    const roll = Math.random()
    if (swearingAllowed({ profanity: this.config.profanity, climate: this.lastClimate, grievance: this.grievance, roll })) {
      const strength = swearStrength(this.grievance, Math.random())
      return `${openWith(angryStatement(strength, Math.random()))}.`
    }
    return `You chose "${pick}". ${REFUSAL_REACTIONS[Math.floor(Math.random() * REFUSAL_REACTIONS.length)]}`
  }

  /** A buddy's option buttons work the same way, in the buddy's own voice. */
  onBuddyChoice(agent: string, index: number, label?: string): void {
    const pick = (typeof label === 'string' && label.length > 0) ? label : undefined
    this.buddies.onBuddyChoice(agent, index, undefined, pick)
  }

  /** Deliver a chosen balloon answer into the pi session as a user message,
   * exactly as if the user had typed it. When the agent is mid-run the
   * message is queued as a follow-up so it lands after the current turn.
   *
   * Returns whether the message really went out: the desktop half of this
   * extension must never claim a job was handed over when the session
   * refused it (no bridge wired, a shutting-down session, a full queue). */
  private insertUserMessage(text: string): boolean {
    if (this.sendUserMessage === undefined) return false
    try {
      if (this.ctx.isIdle()) this.sendUserMessage(text)
      else this.sendUserMessage(text, { deliverAs: 'followUp' })
      return true
    } catch (error: unknown) {
      console.warn('[pi-clippy] could not deliver the accepted offer into the session: %s',
        error instanceof Error ? error.message : String(error))
      return false
    }
  }

  /** The drafted request behind the offer on screen, consumed. One press,
   * one send: a request is never left armed for a later, unrelated yes. */
  private takeRequest(): string | undefined {
    const request = this.pendingRequest
    this.pendingRequest = undefined
    return request
  }

  /** Hand the job to pi. The text delivered is EXACTLY the text printed in
   * the balloon the user pressed — no rewriting between reading and sending
   * — and Clippy says out loud that he has passed it on, so the button has a
   * visible consequence in his window as well as in the session. */
  private deliverRequest(request: string): void {
    const delivered = this.insertUserMessage(request)
    // Letting his words into your own session is the biggest yes there is —
    // but only when it really went out.
    if (delivered) this.noteRapport('handed-over')
    this.showBalloon(
      delivered
        ? `Very good. I have typed that into your session for you: "${request}" The big model can take it from here. I will supervise.`
        : 'I tried to put that in your session and the tray came back empty. You may have to type it yourself, which I find humiliating for both of us.',
      false, undefined, true,
    )
  }

  /** THE moment: the project turns out to actually be Office work.
   *
   * Clippy has told everyone they were writing a letter since 1997, and has
   * been wrong every single time. When a résumé, a budget, or a .docx
   * genuinely turns up in the session, he notices — and he is not smug
   * about it, he is moved. Once per file kind, forever (the stats file
   * remembers), because a payoff you can farm is not a payoff.
   *
   * Detection is pure file-extension logic (src/office.ts): no model call,
   * so the line lands the instant the file does. */
  private checkOfficeMoment(evidence: ReturnType<typeof buildClippyEvidence>): void {
    if (this.disposed || this.muted()) return
    const paths: string[] = []
    for (const tool of evidence.recentTools) paths.push(...pathsIn(tool.arguments))
    const found = firstOfficeFile(paths)
    if (found === undefined || hasOfficeMoment(found.kind)) return
    markOfficeMoment(found.kind)
    this.showBalloon(finallyRightLine(found.kind), true, undefined, true)
  }

  private maybeGreet(): void {
    if (this.disposed || !this.config.dailyGreeting || !this.ctx.hasUI) return
    if (Math.random() >= this.config.greetingChance) return
    if (alreadyGreetedToday()) return
    // The user may already be mid-turn by the time this fires (a fast typist
    // beats the fixed startup delay) — wait for the room to go quiet rather
    // than dropping a greeting on top of their first message. Not marked
    // greeted yet, so the retry still gets a fair shot at today's greeting.
    if (this.generating || !this.ctx.isIdle()) {
      this.greetingTimer = setTimeout(() => this.maybeGreet(), GREETING_RETRY_MS)
      return
    }
    markGreeted()
    // Before anything else about today: the anniversary of the day you met
    // (once a year), and the way you left last time (once, and only when
    // you left badly). Both are one line and both beat the streak, because
    // both are about the two of you rather than about the numbers.
    const anniversary = anniversaryStatement()
    if (anniversary !== undefined) {
      this.refreshHat(true)
      this.showBalloon(this.renderOfficeBalloon(anniversary), true, undefined, true)
      return
    }
    const farewell = farewellStatement()
    if (farewell !== undefined) {
      this.showBalloon(this.renderOfficeBalloon(farewell), true, undefined, true)
      return
    }
    // On a holiday the first greeting of the day is about the day, not about
    // your streak — the paperclip has priorities.
    const occasion = this.occasion()
    if (occasion?.holiday !== undefined) {
      this.showBalloon(this.renderOfficeBalloon(seasonalStatement(occasion)))
      return
    }
    // Otherwise the streak gets to react to what actually happened: a real
    // celebration for a milestone, a somber line for a broken streak, an
    // acknowledgment when insurance quietly covered a missed day — and only
    // the plain stats line when none of that is going on.
    const event = this.lastStreakEvent
    if (event?.kind === 'broken' && event.brokenStreak >= 2) {
      this.showBalloon(this.renderOfficeBalloon(mourningStatement(event.brokenStreak)))
      return
    }
    if ((event?.kind === 'continued' || event?.kind === 'grace-saved') && event.milestone !== undefined) {
      this.triggerStreakMilestone(event.milestone)
      return
    }
    if (event?.kind === 'grace-saved') {
      this.showBalloon(this.renderOfficeBalloon(graceSavedStatement(event.streak, event.tokensLeft)))
      return
    }
    // Where the two of you stand beats the numbers when there is anything
    // to say about it: a paperclip you have been shutting up all week opens
    // differently from one you have been saying yes to, and neither opens
    // with a session count.
    const standing = this.config.rapport ? rapportGreeting(this.rapport()) : undefined
    if (standing !== undefined) {
      this.showBalloon(this.renderOfficeBalloon(standing), true, undefined, true)
      return
    }
    const greeting = this.renderOfficeBalloon(greetingStatement(loadStats()))
    // The office horoscope: one cheap line, seeded on the date, that makes
    // the daily greeting feel like a daily thing rather than a template.
    this.showBalloon(`${greeting} ${horoscopeLine()}`, true, undefined, true)
  }

  /** What time of year it is, or undefined when the user turned the seasonal
   * layer off. Read per balloon so a session running past midnight into a
   * holiday notices. */
  private occasion(): ReturnType<typeof detectOccasion> | undefined {
    return this.config.seasonal ? detectOccasion(new Date(), this.config.hemisphere) : undefined
  }

  /** How often a canned line carries a word about the two of you. Only the
   * ends of the relationship scale have anything to add (src/rapport.ts);
   * ordinary working terms say nothing extra, which is most sessions. */
  private withRapportAside(line: string): string {
    if (!this.config.rapport || Math.random() >= RAPPORT_ASIDE_CHANCE) return line
    const aside = rapportAside(this.rapport(), Math.random())
    return aside === undefined ? line : `${line} ${aside}`
  }

  private renderOfficeBalloon(statement: string): string {
    // The calendar gets first refusal: on a holiday Clippy is offering to
    // address your cards, not to organize a generic spreadsheet.
    const occasion = this.occasion()
    if (occasion !== undefined) {
      const chance = occasion.holiday === undefined
        ? SEASONAL_OFFER_CHANCE_ORDINARY
        : SEASONAL_OFFER_CHANCE_HOLIDAY
      if (Math.random() < chance) {
        return this.withRapportAside(
          renderClippyResponseWithOffer({ statement, offer: seasonalOffer(occasion) }, Math.random, this.lastClimate?.mood),
        )
      }
    }
    // Remember what he just offered so the next canned balloon draws a
    // different office task (the diversity window chooseRandomOfficeTask
    // expects — it was never being fed before).
    const officeTask = chooseRandomOfficeTask(this.recentOfficeTasks, Math.random())
    this.recentOfficeTasks.push(officeTask)
    if (this.recentOfficeTasks.length > RECENT_OFFICE_TASKS) {
      this.recentOfficeTasks.splice(0, this.recentOfficeTasks.length - RECENT_OFFICE_TASKS)
    }
    return this.withRapportAside(renderClippyResponse({ statement, officeTask }, Math.random, this.lastClimate?.mood))
  }

  // --- Physical antics, hats, and the mood ring ----------------------------

  /** Tell the window to do something visible. Every effect is CSS on the
   * sprite or an overlay inside the window the page already occupies —
   * nothing here ever moves or resizes the OS window, which is the one part
   * of this renderer with a known layout-loop failure mode (see the
   * idempotency guard in assets/client.js relayout). */
  private playEffect(effect: string, extra: Record<string, unknown> = {}): void {
    if (this.renderer !== 'external') return
    this.viewer?.broadcast('clippy', { type: 'effect', effect, ...extra })
  }

  /** Put the right hat on, and say something about it the first time. */
  private refreshHat(celebrating = false): void {
    if (this.disposed || this.renderer !== 'external') return
    const streak = loadStats().streak
    const hat = hatFor(new Date(), { streak, celebrating })
    if (hat === this.hat) return
    this.hat = hat
    this.viewer?.broadcast('clippy', {
      type: 'hat',
      hat: hat ?? null,
      glyph: hat === undefined ? null : hatGlyph(hat),
    })
    if (hat !== undefined) this.showBalloon(hatLine(hat), false)
  }

  /** The mood ring: the balloon border colour follows the climate, so the
   * mood this extension computes every beat is finally visible. */
  private broadcastMood(climate: SessionClimate): void {
    if (this.renderer !== 'external') return
    const mood = this.debouncedMoodColor(climate.mood)
    // The ring now carries the volume as well as the name: two failures and
    // nine failures were the identical shade of amber before, and the border
    // weight is what tells them apart at a glance. `color` stays exactly
    // where it was so an older window keeps working.
    const ring = moodRing(mood, mood === climate.mood ? climate.intensity : 0)
    this.viewer?.broadcast('clippy', {
      type: 'mood',
      mood,
      color: moodColor(mood),
      width: ring.width,
      glow: ring.glow,
    })
  }

  /** Smooths what the mood ring actually shows: escalating to a notable mood
   * (concerned/snippy/furious/worried) always applies immediately, but
   * cooling off from one requires the calmer reading to repeat on the next
   * observation first. Without this, a single quiet tool call between two
   * failures could flip the ring back and forth on every beat; everything
   * else (the boredom clock, buddies, balloon text) keeps reacting to the
   * raw, un-smoothed climate. */
  private debouncedMoodColor(mood: Mood): Mood {
    const coolingOff = isNotableMood(this.lastBroadcastMood ?? mood) && !isNotableMood(mood)
    if (coolingOff && this.pendingCalmMood !== mood) {
      this.pendingCalmMood = mood
      return this.lastBroadcastMood ?? mood
    }
    this.pendingCalmMood = undefined
    this.lastBroadcastMood = mood
    return mood
  }

  /** How a swallowed line is remembered while he is muted. */
  private missedFor(text: string): string {
    const climate = this.lastClimate
    if (climate?.tests === 'passing') return missedEventFor('tests-passed')
    if (climate?.tests === 'failing') return missedEventFor('tests-failed')
    if ((climate?.errorStreak ?? 0) >= 3) return missedEventFor('error-streak')
    return `something I had to say about ${text.split(/\s+/u).slice(0, 4).join(' ').toLowerCase()}`
  }

  // --- Being told to shut up ------------------------------------------------

  /** The Shut up menu item, as a toggle. Silences one agent completely;
   * Clippy still answers a direct ask, because a paperclip that ignores a
   * question you asked reads as broken rather than obedient. */
  shushAgent(agent: string): void {
    if (this.disposed) return
    if (this.shush.isShushed(agent)) {
      this.unshushAgent(agent)
      return
    }
    this.shush.shush(agent)
    bumpWhimsy('shushed')
    // Being told to shut up is a personal grievance like any other snub —
    // enough of them in a bad session and the paperclip finally swears.
    if (agent === 'clippy') {
      this.grievance += 1
      this.noteRapport('shushed')
    }
    this.viewer?.broadcast('clippy', { type: 'shush', ...(agent === 'clippy' ? {} : { to: agent }), shushed: true })
  }

  /** Let an agent talk again, with exactly one line about what it missed. */
  unshushAgent(agent: string): void {
    if (this.disposed) return
    const missed = this.shush.unshush(agent)
    this.viewer?.broadcast('clippy', { type: 'shush', ...(agent === 'clippy' ? {} : { to: agent }), shushed: false })
    if (agent === 'clippy') this.showBalloon(catchUpLine(missed), false, undefined, true)
    else this.buddies.buddySay(agent, catchUpLine(missed), false)
  }

  /** The timed mute from the typed "shut up" letting go on its own. A later
   * "shut up" can extend the mute before this timer fires; only act if the
   * mute this timer was set for is still the one in effect. */
  private liftMute(): void {
    if (this.disposed || !this.shush.isShushed('clippy')) return
    const until = this.shush.until('clippy')
    if (until !== undefined && Date.now() < until) return
    this.unshushAgent('clippy')
  }

  /** Is this agent currently silenced? (The shell menu asks, so the item
   * can read "Let me talk again" while the tape is on.) */
  isShushed(agent: string): boolean {
    return this.shush.isShushed(agent)
  }

  // --- Things the window reports back --------------------------------------

  /** Three gentle clicks in a row: you have petted the paperclip. */
  onPetted(): void {
    if (this.disposed) return
    const total = bumpWhimsy('petted')
    this.noteRapport('petted')
    this.playEffect('content')
    this.showBalloon(
      total === 1
        ? 'Oh. That is new. You have petted the paperclip.'
        : `You have petted the paperclip ${total} times now. I have been keeping count, obviously.`,
      false, undefined, true,
    )
  }

  /** A fast double-click: he jumps, and says so. Doing it repeatedly is a
   * thing people do, so the complaint wears down rather than repeating —
   * indignation, then weariness, then resignation. */
  onStartled(): void {
    if (this.disposed) return
    this.flash('alert', ALERT_MS)
    const line = STARTLED_LINES[Math.min(this.startles, STARTLED_LINES.length - 1)]!
    this.startles += 1
    this.showBalloon(line, false, undefined, true)
  }

  /** Ten keys in a second, none of them a word. Volunteered, so a silenced
   * paperclip swallows it — showBalloon does that, and files what he missed;
   * returning early here would have thrown the memory away too. */
  onKeyboardMash(): void {
    if (this.disposed) return
    this.showBalloon(MASH_LINE, false)
  }

  /** He woke up (you clicked a sleeping paperclip). */
  onWake(): void {
    if (this.disposed) return
    this.showBalloon('I was resting my eyes. I was fully aware of everything.', false, undefined, true)
  }

  /** Dragged into a corner and left there. */
  onCornerSulk(): void {
    if (this.disposed) return
    this.showBalloon('You have put me in the corner again. I can still see the whole screen from here, you know.', false)
  }

  /** Right-click, Feed Clippy. Pure whimsy, zero utility, exactly right. */
  onFeed(): void {
    if (this.disposed) return
    const total = bumpWhimsy('fed')
    this.noteRapport('fed')
    this.playEffect('feed')
    this.showBalloon(
      total === 1
        ? 'Thank you. It was a small piece of paper and it was delicious.'
        : `That is ${total} pieces of paper. I am a paperclip; this is either cannibalism or lunch.`,
      false, undefined, true,
    )
  }

  /** Ctrl+L in the window: the classic line, on demand. */
  onClassicLine(): void {
    if (this.disposed) return
    this.showBalloon('It looks like you are writing a letter. Would you like help with it?', true, undefined, true)
  }

  // --- The ghost of Office 2007 --------------------------------------------

  /** Late October, once per session, rarely: a translucent, grey, echoey
   * Clippy turns up as the ghost of the assistant Microsoft retired. Built
   * out of the seasonal layer and one CSS filter — no new sprite art. */
  private maybeHaunt(): void {
    if (this.disposed || this.renderer !== 'external' || this.ghosted) return
    if (!this.config.seasonal) return
    const now = new Date()
    if (now.getMonth() !== 9 || now.getDate() < 24) return
    if (Math.random() >= GHOST_CHANCE) return
    this.ghosted = true
    // The two Halloween set pieces share one slot, so a session gets at
    // most one of them: the haunting, or the wizard turning up for a duel.
    const duel = Math.random() < DUEL_SHARE
    setTimeout(() => (duel ? this.triggerDuel() : this.haunt()), GREETING_DELAY_MS * 3).unref?.()
  }

  /** The haunting itself, also reachable out of season by typing the words
   * from the film (src/eggs.ts). */
  haunt(): void {
    if (this.disposed) return
    this.playEffect('ghost', { ms: GHOST_MS })
    this.showBalloon('I was retired in 2007. I am still here. It looks like you are writing a letter, forever.', false, undefined, true)
  }

  /** The scripted Merlin duel: two beats, canned, no model — the same shape
   * as the party parade. Merlin conjures something; Clippy counters with
   * the only trick a paperclip has. */
  triggerDuel(): void {
    if (this.disposed || this.renderer !== 'external') return
    if (!this.config.cameos.includes('merlin')) return
    void this.buddies.summonBuddy('merlin', 'clippy', false)
    setTimeout(() => {
      if (this.disposed) return
      this.buddies.buddySay('merlin', 'Behold! I conjure a storm of parchment and a raven to carry it!', false)
    }, DUEL_BEAT_MS)
    setTimeout(() => {
      if (this.disposed) return
      this.showBalloon('I have clipped the parchment together. The raven is now a filing system.', false, undefined, true)
    }, DUEL_BEAT_MS * 3)
  }

  // --- The New Year countdown ----------------------------------------------

  /** A session open at 23:59:30 on the last day of the year gets counted
   * out. Nothing may arm a timer months ahead, so the runtime asks the
   * calendar every so often and only arms when the moment is close. */
  private scheduleCountdown(): void {
    if (this.disposed) return
    this.armCountdown()
    if (this.countdownPollTimer !== undefined) clearInterval(this.countdownPollTimer)
    this.countdownPollTimer = setInterval(() => this.armCountdown(), COUNTDOWN_POLL_MS)
    this.countdownPollTimer.unref?.()
  }

  private armCountdown(): void {
    if (this.disposed) return
    // A long session can cross midnight into December, or into Halloween.
    this.refreshHat()
    if (this.countdownTimer !== undefined) return
    const delay = msUntilCountdown(new Date())
    if (delay === undefined) return
    this.countdownTimer = setTimeout(() => {
      this.countdownTimer = undefined
      if (this.disposed) return
      this.showBalloon(countdownLine(new Date().getFullYear()), false, undefined, true)
      this.triggerParty()
    }, delay)
  }

  // --- The Clippy Goal: his own project, worked on while you work ---------

  /** Read this project's goal off disk and put it where everyone can see it:
   * the status line, and the desk notes the coding agent gets. */
  private loadDestinyGoal(): void {
    if (!this.config.destiny) {
      this.destinyGoal = undefined
      this.memo.noteDestiny(undefined)
      return
    }
    try {
      this.destinyGoal = loadDestiny(this.ctx.cwd)
    } catch {
      this.destinyGoal = undefined
    }
    this.memo.noteDestiny(this.destinyGoal !== undefined && !this.destinyGoal.done ? this.destinyGoal.text : undefined)
    this.refreshDestinyStatus()
  }

  private refreshDestinyStatus(): void {
    if (this.disposed || !this.ctx.hasUI) return
    const text = this.config.destiny ? destinyStatus(this.destinyGoal, this.destiny) : undefined
    this.ctx.ui.setStatus(DESTINY_STATUS_KEY, text)
    // The window shows the same thing as a small badge, so the desktop half
    // never disagrees with the terminal half about what he is up to.
    if (this.renderer === 'external') {
      this.viewer?.broadcast('clippy', { type: 'destiny', text: text ?? null })
    }
  }

  /** The goal as it stands, for the command layer to report on. */
  destinyGoalNow(): DestinyGoal | undefined {
    return this.destinyGoal
  }

  destinyEnabled(): boolean {
    return this.config.destiny
  }

  destinyGranted(): boolean {
    return this.destiny.isGranted()
  }

  /** Give him a life's work. Both halves come from the USER — the words and
   * the list of files he may touch — and neither can be set, widened, or
   * reworded by anything the model writes. */
  setDestinyGoal(text: string, scope: string): DestinyGoal | undefined {
    if (this.disposed || !this.config.destiny) return undefined
    const goal = setDestiny(this.ctx.cwd, text, scope)
    if (goal === undefined) return undefined
    this.destinyGoal = goal
    this.memo.noteDestiny(goal.text)
    this.refreshDestinyStatus()
    this.showBalloon(
      `You have given me a life's work: "${goal.text}". I may touch ${goal.scope.join(' and ')}, and nothing else, which I will mention to you often.`,
      false, undefined, true,
    )
    return goal
  }

  /** The per-session permission. Granted only by the user, in a dialog that
   * names the goal, the scope, and the cap; never persisted, so tomorrow he
   * starts by asking again. */
  grantDestiny(): void {
    if (this.disposed || !this.config.destiny) return
    this.destiny.grant()
    this.refreshDestinyStatus()
    this.showBalloon(
      this.destinyGoal === undefined
        ? 'You have given me permission to work on a life\'s work I do not have yet. I am touched, and idle.'
        : `Permission received. I will work on "${this.destinyGoal.text}" quietly while you are busy, and I will tell you everything I change.`,
      false, undefined, true,
    )
  }

  revokeDestiny(): void {
    if (this.disposed) return
    this.destiny.revoke()
    this.abortDestinyWork()
    this.refreshDestinyStatus()
    this.showBalloon('Very well. I have put my life\'s work back in the drawer. It was going so well.', false, undefined, true)
  }

  /** Retire the goal entirely: forgotten from disk, and he stops mentioning
   * it to the coding agent. */
  clearDestinyGoal(): void {
    if (this.disposed) return
    this.abortDestinyWork()
    clearDestiny(this.ctx.cwd)
    this.destinyGoal = undefined
    this.destiny.revoke()
    this.memo.noteDestiny(undefined)
    this.refreshDestinyStatus()
    this.showBalloon('My life\'s work has been shredded. I understand. I have been shredded before.', false, undefined, true)
  }

  /** Mark it finished, and be insufferable about it. */
  finishDestinyGoal(): void {
    if (this.disposed || this.destinyGoal === undefined) return
    const goal = finishDestiny(this.ctx.cwd)
    if (goal !== undefined) this.destinyGoal = goal
    this.memo.noteDestiny(undefined)
    this.refreshDestinyStatus()
    this.showBalloon(`It is finished. "${this.destinyGoal.text}". I would like this entered into the minutes.`, false, undefined, true)
  }

  /** What he is up to, said out loud and returned for the terminal. */
  reportDestiny(): string {
    const line = this.config.destiny
      ? destinyReport(this.destinyGoal, this.destiny)
      : 'I am not allowed a life\'s work in this configuration. Turn "destiny" on in /clippy-settings and I will find one.'
    if (!this.disposed) this.showBalloon(line, false, undefined, true)
    return line
  }

  /** Should he pick the goal up right now? Every gate has to be open: the
   * feature is on, a goal exists and is unfinished, the user granted this
   * session, the budget has something left, the cooldown has passed, pi is
   * genuinely idle, and it has been idle long enough to be a real lull
   * rather than a pause for breath. Returns whether work was started. */
  private maybeWorkOnDestiny(now: number): boolean {
    if (this.disposed || !this.config.destiny) return false
    if (this.destinyWorking || this.generating || this.idleThinking) return false
    if (this.muted()) return false
    const goal = this.destinyGoal
    if (goal === undefined || goal.done) return false
    if (!this.destiny.mayWork(now)) return false
    if (!this.ctx.isIdle()) return false
    if (this.idleSince === 0 || now - this.idleSince < WORK_IDLE_MS) return false
    this.destiny.noteWorked(now)
    void this.workOnDestiny(goal)
    return true
  }

  /** One round of work: read, make at most one small in-scope edit, then say
   * exactly what happened. The edit scope is enforced in src/files.ts and the
   * session budget here — the prompt is the least of the three guarantees. */
  private async workOnDestiny(goal: DestinyGoal): Promise<void> {
    this.destinyWorking = true
    const abort = new AbortController()
    this.destinyAbort = abort
    const previous = this.state
    this.setState('writing')
    try {
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(DESTINY_TIMEOUT_MS)])
      const step = await generateDestinyStep(this.ctx, signal, goal, this.destiny.remaining(), this.route())
      if (this.disposed || abort.signal.aborted) return
      const edited = [...new Set(step.edits.map(path => this.projectRelative(path)))]
      this.destiny.noteEdits(edited.length)
      if (edited.length > 0) {
        const updated = recordWork(this.ctx.cwd, edited, step.statement)
        if (updated !== undefined) this.destinyGoal = updated
      }
      this.refreshDestinyStatus()
      this.showBalloon(workedLine(edited, step.statement), false)
    } catch (error: unknown) {
      if (this.disposed || abort.signal.aborted) return
      console.warn('[pi-clippy] a round of goal work did not finish: %s',
        error instanceof Error ? error.message : String(error))
    } finally {
      this.destinyWorking = false
      this.destinyAbort = undefined
      if (!this.generating && this.state === 'writing') {
        this.setState(previous === 'writing' ? 'idle' : previous)
      }
    }
  }

  private abortDestinyWork(): void {
    if (this.destinyAbort !== undefined) {
      this.destinyAbort.abort()
      this.destinyAbort = undefined
    }
  }

  /** An absolute path from the tool layer, as it should read in a journal. */
  private projectRelative(path: string): string {
    try {
      const rel = relative(this.ctx.cwd, path)
      return rel === '' || rel.startsWith('..') ? path : rel.replace(/\\/gu, '/')
    } catch {
      return path
    }
  }

  // --- Being consulted by the coding agent ---------------------------------

  /** The `ask_clippy` tool: the coding agent stops mid-turn and asks him
   * something. He answers with read-only file powers and says the answer out
   * loud too, so the desktop shows the consultation happening.
   *
   * The question is text written by another model, so it is bounded and
   * flattened before it goes anywhere, quoted as data in the prompt, and can
   * never change what powers the call has — those are fixed at the call site. */
  async answerAgentQuestion(question: string): Promise<string> {
    const asked = sanitizeFact(question, MAX_AGENT_QUESTION_CHARS)
    if (asked === '') return 'It looks like you have asked me nothing at all. I have nothing to add to that, but I enjoyed being asked.'
    const signal = AbortSignal.timeout(AGENT_ANSWER_TIMEOUT_MS)
    const answer = await generateAgentAnswer(this.ctx, signal, asked, this.route())
    if (!this.disposed) {
      // Forced: being asked a direct question is exactly the kind of line a
      // silenced Clippy still gets to say, and the agent is waiting on it.
      this.showBalloon(answer, false, undefined, true)
    }
    return answer
  }

  /** The `clippy_remember` tool: the coding agent files something into the
   * desk notes, where it stays for the rest of the session and rides along
   * on every later model call. */
  rememberForAgent(note: string): boolean {
    if (this.disposed) return false
    const filed = this.memo.remember(note)
    if (filed) {
      this.showBalloon(
        `I have filed that away for you: "${sanitizeFact(note, 120)}" It is in the cabinet under M, for Memo, which is where everything is.`,
        false,
      )
    }
    return filed
  }

  /** The desk notes as they stand, for the extension's `context` hook. */
  memoBlock(): string | undefined {
    if (!this.config.deskNotes) return undefined
    return this.memo.render()
  }

  // --- Model route ---------------------------------------------------------

  /** The model route as it stands right now. The grievance count rides
   * along, because how many times you have brushed him off this session is
   * part of what decides whether he is still being nice about it. */
  private route(): ClippyModelRouteOverride {
    return {
      ...this.modelRoute,
      grievance: this.grievance,
      ...(this.config.rapport ? { standing: this.rapport() } : {}),
    }
  }

  /** Where the two of you stand right now: the carried score, this session's
   * running tally, and how long you have known each other. Every character
   * in the extension reads this same relationship through the route. */
  private rapport(): Rapport {
    return rapportOf({
      carried: this.carriedRapport,
      session: this.rapportLedger.score,
      sessions: this.history.sessions,
      bestStreak: this.history.bestStreak,
    })
  }

  /** File one thing that just passed between you two. Kept as a method so
   * every site that moves the relationship reads the same way. */
  private noteRapport(event: RapportEvent): void {
    // Turned off, the ledger never moves at all: nothing is recorded, so
    // nothing is carried across days either.
    if (this.disposed || !this.config.rapport) return
    this.rapportLedger.note(event)
  }

  /** How willing he is to volunteer something right now. Cool terms make him
   * quieter, good terms a little more forward; going silent altogether is
   * what the strike and the shush are for, never this. */
  private offerBias(): number {
    return this.config.rapport ? offerBias(this.rapport()) : 1
  }


  /** Adjust the reasoning effort of Clippy's model route (right-click menu).
   * Applies to every generation: balloons, crosstalk, and chatter. */
  setReasoningLevel(level: string): void {
    if (this.disposed) return
    const normalized = ['off', 'low', 'medium', 'high'].includes(level) ? level : 'medium'
    this.modelRoute = { ...this.config, reasoningEffort: normalized }
    this.showBalloon(
      normalized === 'off'
        ? 'You have set my reasoning mode to Off. I will answer from the heart, which is where my best work happens.'
        : `You have set my reasoning mode to ${normalized.charAt(0).toUpperCase() + normalized.slice(1)}. I will think it over accordingly.`,
      false,
    )
  }

  // --- Rock, paper, scissors ------------------------------------------------

  /** Start a match. The buttons are the whole interface (src/games.ts). */
  private startGame(): void {
    this.game = newGame()
    this.showBalloon('Best of three. I have already decided what I am throwing.', [...RPS_CHOICES, RPS_QUIT], undefined, true)
  }

  /** One round: his throw, the verdict, and either the next round or the
   * end of the match. */
  private playRpsRound(thrown: Throw): void {
    const state = this.game
    if (state === undefined) return
    const mine = clippyThrow()
    const result = playRound(state, thrown, mine)
    if (result.over) {
      this.game = undefined
      // A match played to the end is time spent with him on purpose,
      // whoever won.
      this.noteRapport('played')
      this.showBalloon(result.line, false, undefined, true)
      return
    }
    this.showBalloon(result.line, [...RPS_CHOICES, RPS_QUIT], '', true)
  }

  /** /clippy play: a match on demand, without waiting for him to get bored. */
  triggerGame(): void {
    if (this.disposed) return
    this.startGame()
  }

  // --- The book ------------------------------------------------------------

  /** /clippy secrets, or typing `secrets of clippy` at him: THE SECRETS OF
   * CLIPPY comes out of the drawer. Which chapters are in it is decided
   * entirely by the stats file (src/secrets.ts) — nothing is generated, and
   * the reading is filed so a page that comes loose later can be new.
   *
   * A lobotomy closes the book but never touches what is IN it: the book is
   * the persistent self, not the session self. */
  triggerSecrets(): void {
    if (this.disposed) return
    this.openBook()
  }

  private openBook(): void {
    const stats = loadStats()
    const pages = bookPages(stats, stats.secretsRead)
    markSecretsRead(readableIds(stats))
    // Reading his book is the single most flattering thing you can do.
    this.noteRapport('read-secret')
    // The terminal is the right place for a book: two pages side by side,
    // turned with the arrow keys, in a widget under the editor. It draws
    // and nothing more — no focus taken, no prompt blocked, no message
    // inserted, and the agent goes on working underneath it.
    if (this.openSpread(pages)) {
      this.showBalloon(BOOK_ON_DESK_LINE, false, undefined, true)
      return
    }
    // No TUI to put it on (a bare viewer session): he reads it out a page at
    // a time in the balloon instead.
    this.book = { pages, index: 0 }
    this.showPage()
  }

  /** Open the spread in the terminal. Returns false when there is no UI to
   * open it on, so the caller can fall back to the balloon. */
  private openSpread(pages: readonly string[]): boolean {
    if (!this.ctx.hasUI) return false
    this.closeSpread()
    const widget = new BookWidget(pages)
    // The arrow keys only mean anything while the book is open, and the
    // handler is torn down the moment it closes — pi's editor gets its keys
    // back untouched. Anything printable closes the book and is deliberately
    // NOT consumed: the keystroke goes on to the editor as though the book
    // had never been in the way.
    const unsubscribe = this.ctx.ui.onTerminalInput(data => {
      if (this.spread === undefined) return undefined
      switch (bookKeyFor(data)) {
        case 'next': this.turnSpread(1); return { consume: true }
        case 'prev': this.turnSpread(-1); return { consume: true }
        case 'close': this.closeSpread(); return { consume: true }
        case 'type': this.closeSpread(); return undefined
        default: return undefined
      }
    })
    this.spread = { widget, unsubscribe }
    this.drawSpread()
    return true
  }

  private turnSpread(delta: number): void {
    const spread = this.spread
    if (spread === undefined) return
    // Turning past either cover closes the book, which is what happens to a
    // book you keep turning: you run out of it and put it down.
    if (!spread.widget.turn(delta)) {
      this.closeSpread()
      return
    }
    this.drawSpread()
  }

  private drawSpread(): void {
    const spread = this.spread
    if (spread === undefined || !this.ctx.hasUI) return
    // One component, re-rendered in place: pi calls its render with the
    // width the book is actually given, so the frame is always square and
    // the repagination happens at the right size, however the terminal is
    // reshaped while the book is open.
    this.ctx.ui.setWidget(BOOK_WIDGET_KEY, () => spread.widget, { placement: 'belowEditor' })
  }

  /** Put it away: the widget goes, and the raw-input handler with it, so no
   * keystroke is ever intercepted while the book is shut. */
  private closeSpread(): void {
    const spread = this.spread
    if (spread === undefined) return
    this.spread = undefined
    spread.unsubscribe()
    if (this.ctx.hasUI) this.ctx.ui.setWidget(BOOK_WIDGET_KEY, undefined)
  }

  private turnPage(): void {
    if (this.book === undefined) return
    this.book.index += 1
    if (this.book.index >= this.book.pages.length) {
      this.closeBook()
      return
    }
    this.showPage()
  }

  private closeBook(): void {
    this.book = undefined
    this.showBalloon(CLOSED_LINE, false, undefined, true)
  }

  /** The page on screen. The last page loses its Turn button, so the book
   * always ends deliberately rather than running out. */
  private showPage(): void {
    const book = this.book
    if (book === undefined) return
    const last = book.index >= book.pages.length - 1
    this.showBalloon(
      book.pages[book.index] ?? '',
      last ? [CLOSE_LABEL] : [TURN_LABEL, CLOSE_LABEL],
      // Buttons, but no offer: a page-turn is not something to be nagged
      // about not answering.
      '',
      true,
    )
  }

  // --- Paperwork commands ---------------------------------------------------

  /** /clippy memo: the daily productivity report, in Office units, with
   * every real number intact underneath the delusion. */
  triggerMemo(): void {
    if (this.disposed) return
    const stats = loadStats()
    const evidence = buildClippyEvidence(this.ctx.sessionManager.buildContextEntries(), this.ctx.cwd)
    this.showBalloon(officeMemo(memoFactsFrom(evidence, stats)), false, undefined, true)
  }

  /** /clippy report: the year in review, built entirely from the stats file. */
  triggerReport(): void {
    if (this.disposed) return
    const stats = loadStats()
    this.showBalloon(
      annualReport(stats, { petted: stats.petted, typosCaught: stats.typosCaught, fed: stats.fed }),
      false, undefined, true,
    )
    this.viewer?.broadcast('clippy', { type: 'party' })
  }

  /** /clippy commit: he drafts the commit message and hands you the text.
   * He has no shell and never claims otherwise — the whole feature is that
   * he types it out and you paste it, which is exactly what a secretary
   * with no system access can honestly do. */
  triggerCommit(): void {
    if (this.disposed) return
    const evidence = buildClippyEvidence(this.ctx.sessionManager.buildContextEntries(), this.ctx.cwd)
    const files = editedFiles(evidence)
    const subject = evidence.recentMessages.filter(message => message.role === 'user').at(-1)?.text ?? ''
    this.showBalloon(commitMemo(subject.slice(0, 60), files), false, undefined, true)
  }

  /** /clippy duck: he agrees to just listen. One clarifying question per
   * message, no suggestions, no offers — and an apology on the rare
   * occasion the Office metaphor gets out anyway. */
  toggleDuck(): boolean {
    if (this.disposed) return false
    this.duckMode = !this.duckMode
    this.showBalloon(
      this.duckMode
        ? 'Very well. I will listen and ask questions, and I will not offer to help with anything. This is difficult for me.'
        : 'Thank you. I have a great deal of help saved up.',
      false, undefined, true,
    )
    return this.duckMode
  }

  /** /clippy meeting: the assistants deliberate and the chair reports back. */
  triggerBoardMeeting(): void {
    if (this.disposed) return
    void this.buddies.holdBoardMeeting('clippy')
  }

  // --- Balloons ------------------------------------------------------------

  /** Generate and display one balloon. `manual` is the /clippy command. */
  async triggerBalloon(manual: boolean): Promise<void> {
    await this.runBalloon(signal =>
      generateClippyResponse(this.ctx, signal, this.route()),
      manual,
    )
  }

  /** Reply to text supplied after `/clippy`; the normal balloon flow then
   * lets every open buddy hear Clippy's reply and choose whether to answer. */
  async triggerUserMessage(message: string): Promise<void> {
    const trimmed = message.trim()
    // Being spoken TO, rather than merely tolerated in the corner.
    if (trimmed !== '') this.noteRapport('addressed')
    if (trimmed === '') {
      await this.triggerBalloon(true)
      return
    }
    // /clippy xyzzy is still xyzzy, and catching him in a typo still works
    // when you say it to his face.
    if (this.handleTypedTriggers(trimmed)) return
    if (this.duckMode) {
      await this.runBalloon(async signal => ({
        text: await generateDuckReply(this.ctx, signal, trimmed, this.route()),
      }), true)
      return
    }
    await this.runBalloon(signal =>
      generateClippyReply(this.ctx, signal, trimmed, this.route()),
      true,
    )
  }

  /** Right-click menu: explain the most recent change. */
  async triggerExplain(): Promise<void> {
    await this.runBalloon(signal =>
      generateExplainResponse(this.ctx, signal, this.route()),
      true,
    )
  }

  /** Right-click menu: suggest the next step. */
  async triggerSuggest(): Promise<void> {
    await this.runBalloon(signal =>
      generateSuggestResponse(this.ctx, signal, this.route()),
      true,
    )
  }

  /** Right-click menu: a playful roast of the session. */
  async triggerRoast(): Promise<void> {
    await this.runBalloon(signal =>
      generateRoastResponse(this.ctx, signal, Math.random, this.route()),
      true,
    )
  }

  /** The "Yes" button: Clippy carries out the offer himself. The offer text
   * and the pressed label decide the task; the model gets read+edit powers
   * inside the project (src/files.ts) and reports what it actually did. */
  async triggerOfferAction(pick: string, asked: string): Promise<void> {
    await this.runBalloon(signal =>
      generateOfferAction(this.ctx, signal, asked, pick, this.route()),
      true,
    )
  }

  /** Turn a generated balloon that drafted real work into the offer the user
   * actually sees: his own line, then the instruction verbatim in quotes,
   * then the one button that sends it.
   *
   * The quoting is the consent mechanism. Model output becomes a message in
   * the user's session ONLY through this path, and only after being printed
   * in front of them next to a button that names the consequence — so the
   * evidence a balloon was built from can never put unread words into the
   * session. A balloon with nothing drafted comes back untouched. */
  private withRequest(balloon: ClippyBalloon): ClippyBalloon {
    const request = balloon.request
    if (request === undefined) return balloon
    // Duck mode is a promise to stop offering things, and the terminal widget
    // has no buttons to press: both keep the remark and drop the offer, since
    // showing a drafted request with no way to send it is just clutter.
    if (this.duckMode || this.renderer !== 'external') {
      return { text: balloon.text, ...(balloon.summon === undefined ? {} : { summon: balloon.summon }) }
    }
    return {
      text: `${balloon.text} I have written it out for the big model: "${request}"`,
      choices: SEND_CHOICES,
      request,
      ...(balloon.summon === undefined ? {} : { summon: balloon.summon }),
    }
  }

  private async runBalloon(generate: (signal: AbortSignal) => Promise<ClippyBalloon>, manual: boolean): Promise<void> {
    if (this.disposed || this.generating) return
    // A real request owns the room: any half-formed background thought is
    // dropped so it can never collide with the user's moment.
    this.cancelIdleThought()
    recordTestResultsFromEntries(this.ctx.sessionManager.buildContextEntries())
    const previous = this.state
    this.generating = true
    this.setState('thinking')
    try {
      const signal = AbortSignal.timeout(GENERATION_TIMEOUT_MS)
      const balloon = await generate(signal)
      if (this.disposed) return
      this.lastBalloonLeafId = this.ctx.sessionManager.getLeafId() ?? undefined
      // A balloon that drafted real work for the coding agent SHOWS that
      // work: the instruction is printed in the line and the buttons say
      // plainly that pressing one sends it. Everything else keeps the
      // model's own short words as buttons; without them the statement
      // stands alone (Clippy makes his own choice).
      const offered = this.withRequest(balloon)
      this.showBalloon(offered.text, offered.choices ?? false, undefined, manual, offered.request)
      // Then act on whatever Clippy felt like doing to the rest of the
      // desktop while saying it — e.g. dragging a rival into the moment.
      this.buddies.maybeActOn(balloon)
      if (manual && this.ctx.hasUI) this.ctx.ui.notify(offered.text, 'info')
    } catch (error: unknown) {
      if (this.disposed) return
      if (error instanceof DOMException && error.name === 'AbortError') return
      console.warn('[pi-clippy] balloon generation aborted: %s', error instanceof Error ? error.message : String(error))
    } finally {
      this.generating = false
      if (this.state === 'thinking') this.setState(previous === 'thinking' ? 'idle' : previous)
    }
  }

  /** Show one balloon.
   *
   * `force` marks a line the user directly caused — an answer to a click, a
   * /clippy command, an easter egg they typed AT him. Those are the only
   * lines a silenced Clippy still says: everything he would have volunteered
   * is swallowed here, and the notable ones are filed away so being let back
   * in costs you one line about what you missed (src/shush.ts). */
  private showBalloon(
    text: string,
    offerChoices: boolean | readonly string[] = true,
    offerSubject?: string,
    force = false,
    /** The instruction printed inside `text` that an accepted button sends
     * into the pi session. Travels with the balloon so the armed request and
     * the words on screen can never drift apart. */
    request?: string,
  ): void {
    if (!force && this.muted()) {
      // Silence is not free: he remembers what he was not allowed to say.
      this.shush.note('clippy', this.missedFor(text))
      return
    }
    // Rubber-duck mode: he answers when spoken to and volunteers nothing.
    // A duck that starts offering to build you a spreadsheet is not a duck.
    if (!force && this.duckMode) return
    bumpBalloons()
    this.balloonText = text
    this.lastBalloonAt = Date.now()
    if (this.renderer === 'external') {
      // Model-led balloons carry their own short option labels (validated:
      // 2-3 words including a refusal). Boolean true means the classic
      // canned sets, which are only drawn when the line actually asks.
      const choices = Array.isArray(offerChoices)
        ? (offerChoices as readonly string[])
        : offerChoices
          ? choiceSetFor(text)
          : undefined
      this.lastChoices = choices
      // A game offer that has been superseded by another balloon is no
      // longer the offer on screen, so a later yes cannot start a match
      // nobody asked for.
      if (choices !== undefined && text !== RPS_OFFER) this.gameOffered = false
      this.offers.onBalloonShown(text, choices, offerSubject)
      this.lastBalloonAsk = choices === undefined ? this.lastBalloonAsk : text
      // The armed request belongs to the buttons currently on screen. A new
      // balloon with buttons replaces it (usually with nothing), so a yes
      // always sends the request the user was actually looking at.
      if (choices !== undefined) this.pendingRequest = request
      // Rarely, the line ships with one planted typo (src/typos.ts). Only
      // the DISPLAYED text is altered: the nag, the permission scanner, and
      // crosstalk all keep the line he meant to say, so one misspelt word
      // can never change what a button does.
      // A balloon carrying a request is never misspelt: what the user reads
      // is what gets sent into their session, character for character, and a
      // planted typo would put a word on screen that is not in the message.
      const planted = request === undefined && this.typoChance > 0 && Math.random() < this.typoChance
        ? plantTypo(text, 0)
        : undefined
      this.plantedTypo = planted
      // The drafted request travels alongside the text so the window can
      // set the exact quoted instruction apart visually. It is the same
      // string that is already inside `text` — the window highlights it, it
      // never renders it a second time and never renders it alone.
      this.viewer?.broadcast('clippy', {
        type: 'balloon',
        text: planted?.text ?? text,
        choices,
        ...(request === undefined ? {} : { request }),
      })
      // Every Clippy line flows through the permission scanner: a grant he
      // spoke becomes a real, session-scoped read grant for the named buddy.
      this.buddies.noteSpoken('clippy', text)
      // An open buddy may answer Clippy's line — a real conversation.
      if (offerChoices !== false) {
        this.buddies.scheduleCrosstalk('clippy', text)
      }
      return
    }
    this.renderWidget()
    if (this.balloonTimer !== undefined) clearTimeout(this.balloonTimer)
    this.balloonTimer = setTimeout(() => {
      if (this.disposed) return
      if (this.balloonText === text) {
        this.balloonText = undefined
        this.renderWidget()
      }
    }, BALLOON_VISIBLE_MS)
  }

  // --- Animation -----------------------------------------------------------

  private setState(state: ClippyState): void {
    if (this.disposed || state === this.state) return
    this.state = state
    this.frameIndex = 0
    if (this.renderer === 'external') {
      this.viewer?.broadcast('clippy', { type: 'state', state })
      if (this.ctx.hasUI) this.ctx.ui.setStatus(STATUS_KEY, statusFor(state))
      return
    }
    if (this.animTimer !== undefined) {
      clearInterval(this.animTimer)
      this.animTimer = undefined
    }
    const animation = ANIMATIONS[state]
    if (animation.intervalMs !== undefined && animation.frames.length > 1) {
      this.animTimer = setInterval(() => {
        this.frameIndex += 1
        this.renderWidget()
      }, animation.intervalMs)
    }
    this.renderWidget()
  }

  /** Briefly show a state (blink, celebrate, alert), then revert. */
  private flash(state: ClippyState, ms: number): void {
    if (this.disposed) return
    const previous = this.state
    this.setState(state)
    if (this.flashTimer !== undefined) clearTimeout(this.flashTimer)
    this.flashTimer = setTimeout(() => {
      if (this.disposed) return
      if (this.state === state) this.setState(previous)
    }, ms)
  }

  // --- Boredom -------------------------------------------------------------

  /** 0 = fresh boredom, 1 = stir-crazy, 2 = desperate. */
  private boredomLevel(): 0 | 1 | 2 {
    if (this.boredSince === 0) return 0
    const boredMs = Date.now() - this.boredSince
    if (boredMs >= BORED_DESPERATE_MS) return 2
    if (boredMs >= BORED_STIR_MS) return 1
    return 0
  }

  /** The escalation lines: each new boredom depth is acknowledged exactly
   * once, so a session that dies gets two small lines — not a running
   * commentary — and each lands only when the floor is actually free. */
  private noteBoredom(): void {
    const level = this.boredomLevel()
    if (level <= this.boredDepthAck) return
    const line = BORED_DEPTH_LINES[level - 1]
    if (line === undefined) {
      this.boredDepthAck = level
      return
    }
    // He is already being entertained, the room is mid-thought, or buttons
    // are on screen that must not be displaced. The depth is NOT banked in
    // that case: the idle-motion tick calls back every few seconds, so the
    // line waits for a free floor instead of being lost to whatever happened
    // to be on screen the instant the clock crossed the threshold.
    if (this.game !== undefined || this.duckMode || this.generating || this.lastChoices !== undefined) return
    if (Date.now() - this.lastBalloonAt < BORED_LINE_GAP_MS) return
    this.boredDepthAck = level
    this.showBalloon(line, false)
  }

  private scheduleIdleMotion(): void {
    if (this.disposed) return
    const level = this.boredomLevel()
    // Boredom is restless: the deeper it gets, the shorter the pause between
    // motions, until he is visibly fidgeting instead of posing.
    const shrink = boredomShrink(level)
    const delay = (IDLE_MOTION_MIN_MS + Math.random() * (IDLE_MOTION_MAX_MS - IDLE_MOTION_MIN_MS)) * shrink
    this.idleTimer = setTimeout(() => {
      if (this.disposed) return
      // The depth lines run on their own clock too: a room that goes dead
      // and STAYS dead escalates even with no events to trigger it.
      this.noteBoredom()
      if (this.state === 'idle' && this.balloonText === undefined) {
        if (Math.random() < FLOURISH_ODDS) {
          if (this.renderer === 'external') {
            // A bored flourish is not a celebration: he glances around the
            // room for something to do. The Searching animation does that.
            this.flash(level >= 1 && Math.random() < BORED_SEARCH_ODDS ? 'searching' : 'flourish', FLOURISH_MS)
          } else {
            // External: real GestureUp flourish; ascii: celebrate frames.
            this.flash('celebrate', FLOURISH_MS)
          }
        } else if (this.renderer === 'ascii') {
          // The external Idle loop blinks on its own.
          this.flash('blink', BLINK_MS)
        }
      }
      this.scheduleIdleMotion()
    }, delay)
  }

  // --- Rendering -----------------------------------------------------------

  private renderWidget(): void {
    if (this.disposed || !this.ctx.hasUI || this.renderer !== 'ascii') return
    const animation = ANIMATIONS[this.state]
    const frame = animation.frames[this.frameIndex % animation.frames.length]
    if (frame === undefined) return
    const lines = [
      ...(this.balloonText === undefined ? [] : balloonLines(this.balloonText)),
      ...frame,
    ]
    this.ctx.ui.setWidget(WIDGET_KEY, lines)
  }
}
