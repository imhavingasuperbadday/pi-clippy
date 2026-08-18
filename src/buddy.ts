/** The buddy character layer, extracted from the runtime: rival Office
 * assistants in their own windows, session-scoped memory of arguments and
 * turn-offs, model-driven crosstalk between windows, annoyance arcs, and
 * the konami summon.
 *
 * The coordinator owns every cameo window decision and every banter timer;
 * the runtime keeps animation, balloons, and agent-event behavior. Lines are
 * canned (src/cameos.ts); conversations between assistants go through the
 * model (generateCrosstalkLine). The messaging layer gives every open window
 * a real, threaded, two-way channel with Clippy:
 *
 * - **systematic**: every line is heard by every open window and any pair
 *   can exchange a response;
 * - **one at a time**: the renderer serializes delivery (a shared floor), so
 *   a buddy's message never lands on top of (or right after) Clippy's —
 *   each message is read before the next is voiced;
 * - **fair**: reply slots are shuffled among the open listeners, so no pair
 *   monopolizes the mic just because it sits early in the roster;
 * - **bounded**: each pair gets a capped number of exchanges per cooldown
 *   window, so two windows can argue but never talk forever;
 * - **thread-aware**: the model sees the pair's recent history, so a
 *   counter-reply references the actual exchange; only lines that were
 *   actually answered enter the transcript;
 * - **reliable**: replies retry with backoff instead of being silently
 *   dropped when Clippy is mid-generation;
 * - **never dropped**: a buddy's line is always answered — Clippy guarantees
 *   an acknowledgment when everyone rolls past the chance (retired if a
 *   real reply lands first), and every agent gets a canned fallback in its
 *   own voice when the model is stuck.
 * - **file access**: Clippy reads on his own and edits only when a yes
 *   button authorizes it; buddies have nothing unless Clippy grants read
 *   access — rare, per-buddy once, and only after they convince him
 *   (src/permission.ts scans every spoken line for the request/grant).
 */
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import {
  agentLabel,
  BANTER_PARTNERS,
  banterRebuttal,
  banterReply,
  buddyChoiceFallback,
  buddyMenuLine,
  cannedReplyFor,
  castForMood,
  environmentLine,
  openingGreeting,
  summonAnnouncement,
  turnOffLine,
  userTalkLine,
  type BuddyState,
} from './cameos.ts'
import { loadStats } from './stats.ts'
import type { ClippyConfig } from './config.ts'
import {
  acceptanceMessage,
  agentNamedIn,
  CHOICE_SETS,
  effectForLabel,
  isAcceptance,
  type ChoiceEffect,
} from './actions.ts'
import {
  generateChoiceReplyLine,
  generateCrosstalkLine,
  generateOpeningLine,
  generateReactionLine,
  type BuddyMemory,
  type ClippyModelRouteOverride,
} from './generator.ts'
import { isRemarkable, type SessionClimate } from './mood.ts'
import { asksForHelp } from './response.ts'
import { buddyRequestsFileAccess, clippyGrantsFileAccess } from './permission.ts'
import { NO_FILE_POWERS, READ_ONLY, type FilePowers } from './files.ts'
import type { ClippyViewer } from './viewer.ts'

const GENERATION_TIMEOUT_MS = 90_000
/** Buddy opening lines are generated against Clippy's last words, but a
 * waiting window must not stare at a blank screen forever: cap the model at
 * 8s and fall back to the canned greeting. */
const OPENING_TIMEOUT_MS = 8_000
/** Cameo banter: a buddy may conjure a partner to argue with. */
const BANTER_REBUTTAL_DELAY_MS = 8_000
/** Annoyance arc: Clippy may tire of a repeat interrupter and turn it off. */
const ANNOYED_TURNOFF_DELAY_MS = 6_000/** A rival that keeps interrupting after the first visit sticks around. */
const PERSIST_AFTER_INTERRUPTS = 2
/** Clippy tolerates this many of a buddy's quips before considering a turn-off. */
const ANNOYED_AFTER_QUIPS = 4
/** A delivered reply is retried this many more times if Clippy is mid-
 * generation, so a conversation is never dropped for timing alone. */
const REPLY_RETRY_ATTEMPTS = 2
/** How many of a pair's recent lines the model sees when composing a reply,
 * so a counter-reply references the earlier exchange instead of parroting
 * just the last line. */
const THREAD_HISTORY_LIMIT = 4
/** Chance an open buddy speaks up about a notable session event on its own.
 * Deliberately modest: buddies should feel like they are watching your work,
 * not narrating every tool call. */
const ENVIRONMENT_REACTION_CHANCE = 0.45
/** How long a buddy waits after an event before remarking on it, so its line
 * lands after Clippy's own reaction rather than racing it. */
const ENVIRONMENT_REACTION_DELAY_MS = 4_000
/** The same room does not get remarked on twice inside this window. */
const ENVIRONMENT_REACTION_COOLDOWN_MS = 120_000
/** File access: Clippy reads on his own; a buddy reads only after Clippy
 * granted it (rarely, and only after being convinced). */
const MAX_READ_GRANTS_PER_SESSION = 2
/** Crosstalk volume scaling by mood. When the session is going badly the
 * user does not want three windows arguing over the wreckage — the buddies
 * still *react to the event* (that is on-topic and short), they just stop
 * bickering with each other as much. A dead-quiet room gets a little more. */
const CROSSTALK_MOOD_SCALE: Record<string, number> = {
  concerned: 0.5,
  snippy: 0.5,
  worried: 0.35,
  bored: 1.25,
}

