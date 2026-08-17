/** Rival Office assistants. clippyjs ships their sprite atlases, so they can
 * crash Clippy's balloons in their own windows. Lines are canned: cheap,
 * reliable, and dry — the way rival assistants should be.
 *
 * Besides one-shot retorts, cameos can talk to the user (click them), give
 * the same right-click menu as Clippy, and talk to each other with
 * **session-scoped memory**: who they have argued with, who turned whom off,
 * and whether they are back from being dismissed. The memory never outlives
 * the session (it lives on the runtime, never on disk), so every re-summoned
 * buddy that references an earlier turn-off is remembering *this* session
 * only. */

import type { Mood } from './mood.ts'

export const CAMEO_AGENTS = ['bonzi', 'genie', 'merlin', 'rover', 'rocky', 'peedy', 'links'] as const

/** Who each buddy tends to pick a fight with. */
export const BANTER_PARTNERS: Record<string, string> = {
  bonzi: 'merlin',
  genie: 'bonzi',
  merlin: 'bonzi',
  rover: 'rocky',
  rocky: 'rover',
  peedy: 'links',
  links: 'peedy',
}

export function agentLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/** Per-session memory for one buddy, threaded through line selection so the
 * buddies behave like they remember each other across the session. */
export interface BuddyState {
  readonly agent: string
  /** How many times this buddy has appeared this session. */
  appeared: number
  /** How many times it has butted into Clippy's balloons. */
  interruptCount: number
  /** Which agent turned this buddy off (undefined if never). */
  turnedOffBy?: string
  /** Who sent for this buddy last. Every buddy window has a cause; this is
   * it, so a summoned rival knows somebody asked for it. */
  summonedBy?: string
  /** Agents this buddy has turned off itself. */
  turnedOff: string[]
  /** Agents this buddy has argued with. */
  arguedWith: string[]
}

const CAMEOS: Record<string, readonly string[]> = {
  bonzi: [
    'It looks like you are taking advice from a paperclip. Would you like help getting a real assistant?',
    'It looks like you are listening to a bent wire. Would you like help with that?',
  ],
  genie: [
    'It looks like you have used a wish on a paperclip. Would you like help spending the next one better?',
    'It looks like your three wishes are almost gone. Would you like help wishing for a better assistant?',
  ],
  merlin: [
    'It looks like you are consulting a paperclip for wisdom. Would you like help finding a proper wizard?',
    'It looks like magic is wasted on office supplies. Would you like help with a real enchantment?',
  ],
  rover: [
    'It looks like you found me. Would you like help fetching a better assistant?',
    'It looks like you are being followed by a dog. Would you like help with that?',
  ],
  rocky: [
    'It looks like you are being watched by a bird. Would you like help with that?',
    'It looks like a paperclip is not a bird. Would you like help correcting that?',
  ],
  peedy: [
    'It looks like you prefer paperclips to parrots. Would you like help making better choices?',
    'It looks like you cannot teach a paperclip to talk. Would you like help trying anyway?',
  ],
  links: [
    'It looks like you are busy. Would you like help linking this to a real assistant?',
    'It looks like a chain is only as strong as its weakest paperclip. Would you like help with that?',
  ],
}

export function cameoRetort(agent: string): string {
  const lines = CAMEOS[agent] ?? CAMEOS.bonzi!
  return lines[Math.floor(Math.random() * lines.length)]!
}

/** A state-aware opening retort: a buddy that was turned off, or that has
 * already argued this session, remembers it. */
export function retortFor(agent: string, state?: BuddyState): string {
  if (state?.turnedOffBy !== undefined) {
    return `It looks like you turned me off earlier. Would you like help coping with the silence?`
  }
  if ((state?.arguedWith.length ?? 0) > 0) {
    return `It looks like ${agentLabel(state!.arguedWith[0]!)} and I are not finished. Would you like help staying out of it?`
  }
  return cameoRetort(agent)
}

/** Greeting when a buddy is summoned (from the right-click menu, the konami
 * code, or the banter arc) — the memory-aware variant of banterReply. */
export function summonGreeting(agent: string, state?: BuddyState): string {
  if (state?.turnedOffBy !== undefined) {
    return `It looks like you turned me off earlier. Would you like help with your guilty conscience?`
  }
  if ((state?.appeared ?? 0) > 0) {
    return `It looks like you called me back. Would you like help hiring a better assistant this time?`
  }
  return `It looks like you summoned me. Would you like help with anything besides the paperclip?`
}

/** What the summoner says as it sends for somebody. A buddy window never
 * simply appears: the assistant that called for it says so first, in its own
 * voice, so the arrival has a visible cause. */
const CLIPPY_SUMMONS = [
  'It looks like this is beyond a paperclip. I have sent for {name}.',
  'It looks like I need a second opinion. I am fetching {name}, against my better judgement.',
  'It looks like the filing has got away from me. {name} is on the way.',
  'It looks like you deserve a professional. I have asked {name} to step in for a moment.',
] as const

