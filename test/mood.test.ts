/** Unit test for the session climate (src/mood.ts) and the mood-aware
 * casting it drives (src/cameos.ts):
 *
 *  - error signatures collapse line numbers, ids, and paths, so "the same
 *    failure again" is actually detectable;
 *  - the mood ladder resolves most-specific first (a repeated failure beats
 *    a fresh one, which beats a success);
 *  - the trailing error streak measures how it is going NOW, not whether
 *    anything ever failed;
 *  - casting prefers the buddies who suit the room but can still reach the
 *    whole roster.
 */
import type { ClippyEvidence, ClippyToolEvidence } from '../src/context.ts'
import { castForMood, environmentLine } from '../src/cameos.ts'
import {
  climateBriefing,
  climateTrend,
  errorSignature,
  moodIntensity,
  moodRing,
  isRemarkable,
  moodDirective,
  MOODS,
  repeatedErrorCount,
  sessionClimate,
  trailingErrorStreak,
} from '../src/mood.ts'

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

function tool(partial: Partial<ClippyToolEvidence> = {}): ClippyToolEvidence {
  return { name: 'bash', arguments: '{}', outcome: 'success', ...partial }
}

function evidence(partial: Partial<ClippyEvidence> = {}): ClippyEvidence {
  return {
    activityMinutes: 5,
    recentMessages: [{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'hi' }],
    recentTools: [],
    recentErrors: [],
    omittedEarlierContext: false,
    ...partial,
  }
}

// --- error signatures ------------------------------------------------------

check(
  'signature ignores line numbers',
  errorSignature('TypeError at foo.ts:41') === errorSignature('TypeError at foo.ts:912'),
  errorSignature('TypeError at foo.ts:41'),
)
check(
  'signature ignores hex ids',
  errorSignature('leak 0xdeadbeef in pool') === errorSignature('leak 0xfeed1234 in pool'),
)
check(
  'signature keeps genuinely different errors apart',
  errorSignature('cannot read property x') !== errorSignature('connection refused'),
)

check('repeated count finds the worst offender', repeatedErrorCount([
  'tsc: type error at a.ts:3',
  'eslint: no-unused-vars',
  'tsc: type error at a.ts:88',
  'tsc: type error at a.ts:120',
]) === 3, String(repeatedErrorCount(['a', 'a', 'a'])))
check('repeated count of distinct errors is 1', repeatedErrorCount(['alpha fails', 'beta breaks']) === 1)
check('repeated count of nothing is 0', repeatedErrorCount([]) === 0)

// --- trailing streak -------------------------------------------------------

check('streak counts only the tail', trailingErrorStreak(evidence({
  recentTools: [tool({ outcome: 'error' }), tool({ outcome: 'success' }), tool({ outcome: 'error' })],
})) === 1)
check('streak accumulates consecutive failures', trailingErrorStreak(evidence({
  recentTools: [tool({ outcome: 'success' }), tool({ outcome: 'error' }), tool({ outcome: 'error' })],
})) === 2)
check('a running tool does not break the streak', trailingErrorStreak(evidence({
  recentTools: [tool({ outcome: 'error' }), tool({ outcome: 'running' })],
})) === 1)

// --- the mood ladder -------------------------------------------------------

const repeated = sessionClimate(evidence({
  recentErrors: ['tsc failed at x.ts:1', 'tsc failed at x.ts:9', 'tsc failed at x.ts:40'],
  recentTools: [tool({ outcome: 'error' })],
}))
check('a thrice-repeated failure is snippy', repeated.mood === 'snippy', repeated.mood)
check('snippy carries the repeat count', repeated.repeatCount === 3, String(repeated.repeatCount))

const failingStreak = sessionClimate(evidence({
  recentTools: [tool({ outcome: 'error' }), tool({ outcome: 'error' })],
  recentErrors: ['alpha broke', 'beta broke'],
}))
check('two fresh failures in a row is concerned', failingStreak.mood === 'concerned', failingStreak.mood)

const passing = sessionClimate(evidence({
  recentTools: [tool({ name: 'npm_test', outcome: 'success', resultExcerpt: '42 passed' })],
}))
check('a passing suite is proud', passing.mood === 'proud', passing.mood)
check('a passing suite reports tests passing', passing.tests === 'passing', String(passing.tests))
check('the beat names the test run', passing.beat === 'the last test run passed', String(passing.beat))

const failingTests = sessionClimate(evidence({
  recentTools: [tool({ name: 'npm_test', outcome: 'success', resultExcerpt: '3 failed' })],
}))
check('a failing suite is concerned even without a tool error',
  failingTests.mood === 'concerned', failingTests.mood)

const marathon = sessionClimate(evidence({ activityMinutes: 200 }))
check('a very long session worries about the human', marathon.mood === 'worried', marathon.mood)

const empty = sessionClimate(evidence({ recentMessages: [], recentTools: [] }))
check('an empty session is bored', empty.mood === 'bored', empty.mood)
check('an empty session has no beat', empty.beat === undefined, String(empty.beat))

const normal = sessionClimate(evidence({ recentTools: [tool({ name: 'read_file' })] }))
check('an ordinary session is delighted', normal.mood === 'delighted', normal.mood)