/** Timeline knobs for the messaging layer. Production uses the defaults;
 * tests shrink them so crosstalk can be driven in milliseconds. (The renderer
 * also holds a "floor" that serializes display, so these delays are about
 * *deciding to reply*, not about preventing overlap.) */
export interface BuddyTimings {
  /** Base delay before a scheduled reply is composed. */
  crosstalkDelayMs: number
  /** Random per-reply extra delay, so replies do not all decide at once. */
  crosstalkStaggerMs: number
  /** After a pair finishes an exchange window it cools down before a new one
   * can start (pacing; also the anti-loop guarantee). */
  crosstalkCooldownMs: number
  /** Backoff between retries of a reply that found Clippy generating. */
  retryBackoffMs: number
  /** How long Clippy waits before turning off a repeat interrupter that has
   * worn out his patience (after the current line's replies landed). */
  annoyedTurnoffMs: number
  /** Replies a single line may provoke (capped so one line does not spawn a
   * burst from every open window at once). */
  maxRepliesPerLine: number
  /** Reply budget per pair per cooldown window: one reply to a line plus a
   * counter-reply back = 2 — a real argument that then needs a breather. */
  maxExchangesPerWindow: number
  /** After the original speaker hears a reply, the chance it answers back
   * once (0 disables the back-and-forth entirely). */
  micBackChance: number
  /** How long the guaranteed "never left hanging" acknowledgment waits after
   * the chance replies would have landed. */
  guaranteedAckExtraMs: number
}

export const DEFAULT_BUDDY_TIMINGS: BuddyTimings = {
  crosstalkDelayMs: 2_500,
  crosstalkStaggerMs: 1_500,
  crosstalkCooldownMs: 30_000,
  retryBackoffMs: 3_000,
  annoyedTurnoffMs: 6_000,
  maxRepliesPerLine: 2,
  maxExchangesPerWindow: 2,
  micBackChance: 0.5,
  guaranteedAckExtraMs: 1_000,
}

/** Session-scoped memory of one pair's conversation: the rolling transcript
 * the model sees and the reply budget spent in the current window, plus
 * when the pair may take the mic again. Keyed by the unordered pair, dies
 * with the session, never persisted. */
interface BuddyThread {
  /** Recent lines exchanged by the pair (oldest first), capped. */
  readonly history: Array<{ agent: string; line: string }>
  /** Replies delivered since the pair last cooled down (mic-back budget). */
  exchanges: number
  /** Epoch-ms at which the pair may start a fresh exchange window. A value
   * of 0 means the pair has never exchanged. */
  cooldownUntil: number
}

/** Draw a choice set for a canned line that actually asks a question:
 * a yes and a refusal. Model-led balloons carry their own words instead. */
export function choiceSetFor(line?: string): readonly string[] | undefined {
  if (line === undefined || !asksForHelp(line)) return undefined
  return CHOICE_SETS[Math.floor(Math.random() * CHOICE_SETS.length)]
}

export interface BuddyHost {
  /** The viewer, when the external renderer is active. */
  readonly viewer: ClippyViewer | undefined
  /** Show a balloon in Clippy's own window. */
  readonly showClippyBalloon: (text: string, offerChoices?: boolean | readonly string[]) => void
  /** Whether the runtime is mid-generation (crosstalk waits it out). */
  readonly isGenerating: () => boolean
  /** The last balloon text an agent spoke (or undefined if never). */
  readonly lastLineBy: (agent: string) => string | undefined
  /** Deliver an accepted offer into the pi session as a real user message. */
  readonly insertUserMessage: (text: string) => void
  /** Effects that belong to the desktop rather than to one character
   * (the party parade, reading the stats out). */
  readonly runHostEffect: (effect: ChoiceEffect) => void
}

export class BuddyCoordinator {
  private disposed = false
  private banterTimers: ReturnType<typeof setTimeout>[] = []
  /** Session-scoped buddy memory: appearances, arguments, and turn-offs.
   * Lives on the coordinator only and dies with the session — never
   * persisted. */
  private readonly buddyStates = new Map<string, BuddyState>()
  /** Quips each buddy has landed on Clippy this session (annoyance meter). */
  private readonly buddyQuips = new Map<string, number>()
  /** Per-pair conversation threads (history + exchange budget + cooldown). */
  private readonly threads = new Map<string, BuddyThread>()
  /** The room as of the last session event, shared by every buddy: casting,
   * crosstalk volume, and the model prompts all read from this. */
  private climate: SessionClimate | undefined
  /** When a buddy last remarked on the session, so a run of events does not
   * turn into a run of commentary. */
  private lastEnvironmentReactionAt = 0
  /** The guaranteed "never left hanging" acknowledgment currently pending
   * for a buddy's line (if any), so a real reply can supersede it instead
   * of Clippy answering a conversation that has already moved on. */
  private pendingAck: { speaker: string; line: string; timer: ReturnType<typeof setTimeout> } | undefined
  /** Who may read the project files. Clippy always may; a buddy joins only
   * when Clippy grants it — rare, per-buddy once, and only after the buddy
   * asked and convinced him (see noteSpoken). Buddies NEVER edit. */
  private readonly readAccess = new Set<string>(['clippy'])
  /** A buddy's pending, unanswered request to read files (agent -> the line
   * that asked). Cleared on grant, turn-off, and session end. */
  private readonly pendingReadRequests = new Map<string, string>()
  /** Grants Clippy has issued this session (the hard cap on generosity). */
  private readGrantsIssued = 0
  /** Effective messaging timeline (defaults overlaid with any override). */
  private readonly t: BuddyTimings

