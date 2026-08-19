/** Clippy's temper: fury is rare, swearing is rarer, and both need the room
 * AND the grievance to have gone bad together. */
import { sessionClimate, type SessionClimate } from '../src/mood.ts'
import {
  angryStatement,
  GRIEVANCE_ANGRY,
  GRIEVANCE_SEETHING,
  isFurious,
  SWEAR_CHANCE,
  swearStrength,
  swearingAllowed,
} from '../src/temper.ts'

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

function climate(overrides: Partial<SessionClimate>): SessionClimate {
  return {
    mood: 'delighted',
    intensity: 0.3,
    trend: 'steady',
    beat: undefined,
    errorStreak: 0,
    repeatCount: 0,
    tests: undefined,
    activityMinutes: 5,
    quiet: false,
    ...overrides,
  }
}

const calm = climate({})
const snippy = climate({ mood: 'snippy', repeatCount: 3 })
const furious = climate({ mood: 'furious', repeatCount: 6 })

// --- The climate itself only turns furious on a genuinely bad run ----------
const sixOfTheSame = sessionClimate({
  recentMessages: [],
  recentTools: [],
  recentErrors: Array.from({ length: 6 }, () => 'TypeError: cannot read property x of undefined at line 12'),
  activityMinutes: 10,
} as never)
check('six of the same failure is furious', sixOfTheSame.mood === 'furious', sixOfTheSame.mood)
const threeOfTheSame = sessionClimate({
  recentMessages: [],
  recentTools: [],
  recentErrors: Array.from({ length: 3 }, () => 'TypeError: cannot read property x of undefined at line 12'),
  activityMinutes: 10,
} as never)
check('three of the same is still only snippy', threeOfTheSame.mood === 'snippy', threeOfTheSame.mood)

// --- Fury -------------------------------------------------------------------
check('a good session is never furious', !isFurious(calm, 99))
check('a furious room is furious on its own', isFurious(furious, 0))
check('being brushed off during a bad run is furious', isFurious(snippy, GRIEVANCE_ANGRY))
check('being brushed off during a good run is not', !isFurious(calm, GRIEVANCE_ANGRY))
check('no climate, no fury', !isFurious(undefined, 99))

// --- Swearing ---------------------------------------------------------------
check('a calm paperclip never swears',
  !swearingAllowed({ profanity: true, climate: calm, grievance: 99, roll: 0 }))
check('the setting really turns it off',
  !swearingAllowed({ profanity: false, climate: furious, grievance: 99, roll: 0 }))
check('even furious, most lines stay clean',
  !swearingAllowed({ profanity: true, climate: furious, grievance: 9, roll: SWEAR_CHANCE + 0.01 }))
check('a rare furious line swears',
  swearingAllowed({ profanity: true, climate: furious, grievance: 9, roll: 0 }))

check('mild by default', swearStrength(GRIEVANCE_ANGRY, 0) === 'mild')
check('the strong word needs a real grudge', swearStrength(GRIEVANCE_SEETHING, 0) === 'strong')
check('and it is not even certain then', swearStrength(GRIEVANCE_SEETHING, 0.99) === 'mild')

// --- The canned angry lines -------------------------------------------------
check('clean angry lines are clean',
  [0, 0.34, 0.67, 0.99].every(roll => !/damn|hell|bloody|fuck/iu.test(angryStatement('clean', roll))))
check('mild lines carry exactly one mild word',
  [0, 0.34, 0.67, 0.99].every(roll => /damn|hell|bloody/iu.test(angryStatement('mild', roll))))
check('every angry line is still a statement about you',
  (['clean', 'mild', 'strong'] as const).every(strength =>
    [0, 0.5, 0.99].every(roll => /^you/u.test(angryStatement(strength, roll)))))
check('no angry line ends with punctuation the renderer adds',
  (['clean', 'mild', 'strong'] as const).every(strength =>
    [0, 0.5, 0.99].every(roll => !/[.!?]$/u.test(angryStatement(strength, roll)))))

const failed = results.filter(r => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
process.exit(failed.length === 0 ? 0 : 1)
