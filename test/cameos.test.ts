/** Canned cameo lines (src/cameos.ts), focused on the streak-aware summon
 * greeting: openingGreeting must only ever taunt when there is a streak
 * worth mocking, and never at rolls past STREAK_TAUNT_CHANCE. */
import {
  CAMEO_AGENTS,
  cameoRetort,
  castForMood,
  openingGreeting,
  SPECIALTIES,
  specialistFor,
  specialtyBriefing,
  topicOf,
  userTalkLine,
  STREAK_TAUNT_CHANCE,
  streakTaunt,
  summonGreeting,
} from '../src/cameos.ts'

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

// --- Every agent has a taunt that actually names the streak -----------------
for (const agent of CAMEO_AGENTS) {
  const line = streakTaunt(agent, 9)
  check(`${agent} streak taunt names the streak`, line.includes('9'), line)
}

// --- A roll under the threshold taunts, but only when there IS a streak ----
check('a low roll with a real streak taunts', openingGreeting('bonzi', undefined, 5, 0).includes('5'))
check('a low roll with no streak falls back to the normal greeting',
  openingGreeting('bonzi', undefined, 1, 0) === summonGreeting('bonzi', undefined))
check('a low roll with zero streak falls back to the normal greeting',
  openingGreeting('bonzi', undefined, 0, 0) === summonGreeting('bonzi', undefined))

// --- A roll at or past the threshold never taunts, streak or not -----------
check('a high roll never taunts even with a streak',
  openingGreeting('bonzi', undefined, 30, STREAK_TAUNT_CHANCE) === summonGreeting('bonzi', undefined))

// --- Specialities: who claims which kind of work --------------------------

const roster = [...CAMEO_AGENTS]
check('every buddy on the roster claims exactly one kind of work',
  roster.every(agent => SPECIALTIES[agent] !== undefined))
check('no two buddies claim the same one',
  new Set(roster.map(agent => SPECIALTIES[agent])).size === roster.length)
check('every buddy can state its speciality in its own voice',
  roster.every(agent => (specialtyBriefing(agent) ?? '').startsWith('YOUR SPECIALITY:')))
check('an agent outside the roster has none', specialtyBriefing('nobody') === undefined)

check('a failing suite is a tests moment', topicOf('the last test run reported failures') === 'tests')
check('a broken build is a build moment', topicOf('the last build failed') === 'build')
check('a saved file is a files moment', topicOf('the file viewer.ts was just updated') === 'files')
check('a push is a shipping moment', topicOf('the last git push failed') === 'shipping')
check('an install is a dependencies moment', topicOf('the last dependency install failed') === 'dependencies')
check('an unclassifiable beat has no specialist', topicOf('a tool just finished successfully') === undefined)
check('no beat at all has no specialist', topicOf(undefined) === undefined)

check('the specialist for a topic is the buddy who claims it',
  specialistFor('tests', roster) === 'rocky' && specialistFor('build', roster) === 'merlin')
check('a specialist missing from the roster is simply nobody',
  specialistFor('tests', ['genie', 'peedy']) === undefined)

// The specialist is put at the FRONT of the suited pool, so the lowest pick
// roll under the affinity bias lands on them.
check('the specialist gets the summons when the room is about their work',
  castForMood('concerned', roster, 0, 0, [], 'tests') === 'rocky',
  String(castForMood('concerned', roster, 0, 0, [], 'tests')))
check('but never becomes the only assistant on the desktop',
  castForMood('concerned', roster, 0.99, 0.99, [], 'tests') !== 'rocky')
check('casting without a topic behaves exactly as before',
  castForMood('proud', roster, 0, 0) === castForMood('proud', roster, 0, 0, [], undefined))

// --- The canned pools are pools, not single lines -------------------------

check('every buddy has more than one retort',
  roster.every(agent => new Set([0, 0.3, 0.6, 0.9].map(roll => cameoRetort(agent, roll))).size > 1))
check('every buddy has more than one thing to say when clicked',
  roster.every(agent => new Set([0, 0.4, 0.8].map(roll => userTalkLine(agent, undefined, roll))).size > 1))
check('a buddy that was turned off says so instead, whatever the roll',
  [0, 0.5, 0.9].every(roll => userTalkLine('rocky', {
    agent: 'rocky', appeared: 1, interruptCount: 0, turnedOffBy: 'clippy', turnedOff: [], arguedWith: [],
  }, roll).includes('turned off')))

const failed = results.filter(r => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
process.exit(failed.length === 0 ? 0 : 1)