  constructor(
    private readonly ctx: ExtensionContext,
    private readonly config: ClippyConfig,
    private readonly host: BuddyHost,
    private readonly modelRoute: () => ClippyModelRouteOverride,
    timings: Partial<BuddyTimings> = {},
  ) {
    this.t = { ...DEFAULT_BUDDY_TIMINGS, ...timings }
  }

  /** Track a pending timer so dispose/cancelBanter can cancel it, and drop
   * it from the list once it has fired. Crosstalk schedules a timer per
   * reply, so without the self-pruning the list grew for the whole session.
   * Returns the handle so a specific timer (the guaranteed acknowledgment)
   * can be cancelled individually. */
  private track(fn: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    const timer = setTimeout(() => {
      const index = this.banterTimers.indexOf(timer)
      if (index >= 0) this.banterTimers.splice(index, 1)
      fn()
    }, delayMs)
    this.banterTimers.push(timer)
    return timer
  }

  /** Cancel one tracked timer and forget it, without touching the others. */
  private untrack(timer: ReturnType<typeof setTimeout>): void {
    clearTimeout(timer)
    const index = this.banterTimers.indexOf(timer)
    if (index >= 0) this.banterTimers.splice(index, 1)
  }

  dispose(): void {
    this.disposed = true
    for (const timer of this.banterTimers) clearTimeout(timer)
    this.banterTimers = []
    this.pendingAck = undefined
    this.buddyStates.clear()
    this.buddyQuips.clear()
    this.threads.clear()
    this.readAccess.clear()
    this.pendingReadRequests.clear()
  }

  private get viewer(): ClippyViewer | undefined {
    return this.host.viewer
  }

  /** The file powers a buddy's next generation may use. Read-only, and only
   * after Clippy granted it (never edit, never before the grant). */
  private powersFor(agent: string): FilePowers {
    return agent === 'clippy' || this.readAccess.has(agent) ? READ_ONLY : NO_FILE_POWERS
  }

  /** Does this agent currently hold read access to the project files? */
  canRead(agent: string): boolean {
    return this.readAccess.has(agent)
  }

  /** Every line any assistant speaks passes through here, which makes it the
   * single place the file-access permission dance is decided:
   *
   * - a buddy line asking to read the files registers a pending request;
   * - a Clippy line that plainly grants that buddy (naming it) turns the
   *   request into a session-scoped, read-only grant.
   *
   * The convincing itself happens in the conversation — Clippy's prompts
   * make him stingy (src/generator.ts); the caps here make the rarity
   * structural: a request must come first, and the whole session allows
   * only a couple of grants. */
  noteSpoken(agent: string, line: string): void {
    if (this.disposed || line === '') return
    if (agent === 'clippy') {
      if (this.readGrantsIssued >= MAX_READ_GRANTS_PER_SESSION) return
      for (const [buddy] of [...this.pendingReadRequests]) {
        if (this.readAccess.has(buddy)) continue
        if (this.viewer !== undefined && !this.viewer.isCameoOpen(buddy)) continue
        if (!clippyGrantsFileAccess(line, buddy)) continue
        this.readAccess.add(buddy)
        this.readGrantsIssued += 1
        this.pendingReadRequests.delete(buddy)
      }
      return
    }
    if (!this.readAccess.has(agent) && buddyRequestsFileAccess(line)) {
      this.pendingReadRequests.set(agent, line)
    }
  }

  // --- Reading the room ----------------------------------------------------

  /** The runtime hands over the climate whenever the session does something
   * notable. Everything downstream — who gets cast, how much the buddies
   * bicker, what the model is told about the room — reads from this one
   * value, so Clippy and every buddy react to the same session. */
  observe(climate: SessionClimate): void {
    if (this.disposed) return
    this.climate = climate
    this.maybeReactToSession(climate)
  }

  /** An open buddy notices what just happened in YOUR session and says
   * something about it, unprompted. This is the difference between a buddy
   * that only heckles Clippy and one that is actually watching your work:
   * the build broke, and the bird has a comment.
   *
   * The line goes out through `buddySay`, so it takes the shared floor and
   * Clippy (or another buddy) may answer it — an environment event can start
   * a real conversation between windows. */
  private maybeReactToSession(climate: SessionClimate): void {
    if (!isRemarkable(climate)) return
    const now = Date.now()
    if (now - this.lastEnvironmentReactionAt < ENVIRONMENT_REACTION_COOLDOWN_MS) return
    const open = this.config.cameos.filter(agent => this.viewer?.isCameoOpen(agent) === true)
    if (open.length === 0) return
    if (Math.random() >= ENVIRONMENT_REACTION_CHANCE) return
    // Cast the buddy who suits this particular room.
    const agent = castForMood(climate.mood, open, Math.random(), Math.random())
    if (agent === undefined) return
    this.lastEnvironmentReactionAt = now
    this.scheduleEnvironmentReaction(agent, climate, 0)
  }

  /** A buddy remarking on the session, with the same bounded retry the
   * replies get: a line that finds Clippy mid-generation waits it out
   * instead of being silently dropped, so a notable event is not lost to
   * timing alone. */
  private scheduleEnvironmentReaction(agent: string, climate: SessionClimate, attempt: number): void {
    this.track(() => {
      if (this.disposed || this.viewer?.isCameoOpen(agent) !== true) return
      if (this.host.isGenerating()) {
        if (attempt < REPLY_RETRY_ATTEMPTS) this.scheduleEnvironmentReaction(agent, climate, attempt + 1)
        return
      }
      const signal = AbortSignal.timeout(GENERATION_TIMEOUT_MS)
      generateReactionLine(this.ctx, signal, agent, climate, this.modelRoute())
        .then(text => {
          if (!this.disposed) this.buddySay(agent, text, false)
        })
        .catch(() => {
          if (!this.disposed) this.buddySay(agent, environmentLine(agent, climate.mood), false)
        })
    }, attempt === 0 ? ENVIRONMENT_REACTION_DELAY_MS : this.t.retryBackoffMs)
  }