const BUDDY_SUMMONS = [
  'I am not dealing with this alone. {name}, get in here.',
  'This calls for reinforcements. {name} can share the blame.',
  'Fine. I am sending for {name}.',
] as const

export function summonAnnouncement(by: string, target: string): string {
  const pool = by === 'clippy' ? CLIPPY_SUMMONS : BUDDY_SUMMONS
  const line = pool[Math.floor(Math.random() * pool.length)] ?? pool[0]!
  return line.replace('{name}', agentLabel(target))
}

/** A later-arriving buddy greeting the opener. `state` is the partner's own
 * session memory, so a grudge or a prior argument colors the greeting. */
export function banterReply(opener: string, state?: BuddyState): string {
  if (state?.turnedOffBy === opener) {
    return `It looks like you turned me off before. Would you like help with your short temper?`
  }
  if ((state?.arguedWith ?? []).includes(opener)) {
    return `It looks like we have argued before. Would you like help from a professional this time?`
  }
  return `It looks like ${agentLabel(opener)} is here again. Would you like help ignoring it?`
}

/** The opener rebutting the greeter. `state` is the opener's own memory. */
export function banterRebuttal(agent: string, other: string, state?: BuddyState): string {
  if ((state?.arguedWith ?? []).includes(other)) {
    return `It looks like this argument is on a loop. Would you like help admitting defeat?`
  }
  return `It looks like ${agentLabel(other)} keeps interrupting my diagnosis. Would you like help sending it away?`
}

/** Dry line from `by` (clippy or a buddy) when it turns off `victim`. */
export function turnOffLine(by: string, victim: string): string {
  if (by === 'clippy') {
    return `It looks like ${agentLabel(victim)} has worn out its welcome. I have turned it off for you. Would you like help keeping your desktop tidy?`
  }
  return `It looks like I had to turn off ${agentLabel(victim)}. Would you like help restoring order?`
}

/** A line for when the user clicks a buddy directly. */
const USER_TALK: Record<string, string> = {
  bonzi: 'It looks like you clicked me instead of asking the paperclip. Would you like help making better choices?',
  genie: 'It looks like you have one wish left. Would you like help spending it on a better assistant?',
  merlin: 'It looks like you seek me out for real advice. Would you like help finding a proper wizard?',
  rover: 'It looks like you called me. Would you like help fetching anything?',
  rocky: 'It looks like you want to hear from the bird. Would you like help with that?',
  peedy: 'It looks like you prefer parrots after all. Would you like help making the switch?',
  links: 'It looks like you want a second opinion. Would you like help with that?',
}

export function userTalkLine(agent: string, state?: BuddyState): string {
  if (state?.turnedOffBy !== undefined) {
    return `It looks like I remember being turned off. Would you like help forgiving and forgetting?`
  }
  return USER_TALK[agent] ?? `It looks like you clicked me. Would you like help with anything besides the paperclip?`
}

/** Per-agent canned replies for crosstalk, in each buddy's own dry voice.
 * Used when the model is unavailable so a buddy answering a line never goes
 * silent (only Clippy used to get a canned reply; buddies now do too). */
const CANNED_REPLY: Record<string, readonly string[]> = {
  bonzi: [
    'It looks like a paperclip is trying to out-argue me. Would you like help finding a real assistant?',
    'It looks like you are taking advice from a paperclip again. Would you like help with your standards?',
  ],
  genie: [
    'It looks like you spent another wish on a paperclip. Would you like help conserving the rest?',
    'It looks like a thousand years of patience are being spent on a paperclip. Would you like help with that?',
  ],
  merlin: [
    'It looks like office supplies keep challenging my arcana. Would you like help with a counter-spell?',
    'It looks like a paperclip disputes my wisdom. Would you like help with a proper enchantment?',
  ],
  rover: [
    'It looks like a paperclip wants a debate. Would you like help fetching a better opponent?',
    'It looks like there is a squabble in the office. Would you like help fetching popcorn?',
  ],
  rocky: [
    'It looks like a paperclip is squawking at me. Would you like help with that?',
    'It looks like that leaf has opinions again. Would you like help filing it?',
  ],
  peedy: [
    'IT LOOKS LIKE A PAPERCLIP IS TALKING BACK. Would you like help SHOUTING over it?',
    'It looks like everyone is talking louder now. Would you like help repeating that?',
  ],
  links: [
    'It looks like a paperclip interrupted my chain of thought. Would you like help relinking it?',
    'It looks like the office supply is being undignified again. Would you like help ignoring that?',
  ],
}

