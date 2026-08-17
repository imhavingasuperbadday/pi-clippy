/** Model-free, fact-only fallback lines from the newest structured tool event.
 * Ported verbatim from dsh-clippy (MIT), xlr8harder/dsh-clippy.
 */
import type { ClippyEvidence, ClippyToolEvidence } from './context.ts'

const TEST_NAME = /(?:^|[_-])(test|tests|pytest|vitest|jest)(?:$|[_-])/iu
const FILE_WRITE_NAME = /(apply|create|edit|patch|update|write)/iu

const SHELL_TOOL = /(?:^|[_-])(bash|command|exec|shell|terminal)(?:$|[_-])/iu

const WAITABLE_OPERATIONS = [
  { label: 'test run', pattern: /\b(?:cargo\s+test|go\s+test|pytest|vitest|jest|pnpm\s+(?:run\s+)?test|npm\s+(?:run\s+)?test|yarn\s+(?:run\s+)?test|bun\s+(?:run\s+)?test)\b/iu },
  { label: 'git push', pattern: /\bgit\s+push\b/iu },
  { label: 'repository sync', pattern: /\bgit\s+(?:fetch|pull)\b/iu },
  { label: 'deployment', pattern: /\b(?:deploy|wrangler\s+deploy|vercel\s+deploy)\b/iu },
  { label: 'publish', pattern: /\b(?:npm|pnpm|yarn)\s+publish\b|\bgh\s+release\s+create\b/iu },
  { label: 'build', pattern: /\b(?:cargo\s+build|go\s+build|pnpm\s+(?:run\s+)?build|npm\s+(?:run\s+)?build|yarn\s+(?:run\s+)?build|bun\s+(?:run\s+)?build|make(?:\s|$))\b/iu },
  { label: 'type check', pattern: /\b(?:typecheck|type-check|tsc)(?:\s|$)/iu },
  { label: 'lint check', pattern: /\b(?:eslint|ruff|golangci-lint|pnpm\s+(?:run\s+)?lint|npm\s+(?:run\s+)?lint|yarn\s+(?:run\s+)?lint)\b/iu },
  { label: 'dependency install', pattern: /\b(?:pnpm|npm|yarn|bun|pip|pipx)\s+(?:install|add)\b|\bcargo\s+install\b/iu },
  { label: 'package build', pattern: /\b(?:npm|pnpm|yarn)\s+pack\b/iu },
  { label: 'benchmark', pattern: /\b(?:benchmark|bench|hyperfine)\b/iu },
  { label: 'download', pattern: /\b(?:curl|wget|aria2c|huggingface-cli\s+download|hf\s+download)\b/iu },
  { label: 'upload', pattern: /\b(?:upload|rsync|rclone\s+(?:copy|sync)|aws\s+s3\s+cp)\b/iu },
] as const

const COMMAND_KEYS = ['cmd', 'command', 'script', 'shell', 'input'] as const
const COMMAND_LIST_KEYS = ['argv', 'args', 'commands'] as const

function commandFromValue(value: unknown, depth = 0): string | undefined {
  if (depth > 3 || value === null || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every(part => typeof part === 'string')) return value.join(' ')
    for (const nested of value) {
      const command = commandFromValue(nested, depth + 1)
      if (command !== undefined) return command
    }
    return undefined
  }
  const record = value as Record<string, unknown>
  for (const key of COMMAND_KEYS) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate
  }
  for (const key of COMMAND_LIST_KEYS) {
    const candidate = record[key]
    if (Array.isArray(candidate) && candidate.length > 0 && candidate.every(part => typeof part === 'string')) {
      return candidate.join(' ')
    }
  }
  for (const nested of Object.values(record)) {
    const command = commandFromValue(nested, depth + 1)
    if (command !== undefined) return command
  }
  return undefined
}