  /** How likely a listener is to answer a line right now. Flat config chance,
   * scaled by the room (see CROSSTALK_MOOD_SCALE). */
  private crosstalkChance(): number {
    const base = this.config.crosstalkChance
    const mood = this.climate?.mood
    if (mood === undefined) return base
    return Math.min(1, base * (CROSSTALK_MOOD_SCALE[mood] ?? 1))
  }

  /** The relationship facts a generator is allowed to see: the same session
   * memory that has always colored the canned lines, in the shape the model
   * prompts take. */
  private memoryFor(agent: string): BuddyMemory | undefined {
    const record = this.buddyStates.get(agent)
    return record === undefined ? undefined : {
      appeared: record.appeared,
      ...(record.turnedOffBy === undefined ? {} : { turnedOffBy: record.turnedOffBy }),
      ...(record.summonedBy === undefined ? {} : { summonedBy: record.summonedBy }),
      turnedOff: record.turnedOff,
      arguedWith: record.arguedWith,
    }
  }

  // --- Summons, clicks, menus ---------------------------------------------

  /** ↑↑↓↓←→←→ B A from the Clippy window. Bonzi stays until dismissed so the
   * full right-click menu works on him. */
  onKonami(): void {
    if (this.disposed || !this.config.konami || !this.config.cameos.includes('bonzi')) return
    void this.summonBuddy('bonzi')
  }

  /** Clicked a cameo: it talks to the user instead of vanishing (and stays
   * around so the conversation can keep going). */
  onCameoClick(agent: string): void {
    if (this.disposed) return
    const record = this.buddyRecord(agent)
    this.viewer?.keepCameo(agent)
    this.buddySay(agent, userTalkLine(agent, record))
  }

  /** Right-click menu on a buddy: the same actions as Clippy, actually
   * carried out in the buddy's own voice. The buddy really does explain the
   * change, propose a step, or say the honest thing (the same machinery the
   * balloon buttons use); the canned menu line is the fallback when the
   * model is unavailable. */
  triggerBuddyAction(agent: string, kind: 'explain' | 'suggest' | 'roast'): void {
    if (this.disposed) return
    const fallback = buddyMenuLine(agent, kind) || userTalkLine(agent)
    const asked = this.host.lastLineBy(agent) ?? this.host.lastLineBy('clippy') ?? ''
    const signal = AbortSignal.timeout(GENERATION_TIMEOUT_MS)
    const asAsked = kind === 'explain' ? 'Show me' : kind === 'suggest' ? 'What next?' : 'Be honest'
    // "Show me" / "What next?" are the tasks where a granted buddy may use
    // its read access; the roast is pure talk.
    const powers = kind === 'explain' || kind === 'suggest' ? this.powersFor(agent) : NO_FILE_POWERS
    generateChoiceReplyLine(this.ctx, signal, agent, kind, asAsked, asked, this.modelRoute(), powers)
      .then(text => {
        if (!this.disposed) this.buddySay(agent, text, false)
      })
      .catch(() => {
        if (!this.disposed) this.viewer?.sayTo(agent, fallback, choiceSetFor(fallback))
      })
  }

  /** Summon a buddy. Every buddy window that opens is somebody's doing —
   * Clippy sending for a rival, a buddy dragging in its sparring partner, or
   * the user picking one from the menu — never a window that simply
   * materialized. `announce` makes the summoner say so first, which is what
   * makes an arrival read as "Clippy called someone in" instead of a rival
   * wandering past. The greeting reacts to the summoner's last line (or
   * Clippy's) when the model is available, otherwise leans on session memory. */
  async summonBuddy(target: string, by = 'clippy', announce = false): Promise<void> {
    if (this.disposed || !this.config.cameos.includes(target) || target === by) return
    const record = this.buddyRecord(target)
    record.appeared += 1
    record.summonedBy = by
    if (announce) this.announceSummon(by, target)
    // Usually the memory-aware summon greeting; occasionally a jab at the
    // user's streak instead, when there is one worth mocking.
    const fallback = openingGreeting(target, record, loadStats().streak, Math.random())
    const context = by === 'clippy' ? this.host.lastLineBy('clippy') : this.host.lastLineBy(by)
    const greeting = await this.openingLine(target, context, fallback)
    if (this.disposed || !this.viewer) return
    this.noteSpoken(target, greeting)
    this.viewer.summonCameo(target, greeting, choiceSetFor(greeting))
    // The newly arrived buddy's line is heard by everyone else.
    this.scheduleCrosstalk(target, greeting)
  }

  /** The summoner says out loud that it is sending for somebody, so the new
   * window has a visible cause. */
  private announceSummon(by: string, target: string): void {
    const line = summonAnnouncement(by, target)
    if (by === 'clippy') this.host.showClippyBalloon(line, false)
    else if (this.viewer?.isCameoOpen(by) === true) this.viewer.sayTo(by, line)
  }

  /** Clippy's in-character impulses, decided as part of the line. This is
   * the ONLY way a rival turns up on its own: either the model wrote a
   * `summon` (Clippy wants somebody dragged into this moment) or the room is
   * bad enough that he sends for help himself. Nothing appears by dice roll
   * on a plain balloon any more — if a window opened, Clippy opened it. */
  maybeActOn(balloon: { summon?: string }): void {
    if (this.disposed || !this.viewer) return
    const target = balloon.summon
    if (target !== undefined) {
      if (this.viewer.isCameoOpen(target) || !this.config.cameos.includes(target)) return
      void this.summonBuddy(target, 'clippy', true)
      return
    }
    this.maybeSendForHelp()
  }