// A failure outranks a success when both are present in the same room.
const mixed = sessionClimate(evidence({
  recentTools: [tool({ name: 'npm_test', outcome: 'success', resultExcerpt: '9 passed' }), tool({ outcome: 'error' }), tool({ outcome: 'error' })],
  recentErrors: ['a', 'b'],
}))
check('a fresh failure outranks an earlier success', mixed.mood === 'concerned', mixed.mood)

// --- prompt surfaces -------------------------------------------------------

check('every mood has a directive', MOODS.every(mood => {
  const climate = { ...normal, mood }
  return moodDirective(climate).startsWith('MOOD:')
}))
check('every mood has a briefing', MOODS.every(mood => climateBriefing({ ...normal, mood }).length > 10))
check('the briefing carries the beat', climateBriefing(passing).includes('the last test run passed'),
  climateBriefing(passing))
check('only eventful rooms are remarkable',
  isRemarkable(repeated) && isRemarkable(passing) && !isRemarkable(empty) && !isRemarkable(normal))

// --- casting ---------------------------------------------------------------

const roster = ['bonzi', 'genie', 'merlin', 'rover', 'rocky', 'peedy', 'links']
check('a repeated failure casts the dry voices',
  castForMood('snippy', roster, 0, 0) === 'rocky', String(castForMood('snippy', roster, 0, 0)))
check('a success casts the enthusiasts',
  castForMood('proud', roster, 0, 0) === 'rover', String(castForMood('proud', roster, 0, 0)))
check('a high bias roll draws from the whole roster',
  castForMood('proud', roster, 0.99, 0) === 'bonzi', String(castForMood('proud', roster, 0.99, 0)))
check('casting never leaves the candidate list',
  roster.includes(castForMood('concerned', roster, 0.5, 0.99)!))
check('casting respects a restricted roster',
  castForMood('proud', ['links'], 0, 0) === 'links')
check('casting an empty roster yields nobody',
  castForMood('proud', [], 0, 0) === undefined)

// --- canned environment reactions -----------------------------------------

check('every agent has a line for every mood',
  roster.every(agent => MOODS.every(mood => environmentLine(agent, mood).length > 5)))
check('an unknown agent still gets a line', environmentLine('nobody', 'proud').length > 5)
check('agents differ on the moods they care about',
  environmentLine('rocky', 'snippy') !== environmentLine('peedy', 'snippy'))

// --- Intensity: the mood has a volume as well as a name -------------------

const twoFailures = sessionClimate(evidence({ recentTools: [tool({ outcome: 'error' }), tool({ outcome: 'error' })] }))
const manyFailures = sessionClimate(evidence({
  recentTools: Array.from({ length: 9 }, () => tool({ outcome: 'error' })),
}))
check('a worse room is felt harder in the same mood family',
  manyFailures.intensity > twoFailures.intensity,
  `${twoFailures.mood}:${twoFailures.intensity} vs ${manyFailures.mood}:${manyFailures.intensity}`)
check('intensity always lands in [0, 1]',
  MOODS.every(mood => [0, 3, 9].every(n => {
    const value = moodIntensity(mood, { errorStreak: n, repeatCount: n, activityMinutes: n * 40, tests: undefined })
    return value >= 0 && value <= 1
  })))
check('the directive says so when the feeling is at its strongest',
  moodDirective({ ...manyFailures, intensity: 1 }).includes('strongest'))
check('and says so when it is faint',
  moodDirective({ ...twoFailures, mood: 'concerned', intensity: 0.3 }).includes('understate'))
check('a calm mood is never given an intensity instruction',
  !moodDirective(sessionClimate(evidence())).includes('strongest'))

// --- The ring carries the volume ------------------------------------------

check('a calm ring is drawn exactly as it always was',
  moodRing('delighted', 1).width === 2 && moodRing('delighted', 1).glow === 0)
check('a bad room draws a heavier ring',
  moodRing('furious', 1).width > moodRing('furious', 0).width)
check('the halo scales with the feeling and never inverts',
  moodRing('concerned', 1).glow > moodRing('concerned', 0.2).glow && moodRing('concerned', 0).glow === 0)
check('a nonsense intensity still produces a drawable ring',
  moodRing('snippy', Number.NaN).width >= 2)

// --- Trend: which way the room is going -----------------------------------

check('too little evidence is never a trend', climateTrend(evidence({ recentTools: [tool({ outcome: 'error' })] })) === 'steady')
check('a session coming apart reads as worsening',
  climateTrend(evidence({
    recentTools: [tool(), tool(), tool({ outcome: 'error' }), tool({ outcome: 'error' })],
  })) === 'worsening')
check('a session pulling out of it reads as improving',
  climateTrend(evidence({
    recentTools: [tool({ outcome: 'error' }), tool({ outcome: 'error' }), tool(), tool()],
  })) === 'improving')
check('one flaky call in a good run is not a collapse',
  climateTrend(evidence({
    recentTools: [tool(), tool(), tool(), tool(), tool(), tool(), tool(), tool({ outcome: 'error' })],
  })) === 'steady')
check('unfinished calls are not evidence of anything',
  climateTrend(evidence({
    recentTools: [tool(), tool(), tool({ outcome: 'running' }), tool({ outcome: 'running' })],
  })) === 'steady')
check('the buddies are told which way it is going',
  climateBriefing(sessionClimate(evidence({
    recentTools: [tool({ outcome: 'error' }), tool({ outcome: 'error' }), tool(), tool()],
  }))).includes('getting better'))

const failed = results.filter(r => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
process.exit(failed.length === 0 ? 0 : 1)
