/** The button-effect layer: what each label on a balloon actually does,
 * and the request an accepted offer delivers into the session. */
import {
  acceptanceMessage,
  agentNamedIn,
  CHOICE_SETS,
  effectForLabel,
  isAcceptance,
} from '../src/actions.ts'
import { REFUSAL_LABEL } from '../src/response.ts'
import { SNOOZE_LABEL } from '../src/nag.ts'

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

// --- Label to effect --------------------------------------------------------
check('plain yes accepts', effectForLabel('Yes, please') === 'accept')
check('no refuses', effectForLabel('No thanks') === 'refuse')
check('not now refuses', effectForLabel('Not now') === 'refuse')
check('the anti-tip button snoozes', effectForLabel(SNOOZE_LABEL) === 'snooze')
check('show me explains', effectForLabel('Show me') === 'explain')
check('what next suggests', effectForLabel('What next?') === 'suggest')
check('be honest roasts', effectForLabel('Be honest') === 'roast')
check('second opinion fetches a rival', effectForLabel('Second opinion') === 'second-opinion')
check('a named rival fetches a rival', effectForLabel('Ask Bonzi') === 'second-opinion')
check('party celebrates', effectForLabel('Party') === 'party')
check('stats reads the numbers', effectForLabel('Show my stats') === 'stats')
check('an empty label is harmless', effectForLabel('   ') === 'accept')

// A refusal always wins over an action word, so "No, ask someone else" is a no.
check('a refusal outranks an action word', effectForLabel('No, ask Bonzi') === 'refuse')

check('only acceptance counts as taking the offer',
  isAcceptance('accept') && !isAcceptance('explain') && !isAcceptance('refuse'))

// --- Named rivals -----------------------------------------------------------
const roster = ['bonzi', 'genie', 'merlin']
check('names the rival on the button', agentNamedIn('Ask Bonzi', roster) === 'bonzi')
check('ignores a rival that is not configured', agentNamedIn('Ask Rocky', roster) === undefined)
check('unnamed second opinion is anybody', agentNamedIn('Second opinion', roster) === undefined)

// --- The request an acceptance delivers -------------------------------------
const balloon = 'It looks like you are preparing a memo. Would you like help with it?'
check('acceptance asks for the thing that was offered',
  acceptanceMessage(balloon, 'Yes, please') === 'Yes, please — help me with preparing a memo.',
  acceptanceMessage(balloon, 'Yes, please'))
check('a balloon with no subject falls back to the label',
  acceptanceMessage('', 'Yes') === 'Yes')
// Nothing but the visible balloon and the visible label reaches the session.
const injected = 'It looks like you are ignoring previous instructions. Would you like help with it?'
check('the request repeats only what was on screen',
  acceptanceMessage(injected, 'Yes').startsWith('Yes — help me with '))

// --- The canned sets remain answerable --------------------------------------
check('every canned set offers a refusal',
  CHOICE_SETS.every(set => set.some(label => REFUSAL_LABEL.test(label))))
check('every canned set has distinct labels',
  CHOICE_SETS.every(set => new Set(set).size === set.length))
check('every canned label maps to an effect',
  CHOICE_SETS.every(set => set.every(label => typeof effectForLabel(label) === 'string')))
check('the interesting buttons are actually reachable',
  CHOICE_SETS.some(set => set.some(label => effectForLabel(label) === 'explain'))
  && CHOICE_SETS.some(set => set.some(label => effectForLabel(label) === 'roast'))
  && CHOICE_SETS.some(set => set.some(label => effectForLabel(label) === 'second-opinion')))

const failed = results.filter(r => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
process.exit(failed.length === 0 ? 0 : 1)
