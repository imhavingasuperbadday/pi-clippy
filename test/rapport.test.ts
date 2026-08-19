/** The relationship (src/rapport.ts): the half of Clippy's temper that
 * measures kindness rather than only snubs.
 *
 *  - warmth and friction both move one bounded score, and neither can run
 *    away with it;
 *  - the register follows the score, and familiarity follows the persistent
 *    counters, independently — an old friend can be having a terrible day;
 *  - a day off fades the score toward neutral instead of erasing it;
 *  - cool terms make him quieter and never mute (that is what the strike and
 *    the shush are for);
 *  - a lobotomy wipes the session's feelings and records the wipe itself.
 */
import {
  clampRapport,
  decayedRapport,
  familiarityOf,
  levelForScore,
  offerBias,
  RAPPORT_LEVELS,
  RAPPORT_MAX,
  RAPPORT_MIN,
  RAPPORT_WEIGHTS,
  RapportLedger,
  rapportAside,
  rapportBriefing,
  rapportDirective,
  rapportGreeting,
  rapportOf,
  type RapportEvent,
} from '../src/rapport.ts'

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

const ALL_EVENTS = Object.keys(RAPPORT_WEIGHTS) as RapportEvent[]

// --- The ledger ------------------------------------------------------------
const ledger = new RapportLedger()
check('a fresh ledger is neutral and untouched', ledger.score === 0 && !ledger.touched)

ledger.note('accepted')
check('a yes moves the score up', ledger.score === RAPPORT_WEIGHTS.accepted, String(ledger.score))
check('any event counts as contact', ledger.touched)

ledger.note('refused')
check('a no moves it back down', ledger.score === RAPPORT_WEIGHTS.accepted + RAPPORT_WEIGHTS.refused, String(ledger.score))
check('warmth and friction are counted separately', ledger.warmth === 1 && ledger.friction === 1)

const runaway = new RapportLedger()
for (let i = 0; i < 40; i += 1) runaway.note('handed-over')
check('warmth cannot run away with the score', runaway.score === RAPPORT_MAX, String(runaway.score))
for (let i = 0; i < 80; i += 1) runaway.note('shushed')
check('friction cannot either', runaway.score === RAPPORT_MIN, String(runaway.score))

check('accepting is worth more than a single refusal',
  RAPPORT_WEIGHTS.accepted > Math.abs(RAPPORT_WEIGHTS.refused))
check('trusting him with your own session is the biggest yes there is',
  ALL_EVENTS.every(event => RAPPORT_WEIGHTS[event] <= RAPPORT_WEIGHTS['handed-over']))
check('nothing is worth nothing', ALL_EVENTS.every(event => RAPPORT_WEIGHTS[event] !== 0))

// --- The lobotomy ----------------------------------------------------------
const wiped = new RapportLedger()
wiped.note('accepted')
wiped.note('accepted')
wiped.reset()
check('a lobotomy wipes the session score', wiped.score === RAPPORT_WEIGHTS.lobotomized, String(wiped.score))
check('and the wipe itself is remembered as something that happened to him', wiped.touched)

// --- Levels and familiarity ------------------------------------------------
check('the level ladder is monotonic',
  RAPPORT_LEVELS.indexOf(levelForScore(-12)) === 0
  && RAPPORT_LEVELS.indexOf(levelForScore(12)) === RAPPORT_LEVELS.length - 1
  && [-12, -6, -2, 0, 3, 8, 12].every((score, index, all) =>
    index === 0 || RAPPORT_LEVELS.indexOf(levelForScore(score)) >= RAPPORT_LEVELS.indexOf(levelForScore(all[index - 1]!))))
check('neutral is cordial', levelForScore(0) === 'cordial')

check('a first session is a stranger', familiarityOf({ sessions: 1 }) === 'stranger')
check('a handful of sessions is an acquaintance', familiarityOf({ sessions: 4 }) === 'acquaintance')
check('a long best streak makes an old friend of a light user',
  familiarityOf({ sessions: 3, bestStreak: 20 }) === 'old-friend')
check('familiarity ignores the score entirely',
  familiarityOf({ sessions: 100 }) === familiarityOf({ sessions: 100, bestStreak: 0 }))

const badDayOldFriend = rapportOf({ carried: -4, session: -5, sessions: 200, bestStreak: 30 })
check('an old friend can be having a terrible day',
  badDayOldFriend.familiarity === 'old-friend' && badDayOldFriend.level === 'frosty',
  `${badDayOldFriend.familiarity}/${badDayOldFriend.level}`)
check('the session score is reported on its own', badDayOldFriend.sessionScore === -5)
check('carried and session scores add, then clamp',
  rapportOf({ carried: 10, session: 10 }).score === RAPPORT_MAX)
check('a broken carried score does not poison the reading',
  rapportOf({ carried: Number.NaN, session: 2 }).score === 0 || rapportOf({ carried: 0, session: 2 }).score === 2)

// --- Fading, not forgetting ------------------------------------------------
check('a day off fades the score toward neutral', Math.abs(decayedRapport(10)) < 10)
check('but does not erase it', decayedRapport(10) !== 0)
check('a long absence really does reach neutral', decayedRapport(decayedRapport(decayedRapport(1))) === 0)
check('decay keeps the sign', decayedRapport(-10) < 0)
check('clamping survives nonsense', clampRapport(Number.NaN) === 0 && clampRapport(1e9) === RAPPORT_MAX)

// --- What it actually changes ----------------------------------------------
const frosty = rapportOf({ carried: -10, sessions: 20 })
const devoted = rapportOf({ carried: 10, sessions: 60, bestStreak: 30 })
const cordial = rapportOf({ sessions: 5 })

check('cool terms make him quieter', offerBias(frosty) < 1)
check('good terms make him a little more forward', offerBias(devoted) > 1)
check('he is never silenced by the relationship alone',
  RAPPORT_LEVELS.every(level => offerBias({ ...cordial, level }) > 0))
check('ordinary terms change nothing', offerBias(cordial) === 1)

check('every level has a directive that names the register',
  RAPPORT_LEVELS.every(level => rapportDirective({ ...cordial, level }).startsWith('RAPPORT:')))
check('a stranger is never told to refer to shared history',
  /only just met/u.test(rapportDirective(rapportOf({ sessions: 1 }))))
check('an old friend is allowed to allude to it',
  /very long time/u.test(rapportDirective(devoted)))

check('ordinary terms give the buddies nothing to needle about', rapportBriefing(cordial) === undefined)
check('the ends of the scale do', rapportBriefing(frosty) !== undefined && rapportBriefing(devoted) !== undefined)

check('only the ends of the scale carry an aside',
  rapportAside(cordial, 0.5) === undefined
  && rapportAside(frosty, 0.5) !== undefined
  && rapportAside(devoted, 0.5) !== undefined)
check('an out-of-range roll still produces an aside', rapportAside(devoted, 5) !== undefined)

check('a stranger gets no greeting about where you stand', rapportGreeting(rapportOf({ sessions: 1 })) === undefined)
check('ordinary terms get no greeting either', rapportGreeting(cordial) === undefined)
check('the greeting is a statement that can follow any opener',
  [frosty, devoted].every(r => /^you/u.test(rapportGreeting(r) ?? 'you')))
check('a devoted old friend gets the long-history line',
  (rapportGreeting(devoted) ?? '').includes('a long time'))

const failed = results.filter(r => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
process.exit(failed.length === 0 ? 0 : 1)