function shellCommand(tool: ClippyToolEvidence): string | undefined {
  if (!SHELL_TOOL.test(tool.name) && !/["'](?:cmd|command)["']\s*:/iu.test(tool.arguments)) return undefined
  try {
    const parsed = JSON.parse(tool.arguments) as unknown
    if (typeof parsed === 'string') return parsed
    const command = commandFromValue(parsed)
    if (command !== undefined) return command
  } catch {
    // Some tools expose the command as plain text rather than JSON.
  }
  return tool.arguments
}

function waitableLabel(tool: ClippyToolEvidence): string | undefined {
  const searchable = [tool.name, shellCommand(tool)].filter((value): value is string => value !== undefined).join(' ')
  return WAITABLE_OPERATIONS.find(operation => operation.pattern.test(searchable))?.label
}

function toolLabel(name: string): string {
  if (TEST_NAME.test(name) || /test/iu.test(name)) return 'test run'
  const cleaned = name
    .replace(/^(?:mcp__|tools?__)/iu, '')
    .replace(/[_-]+/gu, ' ')
    .replace(/[^\p{L}\p{N} .]+/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 36)
  return cleaned === '' ? 'tool' : cleaned
}

function updatedFilename(tool: ClippyToolEvidence): string | undefined {
  if (!FILE_WRITE_NAME.test(tool.name)) return undefined
  const candidate = tool.arguments.match(/(?:Update|Add) File:\s*([^\s*]+)/iu)?.[1]
    ?? tool.arguments.match(/(?:file_path|path)["']?\s*[:=]\s*["']([^"']+)/iu)?.[1]
    ?? tool.arguments.match(/(?:^|[\s"'=])((?:[\p{L}\p{N}_@.+-]+\/)*[\p{L}\p{N}_@.+-]+\.[\p{L}\p{N}]{1,12})(?=$|[\s"',:}\]])/iu)?.[1]
  if (candidate === undefined) return undefined
  const basename = candidate.replaceAll('\\', '/').split('/').at(-1)
    ?.replace(/[^\p{L}\p{N}_@.+-]/gu, '')
    .slice(0, 48)
  return basename === undefined || basename === '' ? undefined : basename
}

function testResult(tool: ClippyToolEvidence): string | undefined {
  if ((waitableLabel(tool) !== 'test run' && !/test/iu.test(tool.name)) || tool.resultExcerpt === undefined) return undefined
  const failed = tool.resultExcerpt.match(/\btests?\s+(\d+)\s+failed\b/iu)?.[1]
    ?? tool.resultExcerpt.match(/\b(\d+)\s+(?:tests?\s+)?failed\b/iu)?.[1]
  if (failed !== undefined) return `you ran some tests and ${failed} of them failed`
  const passed = tool.resultExcerpt.match(/\btests?\s+(\d+)\s+passed\b/iu)?.[1]
    ?? tool.resultExcerpt.match(/\b(\d+)\s+(?:tests?\s+)?passed\b/iu)?.[1]
  if (passed !== undefined) return `you ran some tests and they all passed`
  return undefined
}

/** The most recent test outcome the session produced, as a plain verdict.
 * Shares the parsing with `testResult` so the climate and the fallback line
 * never disagree about whether the suite passed. */
export function latestTestOutcome(evidence: ClippyEvidence): 'passing' | 'failing' | undefined {
  for (let index = evidence.recentTools.length - 1; index >= 0; index -= 1) {
    const tool = evidence.recentTools[index]
    if (tool === undefined) continue
    const verdict = testResult(tool)
    if (verdict === undefined) continue
    return verdict.includes('failed') ? 'failing' : 'passing'
  }
  return undefined
}

/** One neutral, factual phrase describing the newest structured operational
 * event — the same evidence `operationalFallbackStatement` speaks in Clippy's
 * voice, but stated plainly so it can ground a *model* prompt instead of only
 * standing in for one. Every character reads the session through this. */
export function latestOperationalBeat(evidence: ClippyEvidence): string | undefined {
  const latest = evidence.recentTools.at(-1)
  if (latest === undefined) return undefined

  const tests = testResult(latest)
  if (tests !== undefined) {
    return tests.includes('failed')
      ? 'the last test run reported failures'
      : 'the last test run passed'
  }

  const filename = latest.outcome === 'success' ? updatedFilename(latest) : undefined
  if (filename !== undefined) return `the file ${filename} was just updated`

  const label = waitableLabel(latest) ?? toolLabel(latest.name)
  if (latest.outcome === 'error') return `the last ${label} failed`
  if (latest.outcome === 'running') return `a ${label} is still running`
  return `a ${label} just finished successfully`
}

/** A model-free, fact-only line from the newest structured operational event,
 * said the way a paperclip would say it: plain and a little confused about
 * what the task actually was. */
export function operationalFallbackStatement(evidence: ClippyEvidence): string | undefined {
  const latest = evidence.recentTools.at(-1)
  if (latest === undefined) return undefined

  const tests = testResult(latest)
  if (tests !== undefined) return tests

  const filename = latest.outcome === 'success' ? updatedFilename(latest) : undefined
  if (filename !== undefined) return `you updated ${filename} and it is looking very neat`

  const label = waitableLabel(latest) ?? toolLabel(latest.name)
  if (latest.outcome === 'error') return `your ${label} did not work, but that is what erasers are for`
  if (latest.outcome === 'running') return `your ${label} is still going, which means it is important`
  return `you just finished a ${label} and I am sure it was excellent`
}
