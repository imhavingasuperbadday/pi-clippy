/** The model-free lines (src/fallback.ts): what Clippy says when generation
 * is unavailable, and the plain neutral beat every character reads the
 * session through.
 *
 *  - the beat stays neutral and singular (it grounds prompts, so it must not
 *    wander);
 *  - the spoken line varies with the roll, so a session with no model route
 *    does not repeat one sentence all afternoon;
 *  - both read the SAME test verdict, so the climate and the balloon can
 *    never disagree about whether the suite passed;
 *  - every spoken variant is still a statement about "you" or "your", which
 *    is what the balloon renderer assumes.
 */
import type { ClippyEvidence, ClippyToolEvidence } from '../src/context.ts'
import { latestOperationalBeat, latestTestOutcome, operationalFallbackStatement } from '../src/fallback.ts'

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

function tool(partial: Partial<ClippyToolEvidence> = {}): ClippyToolEvidence {
  return { name: 'bash', arguments: '{}', outcome: 'success', ...partial }
}

function evidence(tools: readonly ClippyToolEvidence[]): ClippyEvidence {
  return {
    activityMinutes: 5,
    recentMessages: [],
    recentTools: [...tools],
    recentErrors: [],
    omittedEarlierContext: false,
  }
}

const ROLLS = [0, 0.26, 0.51, 0.76, 0.99]

const failing = evidence([tool({ name: 'npm_test', resultExcerpt: '3 tests failed' })])
const passing = evidence([tool({ name: 'npm_test', resultExcerpt: '42 tests passed' })])
const wrote = evidence([tool({ name: 'edit_file', arguments: '{"file_path":"src/viewer.ts"}' })])
const broke = evidence([tool({ name: 'bash', arguments: '{"cmd":"npm run build"}', outcome: 'error' })])
const running = evidence([tool({ name: 'bash', arguments: '{"cmd":"npm run build"}', outcome: 'running' })])
const finished = evidence([tool({ name: 'bash', arguments: '{"cmd":"git status"}' })])

// --- The neutral beat is neutral, and singular ----------------------------
check('a failing suite has one plain beat', latestOperationalBeat(failing) === 'the last test run reported failures')
check('a passing suite has one plain beat', latestOperationalBeat(passing) === 'the last test run passed')
check('an empty session has no beat', latestOperationalBeat(evidence([])) === undefined)
check('the beat never varies with a roll',
  new Set([latestOperationalBeat(broke), latestOperationalBeat(broke)]).size === 1)

// --- The verdict is read once, by both halves -----------------------------
check('the climate and the beat agree on a failure',
  latestTestOutcome(failing) === 'failing' && (latestOperationalBeat(failing) ?? '').includes('failures'))
check('and on a pass',
  latestTestOutcome(passing) === 'passing' && (latestOperationalBeat(passing) ?? '').includes('passed'))
check('a session that never ran tests has no verdict', latestTestOutcome(finished) === undefined)
check('the newest run wins',
  latestTestOutcome(evidence([
    tool({ name: 'npm_test', resultExcerpt: '3 tests failed' }),
    tool({ name: 'npm_test', resultExcerpt: '42 tests passed' }),
  ])) === 'passing')

// --- The spoken line varies ------------------------------------------------
for (const [name, sample] of [
  ['a failing suite', failing],
  ['a passing suite', passing],
  ['a saved file', wrote],
  ['a failed command', broke],
  ['a command still going', running],
  ['a finished command', finished],
] as const) {
  const said = ROLLS.map(roll => operationalFallbackStatement(sample, roll))
  check(`${name} has more than one way of being said`, new Set(said).size > 1, said[0] ?? '')
  check(`${name} is always a statement about you`, said.every(line => /^(?:you|your)\b/u.test(line ?? '') || /^\S+ (?:has been|has|was)\b/u.test(line ?? '')), said[0] ?? '')
  check(`${name} never ends with punctuation the renderer adds`, said.every(line => !/[.!?]$/u.test(line ?? '')))
}

check('the failure count is carried into every variant',
  ROLLS.every(roll => (operationalFallbackStatement(failing, roll) ?? '').includes('3')),
  operationalFallbackStatement(failing, 0.99))
check('the file name is carried into every variant',
  ROLLS.every(roll => (operationalFallbackStatement(wrote, roll) ?? '').includes('viewer.ts')),
  operationalFallbackStatement(wrote, 0.51))
check('an out-of-range roll still says something',
  (operationalFallbackStatement(failing, 7) ?? '').length > 0)
check('an empty session says nothing at all',
  operationalFallbackStatement(evidence([]), 0.5) === undefined)

const failed = results.filter(r => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
process.exit(failed.length === 0 ? 0 : 1)