  /** No summon in the line, but the session is going badly (or is dead
   * quiet) and Clippy would rather not be alone with it: he sends for the
   * rival who suits the room. `cameoChance` is how willing he is to do that;
   * 0 means he never calls anyone and only the user opens buddy windows. */
  private maybeSendForHelp(): void {
    if (this.config.cameoChance <= 0 || this.config.cameos.length === 0) return
    const climate = this.climate
    // He only reaches for the phone when something is actually going on.
    if (climate === undefined || !isRemarkable(climate)) return
    if (Math.random() >= this.config.cameoChance) return
    const available = this.config.cameos.filter(agent => this.viewer?.isCameoOpen(agent) !== true)
    if (available.length === 0) return
    const agent = castForMood(climate.mood, available, Math.random(), Math.random()) ?? available[0]!
    const record = this.buddyRecord(agent)
    record.interruptCount += 1
    void this.summonBuddy(agent, 'clippy', true)
    if (this.config.banterChance > 0 && Math.random() < this.config.banterChance) {
      this.scheduleBanter(agent)
    }
    if (this.config.annoyanceChance > 0 && record.interruptCount >= PERSIST_AFTER_INTERRUPTS
      && Math.random() < this.config.annoyanceChance) {
      this.scheduleAnnoyedTurnOff(agent)
    }
  }

  /** One agent turns another off: the victim's window closes, the act is
   * remembered for the rest of the session, a pending argument about the
   * victim is cancelled so a timer cannot resurrect it, and its threads are
   * cooled off (the grudge lives in buddyStates, not in the threads). */
  turnOffBuddy(by: string, victim: string): void {
    if (this.disposed || !this.viewer || by === victim) return
    this.cancelBanter()
    // A buddy that is switched off mid-plea stops asking; the grant itself
    // (if one was earned) is remembered for the session.
    this.pendingReadRequests.delete(victim)
    const victimRecord = this.buddyRecord(victim)
    victimRecord.turnedOffBy = by
    const byRecord = by === 'clippy' ? undefined : this.buddyRecord(by)
    if (byRecord !== undefined && !byRecord.turnedOff.includes(victim)) byRecord.turnedOff.push(victim)
    this.viewer.closeCameo(victim)
    this.forgetWith(victim)
    const line = turnOffLine(by, victim)
    if (by === 'clippy') this.viewer.sayTo('clippy', line)
    else if (this.viewer.isCameoOpen(by)) this.viewer.sayTo(by, line)
  }

  /** The user picked one of a buddy's option buttons. The buttons on a
   * buddy balloon work exactly like Clippy's: the label says what happens,
   * and the buddy answers in its own voice about the thing that is actually
   * about to happen (src/actions.ts). The canned line is drawn from the
   * buddy's OWN voice (src/cameos.ts) so a model outage never makes a
   * buddy answer in Clippy's words; `fallbackReaction` overrides it for
   * callers that bring their own. */
  onBuddyChoice(agent: string, _index: number, fallbackReaction?: string, label?: string): void {
    if (this.disposed || !this.viewer || !this.viewer.isCameoOpen(agent)) return
    const pick = (typeof label === 'string' && label.trim().length > 0) ? label.trim() : 'Yes'
    const effect = effectForLabel(pick)
    const asked = this.host.lastLineBy(agent) ?? ''
    // The button's promise is kept first, so the reply lands on something
    // that is already happening.
    this.applyBuddyEffect(agent, effect, pick, asked)
    const fallback = fallbackReaction ?? buddyChoiceFallback(agent, effect)
    const signal = AbortSignal.timeout(GENERATION_TIMEOUT_MS)
    // Only the "real work" buttons (explain, suggest) may spend a granted
    // buddy's read access; accept, party, stats and the rest never touch
    // the files, and no buddy ever edits.
    const powers = effect === 'explain' || effect === 'suggest' ? this.powersFor(agent) : NO_FILE_POWERS
    generateChoiceReplyLine(this.ctx, signal, agent, effect, pick, asked, this.modelRoute(), powers)
      .then(text => {
        if (!this.disposed) this.buddySay(agent, text, false)
      })
      .catch(() => {
        if (!this.disposed) this.buddySay(agent, fallback, false)
      })
  }

  /** What a buddy's button actually does. Explaining, suggesting, and
   * roasting are carried by the reply itself (the generator is told to
   * really do them); the rest change something on the desktop or in the
   * session. */
  private applyBuddyEffect(agent: string, effect: ChoiceEffect, label: string, asked: string): void {
    if (isAcceptance(effect) && asked !== '') {
      this.host.insertUserMessage(acceptanceMessage(asked, label))
      return
    }
    if (effect === 'second-opinion') {
      // A buddy sending for another buddy: the partner it likes to fight
      // with, unless the label named somebody specific.
      const named = agentNamedIn(label, this.config.cameos)
      const partner = named ?? BANTER_PARTNERS[agent] ?? this.config.cameos.find(candidate => candidate !== agent)
      if (partner !== undefined && partner !== agent) void this.summonBuddy(partner, agent, true)
      return
    }
    if (effect === 'party' || effect === 'stats') this.host.runHostEffect(effect)
  }

  /** A buddy offers the little option buttons too — and the other assistants
   * may answer the line. */
  buddySay(agent: string, text: string, offerChoices = true): void {
    if (this.disposed || !this.viewer) return
    this.noteSpoken(agent, text)
    if (offerChoices) {
      this.viewer.sayTo(agent, text, choiceSetFor(text))
      // Clippy (or another open buddy) may answer the buddy's line.
      this.scheduleCrosstalk(agent, text)
      return
    }
    this.viewer.sayTo(agent, text)
  }

