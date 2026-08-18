/** Canned cameo lines (src/cameos.ts), focused on the streak-aware summon
 * greeting: openingGreeting must only ever taunt when there is a streak
 * worth mocking, and never at rolls past STREAK_TAUNT_CHANCE. */
import {
  CAMEO_AGENTS,
  openingGreeting,
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

const failed = results.filter(r => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
process.exit(failed.length === 0 ? 0 : 1)
