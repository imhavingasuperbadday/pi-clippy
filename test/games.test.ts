/** Unit test for rock, paper, scissors (src/games.ts): the judging table,
 * Clippy's honest bias toward paper, and a best-of-three that ends. */
import {
  clippyThrow,
  judge,
  newGame,
  playRound,
  RPS_CHOICES,
  RPS_OFFER_CHOICES,
  throwForLabel,
  THROWS,
  type Throw,
} from '../src/games.ts'
import { REFUSAL_LABEL } from '../src/response.ts'

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

// --- judging ---------------------------------------------------------------
check('rock beats scissors', judge('rock', 'scissors') === 'win')
check('paper beats rock', judge('paper', 'rock') === 'win')
check('scissors beats paper', judge('scissors', 'paper') === 'win')
check('rock loses to paper', judge('rock', 'paper') === 'lose')
check('every throw draws with itself', THROWS.every(t => judge(t, t) === 'draw'))
check('the table is complete and consistent',
  THROWS.every(a => THROWS.every(b => ['win', 'lose', 'draw'].includes(judge(a, b)))))

// --- labels ----------------------------------------------------------------
check('the buttons map back to throws',
  RPS_CHOICES.every(label => throwForLabel(label) !== undefined))
check('a refusal is not a throw', throwForLabel('Not now') === undefined)
check('the offer to play carries a way out',
  RPS_OFFER_CHOICES.some(label => REFUSAL_LABEL.test(label)))

// --- his bias --------------------------------------------------------------
check('he believes in paper', clippyThrow(0.1) === 'paper')
check('but he can be talked into rock', clippyThrow(0.6) === 'rock')
check('and occasionally scissors', clippyThrow(0.9) === 'scissors')
check('every roll produces a legal throw',
  [...Array(20).keys()].every(i => THROWS.includes(clippyThrow(i / 20))))

// --- a match that ends -----------------------------------------------------
const state = newGame()
const first = playRound(state, 'paper', 'rock')
check('a first win is not the match', !first.over)
check('the round line reports his throw', first.line.includes('I chose rock'))
check('the round line shows the board', first.line.includes('1 to 0'))
const second = playRound(state, 'paper', 'rock')
check('two wins take the match', second.over)
check('losing gracefully means claiming he let you', second.line.includes('let you'))

const hisMatch = newGame()
playRound(hisMatch, 'rock', 'paper')
const won = playRound(hisMatch, 'rock', 'paper')
check('he can win the match too', won.over && won.line.includes('I win'))
check('and he circulates it', won.line.includes('circulated'))

const drawn = newGame()
const draw = playRound(drawn, 'rock', 'rock')
check('a draw scores nobody', drawn.userScore === 0 && drawn.clippyScore === 0)
check('a draw still counts as a round', drawn.rounds === 1 && !draw.over)

// --- the match cannot run forever ------------------------------------------
const bounded = newGame()
let rounds = 0
let over = false
while (!over && rounds < 10) {
  over = playRound(bounded, 'rock' as Throw, 'scissors' as Throw).over
  rounds += 1
}
check('a one-sided match ends in two rounds', over && rounds === 2)

const failed = results.filter(r => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
process.exit(failed.length === 0 ? 0 : 1)
