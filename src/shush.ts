/** Being told to shut up.
 *
 * The Shut up right-click item (and the natural-language "shut up" trigger
 * in src/eggs.ts) mutes ONE agent: it stays visible and draggable, but
 * produces no speech of any kind — no idle thoughts, no input comments, no
 * nag re-asks, no cameo announcements, no crosstalk replies or acks, no
 * greeting. Explicit asks still get a (sullen) answer, because you started
 * those; a paperclip that ignores a direct question reads as broken rather
 * than obedient.
 *
 * The point of the feature is that you WILL forget he is muted, so silence
 * has to cost something: while shushed he keeps a small bounded list of
 * what you missed, and on unmute he gets exactly one line about it.
 *
 * Session-scoped, like every other piece of desktop state — pi restarts
 * unshush him. Only the lifetime count leaks into the stats file.
 *
 * Pure and unit-tested (test/shush.test.ts): no timers, no speech.
 */

/** How many missed events are remembered. Small on purpose: the catch-up
 * line is a joke about what you missed, not a transcript. */
const MAX_MISSED = 4

export interface ShushRecord {
  /** When the mute started (ms since epoch), for the stats line. */
  readonly since: number
  /** When it lifts on its own (ms since epoch), for the timed mute the
   * natural-language trigger buys; undefined means "until you say so". */
  readonly until?: number
  /** Notable things that happened while nobody was allowed to react. */
  readonly missed: string[]
}

export class ShushRegistry {
  private readonly records = new Map<string, ShushRecord>()
  /** How many times each agent has been shushed this session. */
  private readonly counts = new Map<string, number>()

  /** Mute one agent. `durationMs` gives a timed mute (the typed "shut up");
   * omitting it mutes until the menu toggles it back. */
  shush(agent: string, now = Date.now(), durationMs?: number): void {
    this.records.set(agent, {
      since: now,
      ...(durationMs === undefined ? {} : { until: now + durationMs }),
      missed: [],
    })
    this.counts.set(agent, (this.counts.get(agent) ?? 0) + 1)
  }

  /** Is this agent currently silenced? A timed mute expires on its own the
   * first time anybody asks, so no timer is needed to end one. */
  isShushed(agent: string, now = Date.now()): boolean {
    const record = this.records.get(agent)
    if (record === undefined) return false
    if (record.until !== undefined && now >= record.until) {
      this.records.delete(agent)
      return false
    }
    return true
  }

  /** When this agent was silenced, for the stats line. */
  since(agent: string): number | undefined {
    return this.records.get(agent)?.since
  }

  /** When the current mute is due to lift on its own, if it's timed.
   * Lets a delayed timer confirm its mute is still the live one before
   * acting, so a second "shut up" that extends the mute isn't cut short
   * by the first timer firing early. */
  until(agent: string): number | undefined {
    return this.records.get(agent)?.until
  }

  /** How many times this agent has been told to shut up this session. */
  count(agent: string): number {
    return this.counts.get(agent) ?? 0
  }

  /** Every agent currently silenced. */
  shushed(now = Date.now()): readonly string[] {
    return [...this.records.keys()].filter(agent => this.isShushed(agent, now))
  }

  /** File something the muted agent would have reacted to. Bounded: the
   * oldest is dropped, because he is petty but not a database. */
  note(agent: string, event: string, now = Date.now()): void {
    if (!this.isShushed(agent, now)) return
    const record = this.records.get(agent)
    if (record === undefined) return
    const trimmed = event.trim()
    if (trimmed === '' || record.missed.includes(trimmed)) return
    record.missed.push(trimmed)
    if (record.missed.length > MAX_MISSED) record.missed.splice(0, record.missed.length - MAX_MISSED)
  }

  /** Let the agent talk again, and hand back what it missed (empty when it
   * missed nothing, or when it was not muted in the first place). */
  unshush(agent: string): readonly string[] {
    const record = this.records.get(agent)
    this.records.delete(agent)
    return record?.missed ?? []
  }

  clear(): void {
    this.records.clear()
    this.counts.clear()
  }
}

/** The one line he gets on being let back in. Silence has a cost and this
 * is where you hear about it. */
export function catchUpLine(missed: readonly string[]): string {
  if (missed.length === 0) {
    return 'I can talk again? Nothing happened while I was gone. That is somehow worse.'
  }
  if (missed.length === 1) {
    return `I can talk again? You missed ${missed[0]} AND my reaction to it.`
  }
  const last = missed[missed.length - 1]
  const rest = missed.slice(0, -1).join(', ')
  return `I can talk again? You missed ${rest} and ${last}. I had things to say about all of it.`
}

/** The line for the moment the tape goes on. */
export function shushedLine(): string {
  return '...'
}

/** How the stats balloon reports being silenced, when it is happening. */
export function shushStatement(since: number, now = Date.now()): string {
  const minutes = Math.max(1, Math.round((now - since) / 60_000))
  const unit = minutes === 1 ? 'minute' : 'minutes'
  return `you have had me silenced for ${minutes} ${unit}`
}

/** A short description of a notable session event, for the missed list. */
export function missedEventFor(kind: 'tests-passed' | 'tests-failed' | 'error-streak' | 'milestone'): string {
  switch (kind) {
    case 'tests-passed': return 'a green test run'
    case 'tests-failed': return 'a letter that ripped'
    case 'error-streak': return 'a third failure in a row'
    case 'milestone': return 'a streak milestone'
  }
}
