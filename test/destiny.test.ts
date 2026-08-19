/** Unit test for the Clippy Goal (src/destiny.ts).
 *
 * The parts worth testing are the ones that decide what a background editor
 * is allowed to touch: goal validation, scope normalization, the containment
 * check, the per-session grant and budget, and the fact that a hand-edited
 * state file cannot widen any of it. The edit itself is src/files.ts's job
 * and is tested there. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const stateDir = mkdtempSync(join(tmpdir(), 'clippy-destiny-'))
process.env['PI_CLIPPY_STATS_DIR'] = stateDir

const {
  clearDestiny,
  destinyReport,
  destinyStatus,
  DestinySession,
  finishDestiny,
  loadDestiny,
  MAX_EDITS_PER_SESSION,
  normalizeGoalText,
  normalizeScope,
  normalizeScopeEntry,
  recordWork,
  setDestiny,
  withinScope,
  workedLine,
  WORK_COOLDOWN_MS,
} = await import('../src/destiny.ts')

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

const PROJECT = 'C:/projects/thing'

// --- the goal text ---------------------------------------------------------
check('a plain goal is accepted',
  normalizeGoalText('keep the README install steps accurate') === 'keep the README install steps accurate')
check('whitespace is flattened', normalizeGoalText('  keep   the readme  tidy ') === 'keep the readme tidy')
check('a goal that is too short is refused', normalizeGoalText('tidy') === undefined)
check('a goal that is too long is refused', normalizeGoalText('x'.repeat(400)) === undefined)
check('a goal with a code fence is refused', normalizeGoalText('do the thing ```rm -rf```') === undefined)
check('a non-string is refused', normalizeGoalText(undefined) === undefined)

// --- the scope: the whole safety story -------------------------------------
check('a relative folder is a scope entry', normalizeScopeEntry('src') === 'src')
check('a relative file is a scope entry', normalizeScopeEntry('README.md') === 'README.md')
check('a trailing slash is trimmed', normalizeScopeEntry('docs/') === 'docs')
check('backslashes are normalized', normalizeScopeEntry('docs\\guide') === 'docs/guide')
check('an absolute path is refused', normalizeScopeEntry('/etc/passwd') === undefined)
check('a windows absolute path is refused', normalizeScopeEntry('C:\\Windows') === undefined)
check('an escape is refused', normalizeScopeEntry('../secrets') === undefined)
check('a buried escape is refused', normalizeScopeEntry('src/../../etc') === undefined)
check('.git is never in scope', normalizeScopeEntry('.git') === undefined)
check('inside .git is never in scope', normalizeScopeEntry('.git/hooks') === undefined)
check('node_modules is never in scope', normalizeScopeEntry('node_modules') === undefined)
check('the whole project is not a scope', normalizeScopeEntry('.') === undefined)

check('a typed scope splits on commas and spaces',
  normalizeScope('src, README.md docs')?.join('|') === 'src|README.md|docs')
check('duplicates collapse', normalizeScope('src, src')?.length === 1)
check('a scope of only bad paths is no scope', normalizeScope('/etc, ../up, .git') === undefined)
check('an empty scope is no scope', normalizeScope('') === undefined)
check('the scope list is bounded', (normalizeScope('a b c d e f g h i j') ?? []).length <= 6)

// --- containment -----------------------------------------------------------
const scope = ['src', 'README.md']
check('a file in a scoped folder is in scope', withinScope('src/runtime.ts', scope))
check('a scoped file itself is in scope', withinScope('README.md', scope))
check('a deeper path in a scoped folder is in scope', withinScope('src/deep/er/thing.ts', scope))
check('a sibling folder is out of scope', withinScope('test/runtime.test.ts', scope) === false)
check('a prefix collision is not containment', withinScope('srcold/thing.ts', scope) === false)
check('an escape is out of scope', withinScope('src/../../etc/passwd', scope) === false)
check('backslash paths are still checked', withinScope('src\\runtime.ts', scope))
check('a leading ./ does not defeat the check', withinScope('./src/runtime.ts', scope))

// --- the per-session grant and budget --------------------------------------
const session = new DestinySession()
check('a session starts with no permission', !session.isGranted())
check('an ungranted session may not work', !session.mayWork(WORK_COOLDOWN_MS * 10))
session.grant()
check('a granted session may work', session.mayWork(WORK_COOLDOWN_MS * 10))
check('the full budget is available', session.remaining() === MAX_EDITS_PER_SESSION)
session.noteWorked(1_000)
check('the cooldown holds him off right after a round', !session.mayWork(1_500))
check('the cooldown lets go eventually', session.mayWork(1_000 + WORK_COOLDOWN_MS))
session.noteEdits(MAX_EDITS_PER_SESSION)
check('a spent budget stops the work', !session.mayWork(1_000 + WORK_COOLDOWN_MS * 5))
check('the budget cannot go negative', session.remaining() === 0)
session.revoke()
check('revoking takes the permission back', !session.isGranted())

// --- persistence -----------------------------------------------------------
const stored = setDestiny(PROJECT, 'keep the readme install steps accurate', 'README.md, docs')
check('a goal is stored', stored !== undefined && stored.text.startsWith('keep the readme'))
check('a stored goal comes back', loadDestiny(PROJECT)?.text === stored?.text)
check('a stored goal keeps its scope', loadDestiny(PROJECT)?.scope.join('|') === 'README.md|docs')
check('a goal starts with no edits', loadDestiny(PROJECT)?.edits === 0)
check('another project has its own goal', loadDestiny('C:/projects/other') === undefined)
check('an invalid goal is not stored', setDestiny(PROJECT, 'no', '/etc') === undefined)

const worked = recordWork(PROJECT, ['README.md'], 'I corrected a stale install step')
check('work is counted', worked?.edits === 1)
check('work is journaled', worked?.journal.length === 1 && worked.journal[0]?.path === 'README.md')
check('the journal records what he said he did',
  worked?.journal[0]?.note === 'I corrected a stale install step')

check('a goal can be finished', finishDestiny(PROJECT)?.done === true)
clearDestiny(PROJECT)
check('a retired goal is gone', loadDestiny(PROJECT) === undefined)

// A hand-edited state file must not be able to widen the scope: validation
// runs on the way IN, not only on the way out.
const smuggled = setDestiny(PROJECT, 'a perfectly ordinary goal to have', 'src')
check('the smuggling setup worked', smuggled !== undefined)
const { writeFileSync } = await import('node:fs')
writeFileSync(join(stateDir, 'clippy-destiny.json'), JSON.stringify({
  goals: {
    [PROJECT.toLowerCase()]: { ...smuggled, scope: ['/', '..', '.git'] },
  },
}), 'utf8')
check('a widened scope in the state file is rejected outright', loadDestiny(PROJECT) === undefined)

// --- the lines -------------------------------------------------------------
const fresh = new DestinySession()
check('no goal means no status line', destinyStatus(undefined, fresh) === undefined)
const goal = setDestiny(PROJECT, 'keep the changelog current for real', 'CHANGELOG.md')!
check('an ungranted goal says so in the status line',
  destinyStatus(goal, fresh) === 'clippy destiny: waiting for permission')
fresh.grant()
check('a granted goal counts the budget in the status line',
  destinyStatus(goal, fresh) === `clippy destiny: 0/${MAX_EDITS_PER_SESSION} edits this session`)
check('a finished goal says so', destinyStatus({ ...goal, done: true }, fresh) === 'clippy destiny: complete')

check('with no goal he asks for one', destinyReport(undefined, fresh).includes('/clippy destiny'))
check('the report names the goal and the scope',
  destinyReport(goal, fresh).includes('keep the changelog current')
  && destinyReport(goal, fresh).includes('CHANGELOG.md'))
check('an ungranted report says how to grant',
  destinyReport(goal, new DestinySession()).includes('/clippy destiny grant'))

check('a round that changed nothing says so', workedLine([], 'I read the changelog and left it alone').includes('changed nothing'))
check('a round that changed something names the file',
  workedLine(['CHANGELOG.md'], 'I added the missing entry').includes('CHANGELOG.md'))

rmSync(stateDir, { recursive: true, force: true })

const failed = results.filter(r => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
process.exit(failed.length === 0 ? 0 : 1)