  // --- Interruptions & arguments -------------------------------------------

  /** /clippy party: Clippy invites somebody over. Still a summon — the
   * guest arrives because he asked, and the retort it opens with reacts to
   * whatever he just said. */
  inviteToParty(): void {
    if (this.disposed || this.config.cameos.length === 0 || this.config.cameoChance <= 0) return
    const available = this.config.cameos.filter(agent => this.viewer?.isCameoOpen(agent) !== true)
    if (available.length === 0) return
    const mood = this.climate?.mood ?? 'delighted'
    const agent = castForMood(mood, available, Math.random(), Math.random()) ?? available[0]!
    void this.summonBuddy(agent, 'clippy', true)
  }

  /** The opening line for a buddy that is about to appear: generated against
   * the context line (Clippy's last words, or the summoner's) so the arrival
   * lands as a real reaction — pun, mockery, or advice — with the canned
   * greeting as the fallback when the model is unavailable or slow. */
  private async openingLine(agent: string, context: string | undefined, fallback: string): Promise<string> {
    if (context === undefined) return fallback
    try {
      const signal = AbortSignal.timeout(OPENING_TIMEOUT_MS)
      // The arrival carries the grudge: a buddy that was switched off earlier
      // and is back now opens like it.
      return await generateOpeningLine(this.ctx, signal, agent, context, this.modelRoute(), this.memoryFor(agent))
    } catch {
      return fallback
    }
  }

  /** Clippy gets annoyed by a repeat interrupter and turns it off. */
  private scheduleAnnoyedTurnOff(agent: string): void {
    this.track(() => {
      if (this.disposed) return
      if (!this.viewer?.isCameoOpen(agent)) return
      this.turnOffBuddy('clippy', agent)
    }, this.t.annoyedTurnoffMs)
  }

  /** Have the opener conjure a partner, then rebut it. Both remember the
   * argument for the rest of the session; the partner sticks around, and the
   * opener may eventually tire of it and turn it off.
   *
   * The rebuttal travels through the SAME threaded channel as every other
   * reply (scheduleReply), so the banter counts against the pair's exchange
   * budget, lands in the pair's transcript, can draw a mic-back, and cools
   * the pair down afterwards — a banter argument is a real, bounded
   * argument instead of a one-off exchange that later lines cannot
   * remember. */
  private scheduleBanter(agent: string): void {
    const preferred = BANTER_PARTNERS[agent]
    const partner = preferred !== undefined && this.config.cameos.includes(preferred)
      ? preferred
      : this.config.cameos.find(candidate => candidate !== agent)
    if (partner === undefined) return
    const opener = this.buddyRecord(agent)
    const partnerRecord = this.buddyRecord(partner)
    if (!opener.arguedWith.includes(partner)) opener.arguedWith.push(partner)
    partnerRecord.appeared += 1
    partnerRecord.summonedBy = agent
    const line = banterReply(agent, partnerRecord)
    this.noteSpoken(partner, line)
    this.viewer?.summonCameo(partner, line, choiceSetFor(line))
    // The opener answers the greeter through the model (so the argument is
    // not a broken record of canned loop-lines); the canned rebuttal is the
    // fallback when the model is unavailable.
    this.scheduleReply(agent, partner, line, 0, banterRebuttal(agent, partner, opener))
    if (this.config.annoyanceChance > 0 && Math.random() < this.config.annoyanceChance) {
      this.track(() => {
        if (this.disposed) return
        this.turnOffBuddy(agent, partner)
      }, BANTER_REBUTTAL_DELAY_MS + ANNOYED_TURNOFF_DELAY_MS)
    }
  }

  // --- Crosstalk (the messaging layer) -------------------------------------

  /** Clippy's canned acknowledgments, used when everybody (including Clippy)
   * rolled below the crosstalk chance — always in Clippy's own voice,
   * referencing the speaker. */
  private cannedAckFor(speaker: string): string {
    const label = agentLabel(speaker)
    const pool = [
      `It looks like ${label} has opinions again. Would you like help ignoring them?`,
      `It looks like ${label} is not finished being right yet. Would you like help with that?`,
      `It looks like ${label} keeps interrupting the paperwork. Would you like help filing it away?`,
      `It looks like ${label} said something about the memo. Would you like help proofreading their remarks?`,
      `It looks like ${label} has joined the meeting uninvited. Would you like help taking minutes?`,
      `It looks like ${label} is editorializing again. Would you like help redacting it?`,
    ]
    return pool[Math.floor(Math.random() * pool.length)]!
  }

