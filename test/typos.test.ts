/** Unit test for the deliberate typos (src/typos.ts): the rare plant, the
 * lines it refuses to touch, the callout, and the mortified correction. */
import { isTypoCallout, mortifiedLine, plantTypo, TYPO_CHANCE } from '../src/typos.ts'

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

const LINE = 'It looks like you are filing the letter and I would be glad to help with that'

// --- planting --------------------------------------------------------------
check('a high roll leaves the line alone', plantTypo(LINE, 0.9) === undefined)
check('a low roll plants one', plantTypo(LINE, 0)?.text !== LINE)
check('the plant reports what it broke', plantTypo(LINE, 0)?.correct !== undefined)
const planted = plantTypo(LINE, 0, 0)
check('the planted text really contains the typo',
  planted !== undefined && planted.text.includes(planted.wrong), planted?.text)
check('exactly one word is changed',
  planted !== undefined
  && planted.text.split(/\s+/u).length === LINE.split(/\s+/u).length
  && planted.text.replace(planted.wrong, planted.correct) === LINE)
check('a short line is never touched', plantTypo('Very well.', 0) === undefined)
check('a line with no typo-able word is left alone',
  plantTypo('I have arranged my paperclips, sorted by size, twice over now', 0) === undefined)
check('typos are rare by construction', TYPO_CHANCE <= 0.05)
check('every roll below the chance is safe to call',
  [0, 0.01, 0.02, 0.03].every(roll => {
    const result = plantTypo(LINE, roll, 0.5)
    return result === undefined || result.text.length > 0
  }))

// --- catching him ----------------------------------------------------------
const caught = plantTypo(LINE, 0, 0)!
check('naming the wrong word is a callout',
  isTypoCallout(`you wrote ${caught.wrong}`, caught))
check('saying typo is a callout', isTypoCallout('that was a typo', caught))
check('saying spelling is a callout', isTypoCallout('check your spelling', caught))
check('saying misspelled is a callout even without the word',
  isTypoCallout('you misspelled a word', caught))
check('misspelling and misspelt count too',
  isTypoCallout('that was a misspelling', caught) && isTypoCallout('you misspelt it', caught))
check('an ordinary message is not a callout',
  !isTypoCallout('what should I do next', caught))
check('nothing planted means nothing to catch',
  !isTypoCallout('that was a typo', undefined))

// --- the correction --------------------------------------------------------
check('the correction names both words',
  mortifiedLine(caught, 1).includes(caught.wrong) && mortifiedLine(caught, 1).includes(caught.correct))
check('the first catch asks for discretion',
  mortifiedLine(caught, 1).includes('do not tell the others'))
check('a few catches are counted back',
  mortifiedLine(caught, 3).includes('That is 3'))
check('many catches earn grudging respect',
  mortifiedLine(caught, 6).includes('impressed'))

const failed = results.filter(r => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
process.exit(failed.length === 0 ? 0 : 1)
