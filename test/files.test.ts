/** Clippy's file powers and the permission dance, in isolation:
 * containment, size/secret refusals, exact edits, the tool choke point,
 * and the request/grant line detection that lets a buddy earn read access. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  editProjectFile,
  executeFileTool,
  readProjectFile,
  resolveProjectPath,
} from '../src/files.ts'
import { buddyRequestsFileAccess, clippyGrantsFileAccess } from '../src/permission.ts'

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

function throws(fn: () => unknown, needle?: string): string | undefined {
  try {
    fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return needle === undefined || message.toLowerCase().includes(needle.toLowerCase()) ? message : `wrong error: ${message}`
  }
  return undefined
}

const root = mkdtempSync(join(tmpdir(), 'pi-clippy-files-'))
const project = join(root, 'project')
const outside = join(root, 'outside')
mkdirSync(project, { recursive: true })
mkdirSync(outside, { recursive: true })
writeFileSync(join(project, 'memo.txt'), 'line one\nline two\nline three\n')
writeFileSync(join(project, 'big.txt'), 'x'.repeat(300 * 1024))
writeFileSync(join(project, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02, 0x03]))
writeFileSync(join(project, '.env'), 'API_KEY=topsecret\n')
writeFileSync(join(outside, 'loot.txt'), 'outside the project\n')

// --- Path containment --------------------------------------------------------
check('a plain project path resolves inside', resolveProjectPath(project, 'memo.txt') === join(project, 'memo.txt'))
check('a .. escape is refused', throws(() => resolveProjectPath(project, '../outside/loot.txt'), 'outside') !== undefined)
check('an absolute escape is refused', throws(() => resolveProjectPath(project, join(outside, 'loot.txt')), 'outside') !== undefined)
check('a windows-style escape is refused', throws(() => resolveProjectPath(project, '..\\..\\windows'), 'outside') !== undefined)
check('a garbage path is refused', throws(() => resolveProjectPath(project, { nested: true })) !== undefined)

// --- Reads -------------------------------------------------------------------
const memo = readProjectFile(project, 'memo.txt')
check('read returns the whole file', memo.excerpt === 'line one\nline two\nline three' && memo.totalLines === 3, memo.excerpt)
const window = readProjectFile(project, 'memo.txt', 2, 1)
check('read honors startLine/lineCount', window.excerpt === 'line two' && window.firstLine === 2 && window.lastLine === 2)
check('read reports truncation for a window', readProjectFile(project, 'memo.txt', 1, 2).truncated === true)
check('an oversized file is refused', throws(() => readProjectFile(project, 'big.txt'), 'too big') !== undefined)
check('a binary file is refused', throws(() => readProjectFile(project, 'bin.dat'), 'plain text') !== undefined)
check('a missing file is refused', throws(() => readProjectFile(project, 'ghost.txt'), 'does not exist') !== undefined)
check('a .env is refused even in-project', throws(() => readProjectFile(project, '.env'), 'off-limits') !== undefined)

// --- Edits -------------------------------------------------------------------
check('edit creates a new file from empty oldText', editProjectFile(project, 'new.txt', '', 'hello').created === true)
check('the created file holds the content', readFileSync(join(project, 'new.txt'), 'utf8') === 'hello')
check('creating over an existing file is refused', throws(() => editProjectFile(project, 'new.txt', '', 'again'), 'already exists') !== undefined)
editProjectFile(project, 'memo.txt', 'line two', 'line two, revised')
check('edit replaces the exact match', readFileSync(join(project, 'memo.txt'), 'utf8').includes('line two, revised'))
check('a non-matching oldText is refused', throws(() => editProjectFile(project, 'memo.txt', 'not in the file', 'x'), 'not found') !== undefined)
writeFileSync(join(project, 'dup.txt'), 'same\nsame\n')
check('an ambiguous match is refused', throws(() => editProjectFile(project, 'dup.txt', 'same', 'other'), 'more than once') !== undefined)
check('an oversized file is not edited', throws(() => editProjectFile(project, 'big.txt', 'x', 'y'), 'too big') !== undefined)
check('a secret file is not edited', throws(() => editProjectFile(project, '.env', 'API_KEY', 'nope'), 'off-limits') !== undefined)

// --- The tool choke point ----------------------------------------------------
check('unknown tools fail loudly', executeFileTool(project, 'bash', { command: 'rm -rf /' }).ok === false)
const read = executeFileTool(project, 'read_file', { path: 'memo.txt' })
check('read_file succeeds through the choke point', read.ok === true && read.action?.kind === 'read', read.text.slice(0, 40))
const edit = executeFileTool(project, 'edit_file', { path: 'new.txt', oldText: 'hello', newText: 'goodbye' })
check('edit_file succeeds through the choke point', edit.ok === true && edit.action?.kind === 'edit')
const escape = executeFileTool(project, 'read_file', { path: '../outside/loot.txt' })
check('the choke point blocks escapes', escape.ok === false)

// --- The background goal's edit scope ----------------------------------------
//
// The second, independent fence: containment in the project is checked first
// and always, and the scope narrows it further for unsupervised goal work.

mkdirSync(join(root, 'inscope'), { recursive: true })
mkdirSync(join(root, 'outofscope'), { recursive: true })
writeFileSync(join(root, 'inscope', 'a.txt'), 'hello there\n', 'utf8')
writeFileSync(join(root, 'outofscope', 'b.txt'), 'hello there\n', 'utf8')
writeFileSync(join(root, 'inscopefile.txt'), 'hello there\n', 'utf8')

check('an in-scope edit goes through',
  editProjectFile(root, 'inscope/a.txt', 'hello', 'goodbye', ['inscope']).created === false)
check('an out-of-scope edit is refused',
  throws(() => editProjectFile(root, 'outofscope/b.txt', 'hello', 'goodbye', ['inscope']),
    'outside what I am allowed') !== undefined)
check('a scoped file itself may be edited',
  editProjectFile(root, 'inscopefile.txt', 'hello', 'goodbye', ['inscopefile.txt']).created === false)
check('a name that merely starts the same is out of scope',
  throws(() => editProjectFile(root, 'outofscope/b.txt', 'hello', 'goodbye', ['out']),
    'outside what I am allowed') !== undefined)
check('a scope cannot be escaped with ..',
  throws(() => editProjectFile(root, 'inscope/../outofscope/b.txt', 'hello', 'goodbye', ['inscope']),
    'outside what I am allowed') !== undefined)
check('no scope means no extra narrowing (the ordinary accepted-offer path)',
  editProjectFile(root, 'outofscope/b.txt', 'hello', 'goodbye').created === false)
const scopedTool = executeFileTool(root, 'edit_file',
  { path: 'outofscope/b.txt', oldText: 'goodbye', newText: 'hello' }, ['inscope'])
check('the tool choke point enforces the scope too',
  !scopedTool.ok && scopedTool.text.includes('outside what I am allowed'))
check('a refused scoped edit changes nothing on disk',
  readFileSync(join(root, 'outofscope', 'b.txt'), 'utf8').startsWith('goodbye'))

// --- The permission dance ----------------------------------------------------
check('a buddy asking to read files is detected',
  buddyRequestsFileAccess('Clippy, let me read the project files and I will show you the bug.')
  && buddyRequestsFileAccess('I would like to see the code, if you allow me.')
  && buddyRequestsFileAccess('I want to read the readme before I mock it.'))
check('ordinary banter is not a request',
  !buddyRequestsFileAccess('It looks like a paperclip is in charge. Would you like help with that?')
  && !buddyRequestsFileAccess('I read the room perfectly, unlike you.'))
check('a plain grant names the buddy and grants',
  clippyGrantsFileAccess('Fine. I grant Bonzi permission to read the files.', 'bonzi'))
check('a grant with no name grants nobody',
  !clippyGrantsFileAccess('You may see the files if you behave.', 'bonzi'))
check('a grant names the right buddy',
  clippyGrantsFileAccess('I allow Merlin access to the files.', 'merlin')
  && !clippyGrantsFileAccess('I allow Merlin access to the files.', 'bonzi'))
check('a stray "you may see" without permission language is not a grant',
  !clippyGrantsFileAccess('You may see I am very busy, Bonzi.', 'bonzi'))

rmSync(root, { recursive: true, force: true })

const failed = results.filter(r => r.startsWith('FAIL'))
console.log(results.join('\n'))
console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
process.exit(failed.length === 0 ? 0 : 1)
