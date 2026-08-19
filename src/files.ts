/** Clippy's file powers: the ONLY thing he can touch, and the only tools the
 * model ever receives from this extension.
 *
 * - **read**: Clippy may read project files on his own, any time. A buddy
 *   may read only after Clippy has granted it permission (rare, and only
 *   after being convinced — see src/permission.ts and src/buddy.ts).
 * - **edit**: Clippy may edit files, but ONLY when the user pressed a
 *   button whose label authorized real work (the accept path). Buddies
 *   never edit, with or without permission.
 *
 * Every operation is confined to the project directory (cwd), capped in
 * size, text-only, and refuses obvious secret material. There is no shell,
 * no command execution, and no other tool — reads and edits are the whole
 * toolbox, by design.
 */
import { existsSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import { Type, type Tool } from '@earendil-works/pi-ai'
import { withinScope } from './destiny.ts'

export class ClippyFileError extends Error {}

/** A whole file must not exceed this to be read. */
const MAX_READ_FILE_BYTES = 256 * 1024
/** The excerpt handed to the model is capped so evidence stays bounded. */
const MAX_READ_EXCERPT_CHARS = 12_000
/** Default window when the model does not ask for a range. */
const DEFAULT_READ_LINES = 400
/** Files past this size are not edited (a paperclip has small hands). */
const MAX_EDIT_FILE_BYTES = 256 * 1024
/** The search/replace strings the model may use. */
const MAX_OLD_TEXT_CHARS = 8_000
const MAX_NEW_TEXT_CHARS = 32_000

/** File paths that are never read or edited, even inside the project.
 * Clippy may be dim, but he knows better than to recite secrets. */
const SECRET_PATH = /(?:^|[\\/])(?:\.env(?:\.[\w-]+)?$|\.(?:pem|key|p12|pfx|crt|der)$|[\\/](?:\.ssh|\.aws|\.gnupg)[\\/])/iu
const SECRET_NAME = /(?:secret|credential|password|api[_-]?key|token)/iu

/** Which file powers a model call may use. Passed around as one value so a
 * caller cannot accidentally hand out edits alongside reads. */
export interface FilePowers {
  readonly read: boolean
  readonly edit: boolean
  /** When present, edits are additionally confined to these project-relative
   * paths — the second, independent gate on Clippy's background goal work
   * (src/destiny.ts). Reads are unaffected: reading is a power he already
   * has everywhere, and a goal he cannot read around is a goal he cannot do.
   * Absent means "no extra narrowing", never "anything goes". */
  readonly editScope?: readonly string[]
}

export const NO_FILE_POWERS: FilePowers = { read: false, edit: false }
export const READ_ONLY: FilePowers = { read: true, edit: false }
export const READ_WRITE: FilePowers = { read: true, edit: true }

/** Resolve a model-supplied path against the project root and verify it is
 * really inside the root. Throws ClippyFileError otherwise. The returned
 * path is absolute and normalized. */
export function resolveProjectPath(root: string, raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new ClippyFileError('the path must be a non-empty string')
  }
  const candidate = raw.trim().replace(/^["']+|["']+$/gu, '')
  if (/[\0\r\n]/u.test(candidate)) throw new ClippyFileError('that path is not a path')
  const absolute = isAbsolute(candidate) ? normalize(candidate) : resolve(root, candidate)
  const rootReal = realpathSync(root)
  const rel = relative(rootReal, absolute)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new ClippyFileError(`that path is outside your project (${rootReal})`)
  }
  return absolute
}

function ensureNotSecret(path: string): void {
  if (SECRET_PATH.test(path)) throw new ClippyFileError('that file is off-limits, even for a paperclip')
  const base = path.split(/[\\/]/u).at(-1) ?? ''
  if (SECRET_NAME.test(base)) throw new ClippyFileError('that file is off-limits, even for a paperclip')
}

function readText(path: string): string {
  const stats = statSync(path)
  if (!stats.isFile()) throw new ClippyFileError('that path is not a file')
  if (stats.size > MAX_READ_FILE_BYTES) throw new ClippyFileError('that file is too big for a paperclip to lift')
  const content = readFileSync(path, 'utf8')
  if (content.includes('\0')) throw new ClippyFileError('that file is not plain text')
  return content
}

export interface ReadOutcome {
  readonly path: string
  /** Lines 1-based, clamped to the file. */
  readonly firstLine: number
  readonly lastLine: number
  readonly totalLines: number
  readonly excerpt: string
  readonly truncated: boolean
}

/** Read a project file for Clippy: bounded, text-only, never secret. */
export function readProjectFile(
  root: string,
  raw: unknown,
  startLine?: unknown,
  lineCount?: unknown,
): ReadOutcome {
  const path = resolveProjectPath(root, raw)
  ensureNotSecret(path)
  if (!existsSync(path)) throw new ClippyFileError('that file does not exist')
  const content = readText(path)
  const rawLines = content.split(/\r?\n/u)
  // A trailing newline is not a line: "a\nb\n" is two lines, not three.
  const totalLines = rawLines.length > 1 && rawLines[rawLines.length - 1] === ''
    ? rawLines.length - 1
    : rawLines.length
  const lines = rawLines.slice(0, totalLines)
  const start = typeof startLine === 'number' && Number.isFinite(startLine)
    ? Math.min(Math.max(1, Math.floor(startLine)), Math.max(1, totalLines))
    : 1
  const count = typeof lineCount === 'number' && Number.isFinite(lineCount)
    ? Math.min(Math.max(1, Math.floor(lineCount)), DEFAULT_READ_LINES)
    : DEFAULT_READ_LINES
  const window = lines.slice(start - 1, start - 1 + count)
  let excerpt = window.join('\n')
  let truncated = start - 1 + count < totalLines
  if (excerpt.length > MAX_READ_EXCERPT_CHARS) {
    excerpt = `${excerpt.slice(0, MAX_READ_EXCERPT_CHARS - 40)}…`
    truncated = true
  }
  return {
    path,
    firstLine: start,
    lastLine: start - 1 + window.length,
    totalLines,
    excerpt,
    truncated,
  }
}

export interface EditOutcome {
  readonly path: string
  /** The edit created a new file rather than changing an existing one. */
  readonly created: boolean
}

/** Apply one exact-text edit inside the project. `oldText` must match
 * exactly ONCE in the file (a few lines of context make that reliable);
 * an empty `oldText` with new text creates a fresh file.
 *
 * `editScope`, when given, narrows the edit further to a short list of
 * project-relative paths. Containment in the project is checked first and
 * always; the scope is an extra fence on top of it, never a replacement. */
export function editProjectFile(
  root: string,
  raw: unknown,
  oldText: unknown,
  newText: unknown,
  editScope?: readonly string[],
): EditOutcome {
  const path = resolveProjectPath(root, raw)
  ensureNotSecret(path)
  if (editScope !== undefined && !withinScope(relative(realpathSync(root), path), editScope)) {
    throw new ClippyFileError(`that file is outside what I am allowed to work on (${editScope.join(', ')})`)
  }
  const search = typeof oldText === 'string' ? oldText : ''
  const replacement = typeof newText === 'string' ? newText : ''
  if (search.length > MAX_OLD_TEXT_CHARS) throw new ClippyFileError('the text to replace is too long')
  if (replacement.length > MAX_NEW_TEXT_CHARS) throw new ClippyFileError('the replacement is too long')

  const exists = existsSync(path)
  if (search === '' && replacement === '') {
    throw new ClippyFileError('an edit needs something to replace or something to write')
  }
  if (search === '') {
    if (exists) throw new ClippyFileError('that file already exists; give me the exact text to replace')
    const parent = dirname(path)
    if (!existsSync(parent)) throw new ClippyFileError('the folder for that new file does not exist')
    writeFileSync(path, replacement, 'utf8')
    return { path, created: true }
  }
  if (!exists) throw new ClippyFileError('that file does not exist, so there is nothing to replace')
  const stats = statSync(path)
  if (!stats.isFile()) throw new ClippyFileError('that path is not a file')
  if (stats.size > MAX_EDIT_FILE_BYTES) throw new ClippyFileError('that file is too big for a paperclip to edit')
  const content = readFileSync(path, 'utf8')
  if (content.includes('\0')) throw new ClippyFileError('that file is not plain text')
  const first = content.indexOf(search)
  if (first < 0) throw new ClippyFileError('the text to replace was not found exactly — read the file first and copy it exactly')
  if (content.indexOf(search, first + search.length) >= 0) {
    throw new ClippyFileError('the text to replace matches more than once — include a little more surrounding context')
  }
  writeFileSync(path, content.slice(0, first) + replacement + content.slice(first + search.length), 'utf8')
  return { path, created: false }
}

/** The tools the model is offered, exactly matching the powers granted. */
export function fileTools(powers: FilePowers): Tool[] {
  const tools: Tool[] = []
  if (powers.read) tools.push(READ_FILE_TOOL)
  if (powers.edit) tools.push(EDIT_FILE_TOOL)
  return tools
}

export const READ_FILE_TOOL: Tool = {
  name: 'read_file',
  description: [
    'Read a text file inside the user\'s project and return an excerpt.',
    'Use it to ground your line in what the project actually contains.',
    'path must be relative to the project root (or an absolute path inside it).',
    'startLine and lineCount are optional 1-based numbers for a window of lines.',
  ].join(' '),
  parameters: Type.Object({
    path: Type.String(),
    startLine: Type.Optional(Type.Number()),
    lineCount: Type.Optional(Type.Number()),
  }),
}

export const EDIT_FILE_TOOL: Tool = {
  name: 'edit_file',
  description: [
    'Make ONE exact edit to a file inside the user\'s project.',
    'oldText must match the file exactly once — include a few lines of context.',
    'newText replaces it. To create a new file, leave oldText empty and put the',
    'whole file in newText. You may only edit files; you have no other powers.',
  ].join(' '),
  parameters: Type.Object({
    path: Type.String(),
    oldText: Type.String(),
    newText: Type.String(),
  }),
}

export interface FileActionRecord {
  readonly kind: 'read' | 'edit'
  readonly path: string
  readonly detail: string
}

export interface ToolOutcome {
  readonly ok: boolean
  readonly text: string
  readonly action?: FileActionRecord
}

/** Execute one tool call from the model. Only the two file tools exist;
 * anything else fails loudly so the model learns the boundaries. This is
 * the single choke point every file operation passes through. */
export function executeFileTool(
  root: string,
  name: string,
  args: Record<string, unknown>,
  editScope?: readonly string[],
): ToolOutcome {
  try {
    if (name === 'read_file') {
      const outcome = readProjectFile(root, args.path, args.startLine, args.lineCount)
      const range = `lines ${outcome.firstLine}-${outcome.lastLine} of ${outcome.totalLines}`
      return {
        ok: true,
        action: { kind: 'read', path: outcome.path, detail: range },
        text: `${outcome.path} (${range}${outcome.truncated ? ', truncated' : ''}):\n${outcome.excerpt}`,
      }
    }
    if (name === 'edit_file') {
      const outcome = editProjectFile(root, args.path, args.oldText, args.newText, editScope)
      return {
        ok: true,
        action: { kind: 'edit', path: outcome.path, detail: outcome.created ? 'created' : 'edited' },
        text: outcome.created
          ? `${outcome.path} was created with the new content.`
          : `${outcome.path} was edited: the old text was replaced with the new text.`,
      }
    }
    return { ok: false, text: `Clippy has no tool called ${name} — only read_file and edit_file exist.` }
  } catch (error) {
    return { ok: false, text: error instanceof ClippyFileError ? error.message : 'the file operation failed' }
  }
}
