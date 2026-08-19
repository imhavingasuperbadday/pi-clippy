/** Draw THE SECRETS OF CLIPPY to stdout, the way the pi TUI widget draws it
 * (src/secrets.ts). A layout rig, not a test: the unit test asserts the
 * frame is square, and this is for looking at it.
 *
 *   npx tsx scripts/book-preview.ts [width] [--blank]
 *
 * `--blank` renders the book of somebody who has just installed him, which
 * is the version most people will actually see first.
 */
import { bookPages, pageColumns, paginate, renderSpread } from '../src/secrets.ts'
import { dateKey, type ClippyStats } from '../src/stats.ts'

const width = Number(process.argv[2]) || 100
const blank = process.argv.includes('--blank')

const BLANK: ClippyStats = {
  lastActiveDate: '', streak: 0, bestStreak: 0, sessions: 0, balloons: 0,
  testsPassedToday: 0, testsFailedToday: 0, testsDate: '', lastGreetingDate: '',
  lastCountedId: '', graceTokens: 0, graceWatermark: 0, firstSessionDate: '',
  lastAnniversaryYear: 0, lastMood: '', lastLeftUnresolved: false, farewellDate: '',
  petted: 0, typosCaught: 0, fed: 0, shushed: 0, officeMoments: [], secretsRead: [],
}

const stats: ClippyStats = blank ? BLANK : {
  ...BLANK,
  sessions: 40, balloons: 400, streak: 2, bestStreak: 21,
  petted: 9, typosCaught: 3, fed: 1, shushed: 4,
  officeMoments: ['resume'],
  firstSessionDate: dateKey(new Date(Date.now() - 200 * 86_400_000)),
}

const leaves = paginate(bookPages(stats), pageColumns(width))
const spreads = Math.ceil(leaves.length / 2)
for (let at = 0; at < spreads; at += 1) {
  console.log(renderSpread(leaves, at, width).join('\n'))
  console.log('')
}
console.log(`${leaves.length} pages, ${spreads} spreads, at ${width} columns`)