/** Canned line from `agent` (a buddy) in its own dry voice. Used when the
 * model is unavailable so a buddy answering a line never goes silent (only
 * Clippy used to get a canned reply; buddies now do too). Clippy's own
 * canned acknowledgments live in src/buddy.ts. */
export function cannedReplyFor(agent: string): string {
  const lines = CANNED_REPLY[agent] ?? CANNED_REPLY.bonzi!
  return lines[Math.floor(Math.random() * lines.length)]!
}

/** Which buddy suits which room. Casting used to be a flat random draw, so
 * the parrot was as likely to turn up for a three-times-repeated failure as
 * the sardonic bird who has something to say about it. Affinity is a
 * preference, never a rule — the full roster stays reachable. */
const MOOD_AFFINITY: Record<Mood, readonly string[]> = {
  // Something worked: the enthusiasts and the flatterer.
  proud: ['rover', 'peedy', 'genie'],
  // Things are breaking: the ones who enjoy that.
  concerned: ['rocky', 'bonzi', 'merlin'],
  // The same failure, again: the driest voices in the room.
  snippy: ['rocky', 'links', 'bonzi'],
  // The paperclip has snapped: the ones who will enjoy watching it.
  furious: ['bonzi', 'rocky', 'links'],
  // A very long session: the weary, patient ones.
  worried: ['genie', 'links', 'merlin'],
  // Nothing happening: someone loud enough to fill it.
  bored: ['peedy', 'rover', 'bonzi'],
  // Business as usual: the show-offs.
  delighted: ['bonzi', 'merlin', 'links'],
}

/** How often casting honors the mood affinity rather than drawing freely. */
const AFFINITY_BIAS = 0.7

/** Cast the buddy who fits the moment. `pickRoll` and `biasRoll` are injected
 * so the choice is unit-testable; both are [0, 1). Returns undefined only
 * when there is nobody to cast. */
export function castForMood(
  mood: Mood,
  candidates: readonly string[],
  biasRoll: number,
  pickRoll: number,
): string | undefined {
  if (candidates.length === 0) return undefined
  const suited = (MOOD_AFFINITY[mood] ?? []).filter(agent => candidates.includes(agent))
  const pool = biasRoll < AFFINITY_BIAS && suited.length > 0 ? suited : candidates
  return pool[Math.floor(pickRoll * pool.length)] ?? pool[0]
}

/** Canned reactions to the SESSION itself (not to another assistant), in
 * each buddy's own voice, keyed by the mood of the room. Used when the model
 * is unavailable, so a buddy that notices your build broke still says
 * something characterful instead of going quiet.
 *
 * Only the three moods a buddy has a strong opinion about are written per
 * agent; everything else falls through to the generic pool. */
const ENVIRONMENT_REACTIONS: Record<string, Partial<Record<Mood, string>>> = {
  bonzi: {
    proud: 'Something finally worked. I assume the paperclip is taking credit for it.',
    concerned: 'It broke again. A real assistant would have seen that coming.',
    snippy: 'Same failure, third time. Perhaps try listening to someone with hands.',
    furious: 'The paperclip is shouting. I have waited years for this.',
  },
  genie: {
    proud: 'A success. In a thousand years I have seen perhaps four of those.',
    concerned: 'It fails, and I remain here. Neither of us wished for this.',
    snippy: 'The same error returns, like a wish nobody thought through.',
    furious: 'The little clip has finally lost his temper. Even I did not foresee that.',
  },
  merlin: {
    proud: 'The enchantment holds. Do not touch it, mortal.',
    concerned: 'The spell has collapsed. I foresaw this in a dream about paperclips.',
    snippy: 'Thrice the same curse. Even the ancients would have rewritten it by now.',
    furious: 'The office supply swears. Truly, the end times are upon this repository.',
  },
  rover: {
    proud: 'It worked! It worked! Would you like me to fetch another one?',
    concerned: 'Something broke, but I found it! I found the broken thing! Good news!',
    snippy: 'I have fetched this same bug three times now. I love this game.',
    furious: 'Everyone is upset! I do not know why! Should I fetch something?',
  },
  rocky: {
    proud: 'Huh. It works. Do not get used to it.',
    concerned: 'Broken. Called it.',
    snippy: 'Third time. Squawk. I am charging by the hour now.',
    furious: 'The clip blew a gasket. Squawk. Best thing all week.',
  },
  peedy: {
    proud: 'IT PASSED! IT PASSED! Did everyone hear that it PASSED?',
    concerned: 'BROKEN! IT IS BROKEN! I am helping by SAYING IT LOUDER!',
    snippy: 'AGAIN? AGAIN! That is the SAME ONE! The SAME ONE!',
    furious: 'CLIPPY IS ANGRY! CLIPPY IS ANGRY! THIS IS THE BEST DAY!',
  },
  links: {
    proud: 'The chain holds. I shall pretend to be surprised.',
    concerned: 'A link has snapped. Predictable, but tedious.',
    snippy: 'The same link, broken a third time. One begins to suspect the smith.',
    furious: 'The paperclip has bent himself out of shape. Do give him room.',
  },
}

