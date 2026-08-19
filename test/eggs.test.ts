/** Unit test for the typed-trigger easter eggs (src/eggs.ts): whole-message
 * magic words, incidental self-awareness triggers, and the two counters
 * (keyboard mash, brush-off strike). */
import {
  detectEgg,
  eggLine,
  isBrushOff,
  isKeyboardMash,
  normalizeTrigger,
  STRIKE_THRESHOLD,
} from '../src/eggs.ts'

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

// --- normalization ---------------------------------------------------------
check('normalizeTrigger lowercases and trims punctuation',
  normalizeTrigger('  XYZZY!  ') === 'xyzzy')
check('normalizeTrigger keeps inner characters',
  normalizeTrigger('=rand()') === '=rand()')

// --- whole-message eggs ----------------------------------------------------
check('xyzzy gets the hollow voice', detectEgg('xyzzy')?.line.includes('plugh') === true)
check('plugh answers back', detectEgg('plugh')?.id === 'plugh')
check('42 asks the ultimate question', detectEgg('42')?.id === 'answer')
check('42 carries buttons, because it asks', (detectEgg('42')?.choices?.length ?? 0) >= 2)
check('barrel roll rolls the window', detectEgg('do a barrel roll')?.effect === 'barrel-roll')
check('pod bay doors get the Dave line', detectEgg('open the pod bay doors, HAL')?.id === 'pod-bay')
check('a flipped desk is detected by its drawing',
  detectEgg('(╯°□°）╯︵ ┻━┻')?.effect === 'tableflip')
check('the desk can be put back', detectEgg('┬─┬ノ( º _ ºノ)')?.effect === 'tableback')
check('Zuul summons the ghost', detectEgg('There is no Dana, only Zuul')?.effect === 'ghost')
check('lobotomy blanks him out', detectEgg('lobotomy')?.id === 'lobotomy')
check('lobotomy wears the blank look', detectEgg('lobotomy')?.effect === 'ghost')
check('lobotomy is a whole-message egg, not a sentence trigger', detectEgg('I need a lobotomy') === undefined)
check('Lobotomy. is forgiven by normalization', detectEgg('  Lobotomy!')?.id === 'lobotomy')
check('rosebud rains coins', detectEgg('rosebud')?.effect === 'coins')
check('the full Sims cheat also works', detectEgg('rosebud;!;!;!')?.effect === 'coins')
check('zzzz puts him to sleep', detectEgg('zzzz')?.effect === 'sleep')
check('=rand() returns a memo', detectEgg('=rand()')?.line.startsWith('MEMORANDUM') === true)
check('alt+f4 is deadpan', detectEgg('alt+f4')?.line === 'That will not work on me.')

// --- eggs never fire from inside ordinary sentences ------------------------
check('a sentence mentioning xyzzy is not the magic word',
  detectEgg('I named the test fixture xyzzy for a reason') === undefined)
check('a sentence containing 42 is not the ultimate question',
  detectEgg('bump the timeout to 42 seconds') === undefined)

// --- incidental self-awareness --------------------------------------------
check('sudo inside a real message is noticed',
  detectEgg('run sudo apt install the thing')?.id === 'sudo')
check('rm -rf gets the panic guard',
  detectEgg('should I just rm -rf node_modules and start over')?.id === 'rm-rf')
check('the panic guard admits it cannot stop you',
  detectEgg('rm -rf ./build please')?.line.includes('cannot actually stop you') === true)
check('the panic guard is incidental, not a whole-message egg',
  detectEgg('rm -rf ./build please')?.incidental === true)
check('a bare rm with no target is not a panic',
  detectEgg('rm') === undefined)
check('good clippy makes him blush',
  detectEgg('that was great, good clippy')?.effect === 'blush')
check('shut up buys a timed mute',
  (detectEgg('please shut up for a moment')?.muteMs ?? 0) > 0)
check('an ordinary sentence triggers nothing',
  detectEgg('refactor the runtime so the timers are injectable') === undefined)

// --- encores: the incidental triggers notice they are repeating ------------
const sudo = detectEgg('run sudo apt install the thing')!
check('the first sudo gets the opening line', eggLine(sudo, 0) === sudo.line)
check('the second sudo says something else', eggLine(sudo, 1) !== sudo.line)
check('the third sudo says something else again',
  eggLine(sudo, 2) !== eggLine(sudo, 1) && eggLine(sudo, 2) !== sudo.line)
check('past the last encore he stays on it',
  eggLine(sudo, 9) === eggLine(sudo, 2))
check('every incidental trigger has encores',
  ['run sudo apt install the thing', 'rm -rf ./build please', 'that was great, good clippy', 'please shut up for a moment']
    .every(message => (detectEgg(message)?.encores?.length ?? 0) >= 2))
check('a magic word is identical every time — that is the point',
  eggLine(detectEgg('xyzzy')!, 0) === eggLine(detectEgg('xyzzy')!, 5))

// --- keyboard mash ---------------------------------------------------------
check('ten keys in a second is a mash', isKeyboardMash(12, 800))
check('ten keys in five seconds is typing', !isKeyboardMash(12, 5_000))
check('three keys in a second is not a mash', !isKeyboardMash(3, 400))

// --- brush-offs ------------------------------------------------------------
check('"Not now" is a brush-off', isBrushOff('Not now'))
check('"Maybe later" is a brush-off', isBrushOff('Maybe later'))
check('a flat no is a decision, not a brush-off', !isBrushOff('No thanks'))
check('three brush-offs earn a strike', STRIKE_THRESHOLD === 3)

const failed = results.filter(r => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
process.exit(failed.length === 0 ? 0 : 1)
