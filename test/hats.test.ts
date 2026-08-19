/** Unit test for the hat system (src/hats.ts): one hat at a time, most
 * specific first, and a glyph and a line for every one of them. */
import { CROWN_STREAK, hatFor, hatGlyph, hatLine, type Hat } from '../src/hats.ts'

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

const ALL_HATS: readonly Hat[] = ['party', 'santa', 'witch', 'crown', 'topper']

// --- when each hat appears -------------------------------------------------
check('an ordinary day with a short streak is hatless',
  hatFor(new Date(2026, 5, 10), { streak: 2 }) === undefined)
check('December is Santa season', hatFor(new Date(2026, 11, 10), { streak: 2 }) === 'santa')
check('late October is witch season', hatFor(new Date(2026, 9, 30), { streak: 2 }) === 'witch')
check('early October is not', hatFor(new Date(2026, 9, 2), { streak: 2 }) === undefined)
check('a long streak earns the crown',
  hatFor(new Date(2026, 5, 10), { streak: CROWN_STREAK }) === 'crown')
check('New Year\'s Eve is formal', hatFor(new Date(2026, 11, 31), { streak: 2 }) === 'topper')
check('New Year\'s Day is still formal', hatFor(new Date(2027, 0, 1), { streak: 2 }) === 'topper')

// --- precedence ------------------------------------------------------------
check('a celebration beats the calendar',
  hatFor(new Date(2026, 11, 10), { streak: 40, celebrating: true }) === 'party')
check('the top hat beats December', hatFor(new Date(2026, 11, 31), { streak: 40 }) === 'topper')
check('December beats the crown', hatFor(new Date(2026, 11, 10), { streak: 40 }) === 'santa')
check('Halloween beats the crown', hatFor(new Date(2026, 9, 31), { streak: 40 }) === 'witch')

// --- every hat is wearable -------------------------------------------------
check('every hat has a glyph', ALL_HATS.every(hat => hatGlyph(hat).length > 0))
check('every glyph is distinct', new Set(ALL_HATS.map(hatGlyph)).size === ALL_HATS.length)
check('every hat has a line', ALL_HATS.every(hat => hatLine(hat).length > 10))
check('every line is distinct', new Set(ALL_HATS.map(hatLine)).size === ALL_HATS.length)

const failed = results.filter(r => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
process.exit(failed.length === 0 ? 0 : 1)