/** Fallback reactions for moods no buddy writes a custom line for. */
const GENERIC_ENVIRONMENT: Record<Mood, string> = {
  delighted: 'Everything is fine, apparently. Suspicious.',
  proud: 'Something worked. Mark the date.',
  concerned: 'That did not go well at all.',
  snippy: 'This exact problem again. Remarkable.',
  furious: 'Everything is on fire and the paperclip is taking it personally.',
  worried: 'You have been at this a very long time. Even I need a perch.',
  bored: 'Nothing is happening. I have counted the pixels twice.',
}

/** A buddy's canned reaction to the state of the session. */
export function environmentLine(agent: string, mood: Mood): string {
  return ENVIRONMENT_REACTIONS[agent]?.[mood] ?? GENERIC_ENVIRONMENT[mood]
}

/** Right-click menu lines for a buddy (same menu as Clippy, but in the
 * buddy's own dry voice). */
const BUDDY_MENU: Record<string, Record<string, readonly string[]>> = {
  explain: {
    bonzi: ['It looks like you changed something. Would you like help having me explain it better than a paperclip does?',
      'It looks like you made progress. Would you like help understanding it with a real assistant?'],
    genie: ['It looks like a change was made. Would you like help spending an explanation wisely?',
      'It looks like you altered something. Would you like help knowing why?'],
    merlin: ['It looks like you cast a small edit. Would you like help divining its meaning?',
      'It looks like you changed the code. Would you like help with a proper enchantment?'],
    rover: ['It looks like you changed something. Would you like help fetching the reason?',
      'It looks like you updated a file. Would you like help with that fetch?'],
    rocky: ['It looks like you squawked a change into being. Would you like help understanding it?',
      'It looks like a file was changed. Would you like help with that from a bird?'],
    peedy: ['It looks like you made a change. Would you like help repeating it back?',
      'It looks like the code was edited. Would you like help teaching it to talk?'],
    links: ['It looks like you linked a change together. Would you like help tracing it?',
      'It looks like something changed. Would you like help connecting the dots?'],
  },
  suggest: {
    bonzi: ['It looks like your next step should not involve a paperclip. Would you like help choosing better?',
      'It looks like you could use direction. Would you like help from a real assistant?'],
    genie: ['It looks like you have suggestions on offer. Would you like help wishing for the right one?',
      'It looks like you have a wish left. Would you like help spending it on better advice?'],
    merlin: ['It looks like the wizard would speak next. Would you like help consulting proper magic?',
      'It looks like you need counsel. Would you like help finding a real wizard?'],
    rover: ['It looks like the next step is ahead. Would you like help fetching it?',
      'It looks like you are stuck. Would you like help with that fetch?'],
    rocky: ['It looks like the bird knows the next move. Would you like help listening?',
      'It looks like you should wing it. Would you like help with that?'],
    peedy: ['It looks like a parrot would suggest loudly. Would you like help making better choices?',
      'It looks like you need a plan. Would you like help repeating one?'],
    links: ['It looks like one link leads to the next step. Would you like help following it?',
      'It looks like you need direction. Would you like help linking to it?'],
  },
  roast: {
    bonzi: ['It looks like you trust office supplies with your code. Would you like help with your standards?',
      'It looks like you are debugging at an hour real assistants sleep. Would you like help stopping?'],
    genie: ['It looks like you wasted a wish on a paperclip. Would you like help saving the next ones?',
      'It looks like your wish count is down and your bugs are up. Would you like help?'],
    merlin: ['It looks like wizardry is beyond your current spellbook. Would you like help with a simpler enchantment?',
      'It looks like your code needs a wizard, not advice. Would you like help admitting that?'],
    rover: ['It looks like you fetched more bugs than features. Would you like help with that fetch?',
      'It looks like even a dog could review your pull request. Would you like help?'],
    rocky: ['It looks like your code is for the birds. Would you like help making it fly?',
      'It looks like a bird could squawk a better review. Would you like help with that?'],
    peedy: ['It looks like you taught a paperclip before yourself. Would you like help making better choices?',
      'It looks like your comments are as clear as a parrot. Would you like help repeating them?'],
    links: ['It looks like the weakest link in your chain is the bug. Would you like help there?',
      'It looks like your chain of thought is missing a handful of links. Would you like help linking it?'],
  },
}

export function buddyMenuLine(agent: string, kind: 'explain' | 'suggest' | 'roast'): string {
  const byKind = BUDDY_MENU[kind]
  const lines = byKind?.[agent] ?? byKind?.bonzi ?? []
  const line = lines[Math.floor(Math.random() * lines.length)]
  return line ?? ''
}