  /** After `speaker` says a line, EVERYONE else who is open may answer it
   * through the model — Clippy and all open buddies hear every line. Up to
   * `maxRepliesPerLine` listeners actually reply (shuffled order, each with
   * an independent chance), so a single line does not spawn a shouted
   * chorus, and no pair monopolizes the slots. Every agent replies at most
   * once per line. If the model is stuck
   * the reply is a canned line in that agent's own voice. A buddy's line is
   * never left hanging: Clippy acknowledges it even when he (and everyone
   * else) rolled past the chance. A repeat quipster that wears out Clippy's
   * patience is turned off after this line's replies have landed — the
   * hang-up never swallows the conversation. */
  scheduleCrosstalk(speaker: string, line: string): void {
    if (this.disposed || !this.viewer) return
    const listeners = this.crosstalkListeners(speaker)
    if (listeners.length === 0) return
    const quips = this.trackQuip(speaker)
    let clippyReplied = false
    let slots = 0
    // Shuffled so the reply slots are not always won by the same early
    // listeners on the roster — with several windows open, every pair gets
    // a turn instead of the first two names in configuration order.
    for (const listener of this.shuffled(listeners)) {
      if (slots >= this.t.maxRepliesPerLine) break
      if (this.pairInCooldown(listener, speaker)) continue
      if (Math.random() >= this.crosstalkChance()) continue
      slots += 1
      if (listener === 'clippy') clippyReplied = true
      this.scheduleReply(listener, speaker, line, 0)
    }
    if (!clippyReplied && speaker !== 'clippy') {
      // Systematic: even when Clippy (and everyone) rolled below the chance,
      // a buddy's line is never left hanging — he acknowledges it.
      this.scheduleGuaranteedAck(speaker, line)
    }
    // Annoyance: Clippy may have run out of patience with a repeat
    // interrupter — but never mid-conversation. The turn-off waits until
    // this line's replies have landed, so the hang-up ends a finished
    // exchange instead of swallowing it.
    if (speaker !== 'clippy' && quips >= ANNOYED_AFTER_QUIPS
      && this.config.annoyanceChance > 0 && Math.random() < this.config.annoyanceChance) {
      this.track(() => {
        if (this.disposed) return
        if (this.viewer?.isCameoOpen(speaker) === true) this.turnOffBuddy('clippy', speaker)
      }, this.t.crosstalkDelayMs + this.t.crosstalkStaggerMs + this.t.annoyedTurnoffMs)
    }
  }

  /** The guaranteed acknowledgment: Clippy answers a buddy's line even when
   * he rolled below the crosstalk chance. Waits Clippy's own generation out
   * with a bounded retry rather than dropping the acknowledgment, and is
   * delivered as a plain line (no offers, no new interruption round). The
   * pending ack is tracked so a real reply to the same line can supersede
   * it — Clippy does not need to say "Merlin has opinions again" about a
   * conversation that has already happened. */
  private scheduleGuaranteedAck(speaker: string, line: string, attempt = 0): void {
    if (this.disposed) return
    const delay = attempt === 0
      ? this.t.crosstalkDelayMs + this.t.crosstalkStaggerMs + this.t.guaranteedAckExtraMs
      : this.t.retryBackoffMs
    const timer = this.track(() => {
      if (this.disposed) return
      // Superseded by a newer ack or answered by a real reply? This timer no
      // longer owns the acknowledgment and says nothing.
      if (this.pendingAck?.timer !== timer) return
      this.pendingAck = undefined
      if (this.host.isGenerating()) {
        if (attempt < REPLY_RETRY_ATTEMPTS) this.scheduleGuaranteedAck(speaker, line, attempt + 1)
        return
      }
      this.host.showClippyBalloon(this.cannedAckFor(speaker), false)
    }, delay)
    // Tracked on every attempt, so a superseding reply can cancel the retry
    // timer too, not just the first one.
    this.pendingAck = { speaker, line, timer }
  }

  /** One reply from `listener` to `speaker`'s line, composed after the reply
   * delay. Waits Clippy's generation out with a bounded set of retries
   * instead of silently dropping the reply, gives a canned line in the
   * listener's own voice when the model is unavailable, and — because the
   * exchange is threaded and capped — lets the original speaker answer back
   * once (a real argument, never an endless loop). `fallback` overrides the
   * canned line (the banter arc supplies its own rebuttal). */
  private scheduleReply(listener: string, speaker: string, line: string, attempt: number, fallback?: string): void {
    if (this.disposed || !this.viewer) return
    if (listener !== 'clippy' && !this.viewer.isCameoOpen(listener)) return
    if (this.pairInCooldown(listener, speaker)) return
    const delay = attempt === 0
      ? this.t.crosstalkDelayMs + Math.floor(Math.random() * this.t.crosstalkStaggerMs)
      : this.t.retryBackoffMs
    this.track(() => {
      if (this.disposed || !this.viewer) return
      if (listener !== 'clippy' && !this.viewer.isCameoOpen(listener)) return
      if (this.pairInCooldown(listener, speaker)) return
      // Wait out a generation, but never drop the reply for timing alone.
      if (this.host.isGenerating()) {
        if (attempt < REPLY_RETRY_ATTEMPTS) this.scheduleReply(listener, speaker, line, attempt + 1, fallback)
        return
      }
      // The line lands in the pair's thread only now that a reply is being
      // composed for it, so a line that is heard but never answered (busy
      // generation, closed window) cannot pollute the transcript the model
      // reads.
      this.rememberHeard(listener, speaker, line)
      const signal = AbortSignal.timeout(GENERATION_TIMEOUT_MS)
      generateCrosstalkLine(this.ctx, signal, listener, speaker, line, this.modelRoute(), this.threadFor(listener, speaker).history, this.memoryFor(listener), this.canRead(listener))
        .then(text => this.deliverReply(listener, speaker, text, fallback, line))
        .catch(() => this.deliverReply(listener, speaker, undefined, fallback, line))
    }, delay)
  }

