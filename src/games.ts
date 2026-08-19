/** Rock, paper, scissors — the thing the bored mood finally has to do.
 *
 * The mood system has always been able to report `bored`, and boredom had
 * nowhere to go. This is a whole game played through the balloon buttons
 * that already exist: no new UI, no new powers, three labels and a running
 * score. Best of three; he sulks on a loss and is insufferable on a win.
 *
 * Pure and unit-tested (test/games.test.ts): the runtime owns the state
 * object, this owns every decision and every line.
 */

export type Throw = 'rock' | 'paper' | 'scissors'
export type Outcome = 'win' | 'lose' | 'draw'

export const THROWS: readonly Throw[] = ['rock', 'paper', 'scissors']

/** The balloon buttons. Deliberately not "Rock"/"Paper"/"Scissors" alone:
 * every choice set in this extension carries a way out, and a game you
 * cannot leave is not a game. */
export const RPS_CHOICES: readonly string[] = ['Rock', 'Paper', 'Scissors']
export const RPS_QUIT = 'Not now'

/** The label the user pressed, as a throw. Undefined for anything else,
 * including the refusal. */
export function throwForLabel(label: string): Throw | undefined {
  const text = label.trim().toLowerCase()
  return THROWS.find(candidate => text.includes(candidate))
}

/** Clippy's throw. He is not cheating; he simply believes in paper. */
export function clippyThrow(roll: number = Math.random()): Throw {
  // A paperclip's honest bias, and the reason he loses so often.
  if (roll < 0.5) return 'paper'
  return roll < 0.75 ? 'rock' : 'scissors'
}

/** Who won, from the user's point of view. */
export function judge(user: Throw, clippy: Throw): Outcome {
  if (user === clippy) return 'draw'
  const beats: Record<Throw, Throw> = { rock: 'scissors', paper: 'rock', scissors: 'paper' }
  return beats[user] === clippy ? 'win' : 'lose'
}

export interface GameState {
  /** Rounds won by the user, and by Clippy. */
  userScore: number
  clippyScore: number
  rounds: number
}

export const BEST_OF = 3
const WINS_NEEDED = Math.ceil(BEST_OF / 2)

export function newGame(): GameState {
  return { userScore: 0, clippyScore: 0, rounds: 0 }
}

/** Apply one round. Returns the line he says and whether the match is over. */
export function playRound(state: GameState, user: Throw, clippy: Throw): { readonly line: string; readonly over: boolean } {
  const outcome = judge(user, clippy)
  state.rounds += 1
  if (outcome === 'win') state.userScore += 1
  if (outcome === 'lose') state.clippyScore += 1
  const over = state.userScore >= WINS_NEEDED || state.clippyScore >= WINS_NEEDED
  const board = `${state.userScore} to ${state.clippyScore}`
  if (over) {
    return {
      line: state.userScore > state.clippyScore
        ? `${throwLine(clippy)} You win, ${board}. I would like to note that I let you.`
        : `${throwLine(clippy)} I win, ${board}. I will have this typed up and circulated.`,
      over: true,
    }
  }
  const reaction = outcome === 'win'
    ? 'You win that one. I was distracted by a letter.'
    : outcome === 'lose'
      ? 'I win that one. It is a simple game if you understand paper.'
      : 'A draw. Two great minds, one of them bent.'
  return { line: `${throwLine(clippy)} ${reaction} ${board}. Again?`, over: false }
}

function throwLine(clippy: Throw): string {
  return `I chose ${clippy}.`
}

/** The offer that starts a game, when the room has gone quiet enough that
 * he would rather play than watch. */
export const RPS_OFFER = 'It looks like nothing is happening at all. Would you like help passing the time with rock, paper, scissors?'
export const RPS_OFFER_CHOICES: readonly string[] = ['Yes, please', 'Not now']
