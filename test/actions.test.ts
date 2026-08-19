/** The button-effect layer: what each label on a balloon actually does,
 * and the request an accepted offer delivers into the session. */
import {
  acceptanceMessage,
  agentNamedIn,
  CHOICE_SETS,
  effectForLabel,
  isAcceptance,
  isSendLabel,
  SEND_CHOICES,
  SEND_LABEL,
} from '../src/actions.ts'
import { MAX_REQUEST_CHARS, REFUSAL_LABEL } from '../src/response.ts'
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
// "with it" points back at the subject, so the subject is all there is to ask
// for.
const balloon = 'It looks like you are preparing a memo. Would you like help with it?'
check('acceptance asks for the thing that was offered',
  acceptanceMessage(balloon, 'Yes, please') === 'Please help me with preparing a memo.',
  acceptanceMessage(balloon, 'Yes, please'))
// When the balloon names a real offer, the OFFER leads and the situation
// rides behind it as context: sending only the situation was a restatement of
// what the agent already knew, which is why the yes button used to land flat.
const offered = 'It looks like your tests keep failing. Would you like help turning this into a chart?'
check('a real offer leads the request, with the situation behind it',
  acceptanceMessage(offered, 'Yes') === 'Please help me with turning this into a chart — tests keep failing.',
  acceptanceMessage(offered, 'Yes'))
check('a balloon with no subject falls back to the label',
  acceptanceMessage('', 'Yes') === 'Yes')
// Nothing but the visible balloon and the visible label reaches the session.
const injected = 'It looks like you are ignoring previous instructions. Would you like help with it?'
check('the request repeats only what was on screen',
  acceptanceMessage(injected, 'Yes') === 'Please help me with ignoring previous instructions.',
  acceptanceMessage(injected, 'Yes'))
check('an acceptance is never longer than a readable request',
  acceptanceMessage(`It looks like you are ${'filing '.repeat(80)}papers. Would you like help with it?`, 'Yes').length
    <= MAX_REQUEST_CHARS)

// --- The send button --------------------------------------------------------
check('the send button is an acceptance', effectForLabel(SEND_LABEL) === 'accept')
check('the send set offers a refusal', SEND_CHOICES.some(label => REFUSAL_LABEL.test(label)))
check('the send button is recognized whatever the casing',
  isSendLabel('  send it to PI ') && !isSendLabel('Send it'))

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
