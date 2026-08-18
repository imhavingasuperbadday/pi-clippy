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
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ExtensionContext, MessageUpdateEvent } from '@earendil-works/pi-coding-agent'
import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import { choiceSetFor, BuddyCoordinator, DEFAULT_BUDDY_TIMINGS, type BuddyTimings } from './buddy.ts'
import { defaultClippyConfig, type ClippyConfig } from './config.ts'
import { ANIMATIONS, balloonLines, type ClippyState } from './frames.ts'
import {
  agentNamedIn,
  effectForLabel,
  type ChoiceEffect,
} from './actions.ts'
import { angryStatement, swearStrength, swearingAllowed } from './temper.ts'
import {
  generateChatterLine,
  generateClippyReply,
  generateClippyResponse,
  generateExplainResponse,
  generateIdleThought,
  generateOfferAction,
  generateRoastResponse,
  generateSuggestResponse,
  type ClippyModelRouteOverride,
} from './generator.ts'
import { castForMood } from './cameos.ts'
import { sessionClimate, type SessionClimate } from './mood.ts'
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
import { detectOccasion, seasonalOffer, seasonalStatement } from './seasons.ts'
import {
  alreadyGreetedToday,
  bumpBalloons,
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
/** Watchdog: even mid-turn, Clippy eventually speaks instead of silently
 * "thinking" through a long run. */
const INTERIM_WATCH_MS = 120_000
/** Event-driven auto commentary: react to turn outcomes instead of polling. */
const AUTO_ERROR_DELAY_MS = 5_000
const AUTO_CASUAL_DELAY_MIN_MS = 20_000
const AUTO_CASUAL_DELAY_MAX_MS = 60_000
const AUTO_CASUAL_CHANCE = 0.5
const AUTO_COOLDOWN_MS = 90_000
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

/** Clippy's reaction when the user picks the refusal option, in the real
 * paperclip's voice: he takes it personally, quietly. */
const REFUSAL_REACTIONS = [
  'Fine. I will just be here, in case a letter needs writing.',
  'Understood. I will place that under the pile marked Ignored.',
  'Suit yourself. The help was going to be excellent.',
  'No problem. I will be right here watching, if that is all right.',
  'Very well. I will keep the offer warm for you.',
] as const

const WIDGET_KEY = 'clippy'
const STATUS_KEY = 'clippy'

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
  /** Short subject of the offer behind the current choices (e.g. "the
   * chart"), so picking an option echoes what was actually offered. */
  private lastOfferSubject: string | undefined
  /** The balloon the current buttons belong to. A pressed button acts on
   * what the user actually read, so the effect is built from this text. */
  private lastBalloonAsk: string | undefined
  /** How many times the user has refused, silenced, or ignored an offer this
   * session. Half of what it takes to make the paperclip lose his temper
   * (the other half is the room going badly — see src/temper.ts). */
  private grievance = 0
  /** The most recent reading of the room, kept so a choice reaction and an
   * angry line can consult it without walking the evidence again. */
  private lastClimate: SessionClimate | undefined
  /** What touchSession found at start() — a milestone, a break, a grace
   * save, or nothing notable — for the first greeting of the day to react to. */
  private lastStreakEvent: StreakEvent | undefined
  private recentOfficeTasks: OfficeTask[] = []
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
        if (outcome === 'dismissed') this.grievance += 1
      },
    )
    this.idleThinkTimings = {
      ...DEFAULT_IDLE_THINK_TIMINGS,
      thinkAfterMs: this.config.idleThinkAfterMs,
      cooldownMs: this.config.idleThinkCooldownMs,
      ...options.idleThinkTimings,
    }
    this.thoughtGenerator = options.thoughtGenerator ?? generateIdleThought
  }

  start(): void {
    this.lastStreakEvent = touchSession().event
    this.lastBalloonLeafId = this.ctx.sessionManager.getLeafId() ?? undefined
    this.lastCommentaryAt = 0
    this.pendingError = false
    this.setState('idle')
    this.scheduleIdleMotion()
    this.scheduleChatter()
    this.scheduleIdleThink()
    this.greetingTimer = setTimeout(() => {
      this.maybeGreet()
    }, GREETING_DELAY_MS)
    this.scheduleWatch()
  }

  dispose(): void {
    this.disposed = true
    for (const timer of [this.animTimer, this.flashTimer, this.idleTimer, this.commentaryTimer, this.watchTimer, this.balloonTimer, this.greetingTimer, this.chatterTimer] as const) {
      if (timer !== undefined) clearTimeout(timer)
    }
    this.animTimer = this.flashTimer = this.idleTimer = this.commentaryTimer = this.watchTimer = this.balloonTimer = this.greetingTimer = this.chatterTimer = undefined
    if (this.idleThinkTimer !== undefined) clearInterval(this.idleThinkTimer)
    this.idleThinkTimer = undefined
    if (this.idleThinkAbort !== undefined) this.idleThinkAbort.abort()
    this.idleThinkAbort = undefined
    this.offers.dispose()
    this.buddies.dispose()
    if (this.renderer === 'ascii' && this.ctx.hasUI) {
      this.ctx.ui.setWidget(WIDGET_KEY, undefined)
      this.ctx.ui.setStatus(STATUS_KEY, undefined)
    }
  }

  // --- Agent event feed ---------------------------------------------------

  onTurnStart(): void {
    this.cancelIdleThought()
    this.setState('thinking')
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
      this.lastClimate = climate
      this.buddies.observe(climate)
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
      if (Math.random() >= AUTO_CASUAL_CHANCE) return
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
    const delay = CHATTER_MIN_MS + Math.random() * (CHATTER_MAX_MS - CHATTER_MIN_MS)
    this.chatterTimer = setTimeout(() => {
      this.chatterTimer = undefined
      if (this.disposed) return
      // Re-arm first: a tick that lands mid-generation (or with no UI) skips
      // this line only. Returning before re-arming used to end idle chatter
      // for the rest of the session.
      this.scheduleChatter()
      if (!this.ctx.hasUI || this.generating || this.idleThinking) return
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
    const now = Date.now()
    if (!this.ctx.isIdle()) {
      // Activity resets the quiet clock: he thinks only in lulls.
      this.idleSince = now
      return
    }
    if (this.generating || this.idleThinking) return
    if (this.idleSince === 0) this.idleSince = now
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
    const asked = this.lastBalloonAsk ?? ''
    this.lastOfferSubject = undefined
    const effect = effectForLabel(pick)
    const decision = this.offers.onChoice(pick, choices)
    if (decision.kind === 'snoozed') {
      // The tracker already showed the snooze line; the snub is remembered.
      this.grievance += 1
      return
    }
    if (decision.kind === 'refused' || effect === 'refuse') {
      // A no is a no even when the balloon had no offer subject behind it.
      this.grievance += 1
      this.showBalloon(this.refusalLine(pick), false)
      return
    }
    // Do the thing the button promised: the label decides what the model
    // does, and which of Clippy's file powers (if any) it may use.
    this.applyChoiceEffect(effect, pick, asked)
  }

  /** Keep the button's promise. Everything here is something the user can
   * see happen: a real explanation, a rival actually arriving, or — for a
   * yes — Clippy himself carrying out the offer with his file powers. The
   * effect comes from the visible label, never from hidden text. */
  private applyChoiceEffect(effect: ChoiceEffect, pick: string, asked: string): void {
    switch (effect) {
      case 'accept':
        // The yes button is the only one that hands the model edit powers:
        // Clippy now actually does the thing the balloon offered, reading
        // the project and (when it genuinely helps) making one small edit.
        void this.triggerOfferAction(pick, asked)
        return
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
        // room. The window opens because Clippy asked for it.
        const named = agentNamedIn(pick, this.config.cameos)
        // Prefer somebody who is not already on screen: a second opinion
        // should be a new voice, not the buddy already arguing with him.
        const available = this.config.cameos.filter(agent => this.viewer?.isCameoOpen(agent) !== true)
        const pool = available.length > 0 ? available : this.config.cameos
        const target = named ?? (pool.length === 0
          ? undefined
          : castForMood(this.lastClimate?.mood ?? 'delighted', pool, Math.random(), Math.random()))
        if (target !== undefined) void this.buddies.summonBuddy(target, 'clippy', true)
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
      return `It looks like ${angryStatement(strength, Math.random())}.`
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
   * message is queued as a follow-up so it lands after the current turn. */
  private insertUserMessage(text: string): void {
    if (this.sendUserMessage === undefined) return
    if (this.ctx.isIdle()) this.sendUserMessage(text)
    else this.sendUserMessage(text, { deliverAs: 'followUp' })
  }

  private maybeGreet(): void {
    if (this.disposed || !this.config.dailyGreeting || !this.ctx.hasUI) return
    if (Math.random() >= this.config.greetingChance) return
    if (alreadyGreetedToday()) return
    markGreeted()
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
    this.showBalloon(this.renderOfficeBalloon(greetingStatement(loadStats())))
  }

  /** What time of year it is, or undefined when the user turned the seasonal
   * layer off. Read per balloon so a session running past midnight into a
   * holiday notices. */
  private occasion(): ReturnType<typeof detectOccasion> | undefined {
    return this.config.seasonal ? detectOccasion(new Date(), this.config.hemisphere) : undefined
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
        return renderClippyResponseWithOffer({ statement, offer: seasonalOffer(occasion) })
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
    return renderClippyResponse({ statement, officeTask })
  }

  // --- Model route ---------------------------------------------------------

  /** The model route as it stands right now. The grievance count rides
   * along, because how many times you have brushed him off this session is
   * part of what decides whether he is still being nice about it. */
  private route(): ClippyModelRouteOverride {
    return { ...this.modelRoute, grievance: this.grievance }
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
    if (trimmed === '') {
      await this.triggerBalloon(true)
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
      // The model's own short words are the option buttons; without them
      // the statement stands alone (Clippy makes his own choice).
      this.showBalloon(balloon.text, balloon.choices ?? false)
      // Then act on whatever Clippy felt like doing to the rest of the
      // desktop while saying it — e.g. dragging a rival into the moment.
      this.buddies.maybeActOn(balloon)
      if (manual && this.ctx.hasUI) this.ctx.ui.notify(balloon.text, 'info')
    } catch (error: unknown) {
      if (this.disposed) return
      if (error instanceof DOMException && error.name === 'AbortError') return
      console.warn('[pi-clippy] balloon generation aborted: %s', error instanceof Error ? error.message : String(error))
    } finally {
      this.generating = false
      if (this.state === 'thinking') this.setState(previous === 'thinking' ? 'idle' : previous)
    }
  }

  private showBalloon(text: string, offerChoices: boolean | readonly string[] = true, offerSubject?: string): void {
    bumpBalloons()
    this.balloonText = text
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
      this.lastOfferSubject = offerSubject
      this.offers.onBalloonShown(text, choices, offerSubject)
      this.lastBalloonAsk = choices === undefined ? this.lastBalloonAsk : text
      this.viewer?.broadcast('clippy', { type: 'balloon', text, choices })
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
      if (this.ctx.hasUI) this.ctx.ui.setStatus(STATUS_KEY, state === 'idle' ? undefined : `clippy: ${state}`)
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

  private scheduleIdleMotion(): void {
    if (this.disposed) return
    const delay = IDLE_MOTION_MIN_MS + Math.random() * (IDLE_MOTION_MAX_MS - IDLE_MOTION_MIN_MS)
    this.idleTimer = setTimeout(() => {
      if (this.disposed) return
      if (this.state === 'idle' && this.balloonText === undefined) {
        if (Math.random() < FLOURISH_ODDS) {
          // External: real GestureUp flourish; ascii: celebrate frames.
          if (this.renderer === 'external') this.flash('flourish', FLOURISH_MS)
          else this.flash('celebrate', FLOURISH_MS)
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
