/** Bounded, model-facing evidence distilled from one live pi session.
 * Ported from dsh-clippy (MIT), xlr8harder/dsh-clippy, with the data source
 * swapped from Dsh session events to pi session entries.
 */
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { ImageContent, Message, TextContent, ThinkingContent, ToolCall } from '@earendil-works/pi-ai'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'

const MAX_MESSAGES = 14
const MAX_MESSAGE_CHARS = 2_400
const MAX_CONTEXT_CHARS = 22_000
const MAX_TOOLS = 12
const MAX_TOOL_ARGUMENT_CHARS = 1_200
const MAX_TOOL_RESULT_CHARS = 1_800
const MAX_ERRORS = 8
const MAX_ERROR_CHARS = 800
const ACTIVITY_GAP_MS = 30 * 60_000

export interface ClippyEvidenceMessage {
  readonly role: Message['role']
  readonly text: string
}

export interface ClippyToolEvidence {
  readonly name: string
  readonly arguments: string
  readonly outcome: 'running' | 'success' | 'error'
  readonly resultExcerpt?: string
}

export interface ClippyEvidence {
  readonly cwd?: string
  readonly activityMinutes: number
  readonly recentMessages: readonly ClippyEvidenceMessage[]
  readonly recentTools: readonly ClippyToolEvidence[]
  readonly recentErrors: readonly string[]
  readonly omittedEarlierContext: boolean
}

type ContentBlock = TextContent | ThinkingContent | ToolCall | ImageContent

function truncate(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1)}…`
}

function contentText(blocks: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        parts.push(block.text)
        break
      case 'toolCall':
        parts.push(`[tool call: ${block.name}] ${JSON.stringify(block.arguments ?? {})}`)
        break
      case 'image':
        parts.push('[image attachment]')
        break
      case 'thinking':
        // Private reasoning is deliberately absent from the Clippy projection.
        break
    }
  }
  return parts.join('\n')
}

function contentOf(message: Message): readonly ContentBlock[] {
  if (message.role === 'user' && typeof message.content === 'string') {
    return [{ type: 'text', text: message.content }]
  }
  return message.content as readonly ContentBlock[]
}

function isStandardMessage(message: AgentMessage): message is Message {
  return message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult'
}

export function messageEvidence(message: Message): ClippyEvidenceMessage | undefined {
  const text = truncate(contentText(contentOf(message)), MAX_MESSAGE_CHARS)
  return text === '' ? undefined : { role: message.role, text }
}

function recentMessageEvidence(messages: readonly Message[]): {
  messages: ClippyEvidenceMessage[]
  omitted: boolean
} {
  const selected: ClippyEvidenceMessage[] = []
  let chars = 0
  let omitted = false
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const source = messages[index]
    if (source === undefined) continue
    const projected = messageEvidence(source)
    if (projected === undefined) continue
    if (selected.length >= MAX_MESSAGES || chars + projected.text.length > MAX_CONTEXT_CHARS) {
      omitted = true
      break
    }
    selected.unshift(projected)
    chars += projected.text.length
  }
  return { messages: selected, omitted }
}

function eventText(blocks: readonly ContentBlock[]): string {
  return truncate(contentText(blocks), MAX_TOOL_RESULT_CHARS)
}

/** Pair assistant tool calls with their toolResult messages in entry order. */
function recentToolEvidence(entries: readonly SessionEntry[]): ClippyToolEvidence[] {
  const tools: Array<ClippyToolEvidence & { callId: string }> = []
  const byCall = new Map<string, number>()
  for (const entry of entries) {
    if (entry.type !== 'message') continue
    const message = entry.message
    if (!isStandardMessage(message)) continue
    if (message.role === 'assistant') {
      for (const block of message.content) {
        if (block.type !== 'toolCall') continue
        const tool = {
          callId: block.id,
          name: block.name,
          arguments: truncate(JSON.stringify(block.arguments ?? {}), MAX_TOOL_ARGUMENT_CHARS),
          outcome: 'running' as const,
        }
        byCall.set(tool.callId, tools.length)
        tools.push(tool)
      }
      continue
    }
    if (message.role !== 'toolResult') continue
    const index = byCall.get(message.toolCallId)
    if (index === undefined) continue
    const previous = tools[index]
    if (previous === undefined) continue
    const excerpt = eventText(message.content)
    tools[index] = {
      ...previous,
      outcome: message.isError ? 'error' : 'success',
      ...(excerpt === '' ? {} : { resultExcerpt: excerpt }),
    }
  }
  return tools.slice(-MAX_TOOLS).map(({ callId: _callId, ...tool }) => tool)
}

function recentErrors(entries: readonly SessionEntry[]): string[] {
  const errors: string[] = []
  for (const entry of entries) {
    if (entry.type !== 'message') continue
    const message = entry.message
    if (!isStandardMessage(message)) continue
    if (message.role === 'toolResult' && message.isError) {
      errors.push(truncate(`${message.toolName}: ${eventText(message.content)}`, MAX_ERROR_CHARS))
    } else if (message.role === 'assistant' && (message.stopReason === 'error' || message.errorMessage !== undefined)) {
      errors.push(truncate(message.errorMessage ?? `model error (${message.stopReason})`, MAX_ERROR_CHARS))
    }
  }
  return errors.filter(Boolean).slice(-MAX_ERRORS)
}

function entryTime(entry: SessionEntry): number {
  if (entry.type === 'message') {
    const timestamp = entry.message.timestamp
    if (typeof timestamp === 'number') return timestamp
  }
  const parsed = Date.parse(entry.timestamp)
  return Number.isFinite(parsed) ? parsed : 0
}

export function continuousActivityMinutes(entries: readonly SessionEntry[], now = Date.now()): number {
  if (entries.length === 0) return 0
  let start = entryTime(entries[entries.length - 1]!)
  for (let index = entries.length - 2; index >= 0; index -= 1) {
    const event = entries[index]
    const next = entries[index + 1]
    if (event === undefined || next === undefined || entryTime(next) - entryTime(event) > ACTIVITY_GAP_MS) break
    start = entryTime(event)
  }
  return Math.max(0, Math.round((now - start) / 60_000))
}

/**
 * Project the session into one bounded evidence object. Semantic history
 * comes from the caller-provided context entries (compaction-respecting);
 * the entry list contributes operational facts (tools, errors, timing).
 */
export function buildClippyEvidence(
  entries: readonly SessionEntry[],
  cwd: string | undefined,
  now = Date.now(),
): ClippyEvidence {
  const messages: Message[] = []
  for (const entry of entries) {
    if (entry.type === 'message' && isStandardMessage(entry.message)) messages.push(entry.message)
  }
  const selected = recentMessageEvidence(messages)
  return {
    ...(cwd === undefined ? {} : { cwd }),
    activityMinutes: continuousActivityMinutes(entries, now),
    recentMessages: selected.messages,
    recentTools: recentToolEvidence(entries),
    recentErrors: recentErrors(entries),
    omittedEarlierContext: selected.omitted,
  }
}