  /** Hand a reply to a window: record it in the pair's thread, deliver it,
   * and if the pair still has exchange budget left, let the original speaker
   * answer the reply once (`micBackChance`). Once the budget is spent the
   * pair cools down, so the back-and-forth always ends. */
  private deliverReply(
    listener: string,
    speaker: string,
    text: string | undefined,
    fallback: string | undefined,
    answeredLine: string,
  ): void {
    if (this.disposed || !this.viewer) return
    if (listener !== 'clippy' && !this.viewer.isCameoOpen(listener)) return
    if (this.pairInCooldown(listener, speaker)) return
    // The line has a real answer now: retire the pending "never left
    // hanging" acknowledgment, because Clippy answering a conversation that
    // already happened would just be noise on top of it.
    if (this.pendingAck !== undefined && this.pendingAck.speaker === speaker && this.pendingAck.line === answeredLine) {
      this.untrack(this.pendingAck.timer)
      this.pendingAck = undefined
    }
    // Model unavailable? Reply in the agent's own canned voice — Clippy's
    // counter uses his acknowledgment pool so he never borrows a buddy's words.
    const content = text ?? fallback ?? (listener === 'clippy' ? this.cannedAckFor(speaker) : cannedReplyFor(listener, speaker))
    this.rememberSaid(listener, speaker, content)
    const thread = this.threadFor(listener, speaker)
    // A cooled-down pair starts a FRESH exchange window. Without this reset
    // the budget was spent once and never returned: every later reply
    // immediately re-tripped the cap, so a pair got one line per cooldown
    // and never a mic-back again for the rest of the session.
    if (thread.cooldownUntil !== 0 && Date.now() >= thread.cooldownUntil) {
      thread.cooldownUntil = 0
      thread.exchanges = 0
    }
    thread.exchanges += 1
    this.speak(listener, content)
    if (thread.exchanges >= this.t.maxExchangesPerWindow) {
      // Budget spent: the pair needs a breather before it may argue again.
      thread.cooldownUntil = Date.now() + this.t.crosstalkCooldownMs
      return
    }
    if (Math.random() < this.t.micBackChance) {
      // The original speaker answers the reply — a counter-punch with
      // history, delivered as one more (terminal) reply.
      this.scheduleReply(speaker, listener, content, 0)
    }
  }

  /** Everyone who is open and not the speaker: Clippy plus every open buddy,
   * so Clippy hears all buddies and every buddy hears Clippy and each other. */
  private crosstalkListeners(speaker: string): string[] {
    if (!this.viewer) return []
    const open = this.config.cameos.filter(agent => this.viewer?.isCameoOpen(agent) === true)
    if (speaker === 'clippy') return open
    return ['clippy', ...open.filter(agent => agent !== speaker)]
  }

  /** Fisher–Yates over a copy: reply slots are handed out in random order
   * so the same two listeners do not always answer first. */
  private shuffled<T>(items: readonly T[]): T[] {
    const copy = [...items]
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1))
      const held = copy[index]!
      copy[index] = copy[swap]!
      copy[swap] = held
    }
    return copy
  }

  /** Deliver a spoken line to its window without re-flocking everyone (a
   * reply is a reply, not a new broadcast). Clippy's counter-reply goes
   * through the runtime so it participates in every other conversation
   * mechanism; a buddy's goes to that buddy window. */
  private speak(agent: string, content: string): void {
    if (this.disposed || !this.viewer) return
    this.noteSpoken(agent, content)
    if (agent === 'clippy') this.host.showClippyBalloon(content, false)
    else if (this.viewer.isCameoOpen(agent)) this.viewer.sayTo(agent, content)
  }

  /** Count a buddy's quip toward Clippy's patience; returns the new count. */
  private trackQuip(speaker: string): number {
    if (speaker === 'clippy') return 0
    const quips = (this.buddyQuips.get(speaker) ?? 0) + 1
    this.buddyQuips.set(speaker, quips)
    return quips
  }

  // --- Thread memory -------------------------------------------------------

  /** Unordered pair key: a conversation belongs to the two agents, not to
   * who spoke first. */
  private pairKey(a: string, b: string): string {
    return a === b ? a : a < b ? `${a}::${b}` : `${b}::${a}`
  }

  private pairInCooldown(a: string, b: string): boolean {
    return Date.now() < this.threadFor(a, b).cooldownUntil
  }

  private threadFor(a: string, b: string): BuddyThread {
    const key = this.pairKey(a, b)
    let thread = this.threads.get(key)
    if (thread === undefined) {
      thread = { history: [], exchanges: 0, cooldownUntil: 0 }
      this.threads.set(key, thread)
    }
    return thread
  }

  private rememberHeard(listener: string, speaker: string, line: string): void {
    // The speaker's line that the listener is about to answer.
    this.pushThreadLine(speaker, line, listener)
  }

  private rememberSaid(agent: string, other: string, line: string): void {
    this.pushThreadLine(agent, line, other)
  }

  private pushThreadLine(agent: string, line: string, other: string): void {
    const thread = this.threadFor(agent, other)
    thread.history.push({ agent, line })
    if (thread.history.length > THREAD_HISTORY_LIMIT) {
      thread.history.splice(0, thread.history.length - THREAD_HISTORY_LIMIT)
    }
  }

  /** Forget every thread that involves `agent` (it was turned off). The next
   * summon or reply starts a fresh thread, while the *BuddyState* grudge is
   * separately remembered in `buddyStates`. */
  private forgetWith(agent: string): void {
    for (const [key, thread] of this.threads) {
      // Split on the separator: `includes` matched substrings, so turning
      // off "rock" would also wipe every "rocky" thread.
      if (!key.split('::').includes(agent)) continue
      thread.cooldownUntil = 0
      thread.exchanges = 0
      thread.history.length = 0
    }
  }

  /** Cancel pending banter so a turned-off buddy is never reopened by a timer. */
  cancelBanter(): void {
    for (const timer of this.banterTimers) clearTimeout(timer)
    this.banterTimers = []
    this.pendingAck = undefined
  }

  private buddyRecord(agent: string): BuddyState {
    let record = this.buddyStates.get(agent)
    if (record === undefined) {
      record = { agent, appeared: 0, interruptCount: 0, turnedOff: [], arguedWith: [] }
      this.buddyStates.set(agent, record)
    }
    return record
  }
}
