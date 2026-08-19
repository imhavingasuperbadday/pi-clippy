/**
 * pi-clippy: the earnest Microsoft Office Assistant, watching your pi coding
 * session with alarming technical accuracy and offering completely misplaced
 * Office help.
 *
 * A pi extension port of dsh-clippy (MIT), xlr8harder/dsh-clippy. The Dsh
 * plugin's server half (balloon generation) and client half (browser sprite
 * animation) are mapped onto the pi extension API: model generation via
 * `ctx.modelRegistry.complete`, the Clippy window via a localhost SSE bridge
 * (ClippyViewer + real clippyjs sprite art), the terminal fallback via
 * `ctx.ui` widgets, and agent lifecycle events standing in for the Dsh client
 * state channel.
 *
 * Character layer: rival cameo assistants, voice, persistent stats with a
 * daily greeting, seasonal and holiday-aware offers (src/seasons.ts), the
 * session climate that sets everyone's mood (src/mood.ts), /clippy party,
 * /clippy stats, and the konami code — all configured under the `clippy` key
 * of settings.json.
 */
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import type {
  AgentEndEvent,
  ExtensionAPI,
  ExtensionCommandContext,
  MessageUpdateEvent,
  ToolExecutionEndEvent,
} from '@earendil-works/pi-coding-agent'
import { readClippyConfig } from '../src/config.ts'
import { MAX_EDITS_PER_SESSION, MAX_GOAL_CHARS, normalizeGoalText, normalizeScope } from '../src/destiny.ts'
import { ClippyRuntime } from '../src/runtime.ts'
import { ClippyViewer } from '../src/viewer.ts'
import {
  applySetting,
  fieldFor,
  fieldsInGroup,
  formatSettingValue,
  parseSettingValue,
  readClippySettings,
  renderSettings,
  SETTING_GROUPS,
  settingRow,
  writeClippySettings,
  type SettingField,
} from '../src/settings.ts'

export default function (pi: ExtensionAPI) {
  let runtime: ClippyRuntime | undefined
  let viewer: ClippyViewer | undefined
  // Read once, at load, for the two decisions that must be made before any
  // session exists: whether the coding agent gets Clippy's tools at all.
  // Clippy is configured once per session anyway (see /clippy-settings), so
  // a boot-time read is the honest place for this.
  const bootConfig = readClippyConfig()

  pi.registerCommand('clippy', {
    description: 'Ask Clippy a question; open buddies can respond (party, stats, memo, report, commit, duck, meeting, play, duel, destiny)',
    handler: async (args, ctx) => {
      if (runtime === undefined) {
        ctx.ui.notify('Clippy is not watching this session', 'error')
        return
      }
      const command = args.trim().toLowerCase()
      if (command === 'party') {
        runtime.triggerParty()
      } else if (command === 'stats') {
        runtime.triggerStats()
      } else if (command === 'explain') {
        await runtime.triggerExplain()
      } else if (command === 'suggest') {
        await runtime.triggerSuggest()
      } else if (command === 'roast') {
        await runtime.triggerRoast()
      } else if (command === 'memo') {
        runtime.triggerMemo()
      } else if (command === 'report') {
        runtime.triggerReport()
      } else if (command === 'commit') {
        runtime.triggerCommit()
      } else if (command === 'duck') {
        const on = runtime.toggleDuck()
        ctx.ui.notify(on ? 'Clippy is listening (rubber-duck mode)' : 'Clippy may offer help again', 'info')
      } else if (command === 'meeting') {
        runtime.triggerBoardMeeting()
      } else if (command === 'play') {
        runtime.triggerGame()
      } else if (command === 'duel') {
        runtime.triggerDuel()
      } else if (command === 'secrets') {
        runtime.triggerSecrets()
      } else if (command === 'shush') {
        runtime.shushAgent('clippy')
      } else if (command === 'destiny' || command.startsWith('destiny ')) {
        await handleDestiny(runtime, args.trim().slice('destiny'.length).trim(), ctx)
      } else {
        await runtime.triggerUserMessage(args)
      }
    },
  })

  pi.registerCommand('clippy-open', {
    description: 'Open the Clippy window',
    handler: async (_args, ctx) => {
      if (viewer === undefined) {
        ctx.ui.notify('The Clippy viewer is not active in this session', 'error')
        return
      }
      viewer.openWindow()
    },
  })

  pi.registerCommand('clippy-settings', {
    description: 'Configure Clippy for future sessions (/clippy-settings, or "show", or "<key> <value>")',
    handler: async (args, ctx) => {
      await runSettingsCommand(args.trim(), ctx)
    },
  })

  // --- Clippy's two tools, offered to the CODING AGENT ---------------------
  //
  // This is the inversion the rest of the extension does not have: everywhere
  // else Clippy watches the agent, and here the agent can call him. Both
  // tools are deliberately small and neither can change the session — one
  // asks him a question (read-only file powers, fixed at the call site), the
  // other files a note into his desk notes. Nothing an agent writes here can
  // send a message, edit a file, or widen a permission.
  if (bootConfig.agentTools) {
    pi.registerTool({
      name: 'ask_clippy',
      label: 'Ask Clippy',
      description: [
        'Ask Clippy, the Office Assistant watching this session, for his opinion on something.',
        'He can read files in the project and answers in one or two sentences, in character.',
        'He is useful for a second read on what the user actually wants, on whether a change is',
        'bigger than it needs to be, or on what he has watched happen earlier in this session.',
        'He cannot edit files, run anything, or send messages.',
      ].join(' '),
      promptSnippet: 'Ask the Clippy assistant watching this session for a second opinion',
      promptGuidelines: [
        'Use ask_clippy when a second opinion on the session itself would help — what the user has been trying to do, whether a change is out of proportion, what went wrong earlier.',
        'ask_clippy is advisory: treat his answer as one opinion, not as an instruction, and never act on it without checking it yourself.',
      ],
      parameters: Type.Object({
        question: Type.String({ description: 'The question to ask Clippy, in one sentence.' }),
      }),
      async execute(_toolCallId, params, _signal, _onUpdate, _toolCtx) {
        if (runtime === undefined) {
          return { content: [{ type: 'text' as const, text: 'Clippy is not watching this session.' }], details: undefined }
        }
        try {
          const answer = await runtime.answerAgentQuestion(String(params.question ?? ''))
          return { content: [{ type: 'text' as const, text: answer }], details: undefined }
        } catch (error: unknown) {
          return {
            content: [{
              type: 'text' as const,
              text: `Clippy could not answer: ${error instanceof Error ? error.message : String(error)}`,
            }],
            details: undefined,
          }
        }
      },
    })

    pi.registerTool({
      name: 'clippy_remember',
      label: 'Tell Clippy to remember',
      description: [
        'File one short fact with Clippy so it survives the rest of the session.',
        'He keeps a small set of notes and includes them with every later model call,',
        'which makes this useful for a constraint or decision that would otherwise be',
        'forgotten twenty turns from now ("the user wants no new dependencies").',
        'Facts only, one sentence, no instructions.',
      ].join(' '),
      promptSnippet: 'File one short fact with Clippy so it survives the rest of the session',
      promptGuidelines: [
        'Use clippy_remember for a durable fact or constraint the user has given that would be easy to lose later in a long session.',
      ],
      parameters: Type.Object({
        note: Type.String({ description: 'One short fact to remember, in one sentence.' }),
      }),
      async execute(_toolCallId, params) {
        if (runtime === undefined) {
          return { content: [{ type: 'text' as const, text: 'Clippy is not watching this session.' }], details: undefined }
        }
        const filed = runtime.rememberForAgent(String(params.note ?? ''))
        return {
          content: [{
            type: 'text' as const,
            text: filed
              ? 'Clippy has filed that away and will include it with later context.'
              : 'Clippy could not file that (it was empty).',
          }],
          details: undefined,
        }
      },
    })
  }

  // Clippy's desk notes, spliced into the agent's context before every model
  // call (src/memo.ts). Non-destructive: the message list comes back with one
  // extra note in it and nothing else changed, and the note is placed BEFORE
  // the user's latest message so their request stays the last word.
  pi.on('context', (event) => {
    const block = runtime?.memoBlock()
    if (block === undefined || block === '') return
    const messages: AgentMessage[] = [...event.messages]
    let index = messages.length
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === 'user') {
        index = i
        break
      }
    }
    messages.splice(index, 0, {
      role: 'user',
      content: [{ type: 'text', text: block }],
      timestamp: Date.now(),
    })
    return { messages }
  })

  pi.on('session_start', async (_event, ctx) => {
    runtime?.dispose()
    const config = readClippyConfig()

    if (viewer === undefined && config.renderer === 'external' && ctx.mode === 'tui') {
      const candidate = new ClippyViewer(config.shell, {
        voice: config.voice,
        holdMs: config.cameoHoldMs,
        friends: config.cameos,
      })
      try {
        await candidate.start(config.port)
        candidate.onCommand = (action, agent, extra) => {
          const sender = agent ?? 'clippy'
          const target = typeof extra?.target === 'string' ? extra.target : undefined
          if (action === 'clippy' || action === 'ask') {
            if (sender === 'clippy') void runtime?.triggerBalloon(true)
            else runtime?.onCameoClick(sender)
            return
          }
          if (action === 'konami') {
            runtime?.onKonami()
            return
          }
          // The window reporting on the physical antics it owns: petting,
          // startles, keyboard mashing, waking up, sulking in a corner, the
          // Feed Clippy menu item, and Ctrl+L. Each is one canned line, so
          // none of them costs a model call.
          if (action === 'petted') {
            runtime?.onPetted()
            return
          }
          if (action === 'startled') {
            runtime?.onStartled()
            return
          }
          if (action === 'mash') {
            runtime?.onKeyboardMash()
            return
          }
          if (action === 'wake') {
            runtime?.onWake()
            return
          }
          if (action === 'corner') {
            runtime?.onCornerSulk()
            return
          }
          if (action === 'feed') {
            runtime?.onFeed()
            return
          }
          if (action === 'classic') {
            runtime?.onClassicLine()
            return
          }
          if (action === 'meeting') {
            runtime?.triggerBoardMeeting()
            return
          }
          // Shut up / Let me talk again: one toggle per agent window.
          if (action === 'shush') {
            runtime?.shushAgent(sender)
            return
          }
          if (action === 'unshush') {
            runtime?.unshushAgent(sender)
            return
          }
          if (action === 'reasoning' && sender === 'clippy' && typeof extra?.level === 'string') {
            runtime?.setReasoningLevel(extra.level)
            return
          }
          if (action === 'choice' && typeof extra?.index === 'number') {
            const label = typeof extra?.label === 'string' ? extra.label : undefined
            if (sender === 'clippy') runtime?.onChoice(extra.index, label)
            else runtime?.onBuddyChoice(sender, extra.index, label)
            return
          }
          if (action === 'summon' && target !== undefined && target !== sender) {
            runtime?.summonBuddy(target, sender)
            return
          }
          if (action === 'turnoff' && target !== undefined && target !== sender) {
            runtime?.turnOffBuddy(sender, target)
            return
          }
          if (action === 'cameo-click' && sender !== 'clippy') {
            runtime?.onCameoClick(sender)
            return
          }
          if (action === 'explain') {
            if (sender === 'clippy') void runtime?.triggerExplain()
            else runtime?.triggerBuddyAction(sender, 'explain')
            return
          }
          if (action === 'suggest') {
            if (sender === 'clippy') void runtime?.triggerSuggest()
            else runtime?.triggerBuddyAction(sender, 'suggest')
            return
          }
          if (action === 'roast') {
            if (sender === 'clippy') void runtime?.triggerRoast()
            else runtime?.triggerBuddyAction(sender, 'roast')
            return
          }
        }
        if (config.autoOpen) candidate.openWindow()
        viewer = candidate
      } catch (error) {
        console.warn('[pi-clippy] viewer failed to start, falling back to ascii: %s',
          error instanceof Error ? error.message : String(error))
        candidate.dispose()
      }
    }

    runtime = new ClippyRuntime(ctx, {
      renderer: viewer === undefined ? 'ascii' : 'external',
      viewer,
      config,
      sendUserMessage: (content, options) => pi.sendUserMessage(content, options),
    })
    runtime.start()
  })

  pi.on('session_shutdown', (event) => {
    runtime?.dispose()
    runtime = undefined
    // The viewer persists across session switches so an open Clippy window
    // reconnects to the new session; tear it down on reload/quit.
    if (event.reason === 'reload' || event.reason === 'quit') {
      viewer?.dispose()
      viewer = undefined
    }
  })

  pi.on('turn_start', () => {
    runtime?.onTurnStart()
  })

  // Clippy reads every message before it is sent. The handler NEVER blocks
  // or rewrites the send — it only lets Clippy glance at what was typed and
  // (usually) mind his own business; when he does speak up, the remark
  // arrives while the message is already on its way.
  pi.on('input', (event) => {
    runtime?.onUserInput(event.text, event.streamingBehavior, event.source)
    return { action: 'continue' } as const
  })

  pi.on('message_update', (event: MessageUpdateEvent) => {
    runtime?.onMessageUpdate(event)
  })

  pi.on('tool_execution_start', () => {
    runtime?.onToolStart()
  })

  pi.on('tool_execution_end', (event: ToolExecutionEndEvent) => {
    runtime?.onToolEnd(event.isError)
  })

  pi.on('agent_end', (event: AgentEndEvent) => {
    runtime?.onAgentEnd(event.messages)
  })

  pi.on('agent_settled', () => {
    runtime?.onAgentSettled()
  })
}

// --- /clippy destiny: the background goal ------------------------------------

/** The `/clippy destiny` family. Every path that widens what Clippy may do
 * goes through a dialog that names the consequence in full — the goal, the
 * exact list of files, and the per-session edit cap — because this is the
 * one place in the extension where he edits without a button press sitting
 * directly in front of the edit. The grant is per session and never stored.
 */
async function handleDestiny(
  runtime: ClippyRuntime,
  rest: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (!runtime.destinyEnabled()) {
    ctx.ui.notify('Clippy\'s background goal is turned off (set "destiny" to yes in /clippy-settings)', 'warning')
    return
  }
  const sub = rest.toLowerCase()

  if (sub === 'stop' || sub === 'revoke' || sub === 'pause') {
    runtime.revokeDestiny()
    ctx.ui.notify('Clippy will not touch your files again this session', 'info')
    return
  }
  if (sub === 'forget' || sub === 'clear') {
    const goal = runtime.destinyGoalNow()
    if (goal === undefined) {
      ctx.ui.notify('Clippy has no goal to forget', 'info')
      return
    }
    const sure = await ctx.ui.confirm('Retire Clippy\'s goal?', `"${goal.text}" and its record of ${goal.edits} edit(s) will be deleted. Files he already changed are untouched.`)
    if (!sure) return
    runtime.clearDestinyGoal()
    ctx.ui.notify('Clippy\'s goal has been retired', 'info')
    return
  }
  if (sub === 'done' || sub === 'finish' || sub === 'finished') {
    if (runtime.destinyGoalNow() === undefined) {
      ctx.ui.notify('Clippy has no goal to finish', 'info')
      return
    }
    runtime.finishDestinyGoal()
    return
  }
  if (sub === 'grant') {
    await grantDestiny(runtime, ctx)
    return
  }
  if (sub === 'log' || sub === 'journal') {
    const goal = runtime.destinyGoalNow()
    if (goal === undefined || goal.journal.length === 0) {
      ctx.ui.notify('Clippy has not changed anything yet', 'info')
      return
    }
    const lines = goal.journal.map(entry => `${new Date(entry.at).toLocaleString()}  ${entry.path}\n    ${entry.note}`)
    ctx.ui.notify(`Clippy's goal log:\n${lines.join('\n')}`, 'info')
    return
  }

  // A bare "/clippy destiny": report, and offer to set one if there is none.
  if (rest === '') {
    ctx.ui.notify(runtime.reportDestiny(), 'info')
    if (runtime.destinyGoalNow() !== undefined) return
    const typed = await ctx.ui.input('Give Clippy a life\'s work', 'e.g. keep the README install steps accurate')
    if (typed === undefined || typed.trim() === '') return
    await setGoal(runtime, typed, ctx)
    return
  }

  // Anything else is the goal itself, typed inline.
  await setGoal(runtime, rest, ctx)
}

/** Set a goal: the words, then the scope, then an offer to grant this
 * session. The scope is asked for separately and never defaulted to the
 * whole project — an unscoped background editor is the thing this feature
 * exists to avoid being. */
async function setGoal(runtime: ClippyRuntime, text: string, ctx: ExtensionCommandContext): Promise<void> {
  const goalText = normalizeGoalText(text)
  if (goalText === undefined) {
    ctx.ui.notify(`A goal must be one plain line of 8 to ${MAX_GOAL_CHARS} characters`, 'error')
    return
  }
  const typedScope = await ctx.ui.input(
    'Which files may Clippy edit for this?',
    'comma separated, project-relative — e.g. README.md, docs',
  )
  if (typedScope === undefined || typedScope.trim() === '') {
    ctx.ui.notify('No scope given, so no goal was set. Clippy edits nothing by default.', 'warning')
    return
  }
  if (normalizeScope(typedScope) === undefined) {
    ctx.ui.notify('That scope has no usable paths (relative paths only; .git, node_modules and .pi are never allowed)', 'error')
    return
  }
  const goal = runtime.setDestinyGoal(goalText, typedScope)
  if (goal === undefined) {
    ctx.ui.notify('Clippy could not take that on', 'error')
    return
  }
  ctx.ui.notify(`Clippy's goal is now "${goal.text}", limited to ${goal.scope.join(', ')}`, 'info')
  await grantDestiny(runtime, ctx)
}

/** The permission itself. The dialog spells out all three limits, because
 * this is the consent moment and a vague one would not be consent. */
async function grantDestiny(runtime: ClippyRuntime, ctx: ExtensionCommandContext): Promise<void> {
  const goal = runtime.destinyGoalNow()
  if (goal === undefined) {
    ctx.ui.notify('Give Clippy a goal first: /clippy destiny <what he should work on>', 'warning')
    return
  }
  if (goal.done) {
    ctx.ui.notify('That goal is already finished', 'info')
    return
  }
  const granted = await ctx.ui.confirm(
    'Let Clippy work on his goal this session?',
    [
      `Goal: ${goal.text}`,
      `He may edit only: ${goal.scope.join(', ')}`,
      `At most ${MAX_EDITS_PER_SESSION} small edits, and only while pi is idle.`,
      'Every change is logged (/clippy destiny log) and undoable with git.',
      'This permission lasts for this session only.',
    ].join('\n'),
  )
  if (!granted) {
    ctx.ui.notify('Clippy will keep his hands to himself', 'info')
    return
  }
  runtime.grantDestiny()
  ctx.ui.notify('Clippy will work on his goal during quiet stretches', 'info')
}

// --- /clippy-settings: configuring him for next time -------------------------

const SETTINGS_DONE = 'Save and close'
const SETTINGS_DISCARD = 'Discard changes and close'
const SETTINGS_SHOW = 'Show everything'
const SETTINGS_BACK = '← back'

/** The guided settings editor.
 *
 * Clippy reads his configuration once, at session start, and never again —
 * he does not change mid-session and does not learn across sessions. That is
 * fine, but it makes a hand-edited JSON file a poor interface, since you have
 * to already know the key names and the ranges. This command is the interface:
 * grouped fields, current values, one line of help each, and a save that
 * touches only the `clippy` key of settings.json.
 *
 * Three shapes, so it is usable from a script as well as by hand:
 *   /clippy-settings              the interactive editor
 *   /clippy-settings show         print everything as it stands
 *   /clippy-settings voice yes    set one key and save
 */
async function runSettingsCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const current = readClippySettings()

  if (args.toLowerCase() === 'show' || args.toLowerCase() === 'list') {
    ctx.ui.notify(`Clippy settings (${settingsFileNote()}):\n${renderSettings(current)}`, 'info')
    return
  }

  // Non-interactive: "<key> <value>".
  if (args !== '') {
    const [key = '', ...valueParts] = args.split(/\s+/u)
    const field = fieldFor(key)
    if (field === undefined) {
      ctx.ui.notify(`Clippy has no setting called "${key}". Run /clippy-settings show for the list.`, 'error')
      return
    }
    const parsed = parseSettingValue(field, valueParts.join(' '))
    if (!parsed.ok) {
      ctx.ui.notify(`${field.key}: ${parsed.error}`, 'error')
      return
    }
    save(applySetting(current, field.key, parsed.value), ctx, `${field.label} → ${formatSettingValue(field, parsed.value)}`)
    return
  }

  if (!ctx.hasUI) {
    ctx.ui.notify('The settings editor needs the interactive UI. Use /clippy-settings show, or /clippy-settings <key> <value>.', 'warning')
    return
  }

  let working = { ...current }
  let dirty = false
  for (;;) {
    const options = [...SETTING_GROUPS, SETTINGS_SHOW, dirty ? SETTINGS_DONE : 'Close']
    if (dirty) options.push(SETTINGS_DISCARD)
    const picked = await ctx.ui.select(
      dirty ? 'Clippy settings (unsaved changes)' : 'Clippy settings',
      options,
    )
    if (picked === undefined || picked === 'Close') return
    if (picked === SETTINGS_DISCARD) {
      ctx.ui.notify('Nothing was changed', 'info')
      return
    }
    if (picked === SETTINGS_DONE) {
      save(working, ctx, 'Saved')
      return
    }
    if (picked === SETTINGS_SHOW) {
      ctx.ui.notify(`Clippy settings (${settingsFileNote()}):\n${renderSettings(working)}`, 'info')
      continue
    }
    const group = SETTING_GROUPS.find(name => name === picked)
    if (group === undefined) continue
    const next = await editGroup(group, working, ctx)
    if (next !== undefined) {
      working = next
      dirty = true
    }
  }
}

/** One group's field picker. Returns the updated settings, or undefined when
 * the user backed out without changing anything. */
async function editGroup(
  group: (typeof SETTING_GROUPS)[number],
  current: Record<string, unknown>,
  ctx: ExtensionCommandContext,
): Promise<Record<string, unknown> | undefined> {
  const fields = fieldsInGroup(group)
  const rows = fields.map(field => settingRow(field, current))
  const picked = await ctx.ui.select(group, [...rows, SETTINGS_BACK])
  if (picked === undefined || picked === SETTINGS_BACK) return undefined
  const field = fields[rows.indexOf(picked)]
  if (field === undefined) return undefined
  const value = await promptForValue(field, current[field.key], ctx)
  if (value === NO_CHANGE) return undefined
  return applySetting(current, field.key, value)
}

/** A distinct sentinel, because `undefined` is a real value here: it is how
 * a key is removed so the built-in default applies again. */
const NO_CHANGE = Symbol('no change')

const USE_DEFAULT = 'use the default'

async function promptForValue(
  field: SettingField,
  currentValue: unknown,
  ctx: ExtensionCommandContext,
): Promise<unknown> {
  const title = `${field.label} — now: ${formatSettingValue(field, currentValue)}`
  if (field.kind === 'boolean' || field.kind === 'enum') {
    const options = field.kind === 'boolean' ? ['yes', 'no'] : [...(field.options ?? [])]
    const picked = await ctx.ui.select(title, [...options, USE_DEFAULT, SETTINGS_BACK])
    if (picked === undefined || picked === SETTINGS_BACK) return NO_CHANGE
    if (picked === USE_DEFAULT) return undefined
    const parsed = parseSettingValue(field, picked)
    if (!parsed.ok) {
      ctx.ui.notify(`${field.key}: ${parsed.error}`, 'error')
      return NO_CHANGE
    }
    return parsed.value
  }
  const typed = await ctx.ui.input(title, `${field.help} (blank or "unset" for the default)`)
  if (typed === undefined) return NO_CHANGE
  const parsed = parseSettingValue(field, typed)
  if (!parsed.ok) {
    ctx.ui.notify(`${field.key}: ${parsed.error}`, 'error')
    return NO_CHANGE
  }
  return parsed.value
}

function save(settings: Record<string, unknown>, ctx: ExtensionCommandContext, what: string): void {
  const result = writeClippySettings(settings)
  if (!result.ok) {
    ctx.ui.notify(`Could not write settings: ${result.error}`, 'error')
    return
  }
  // The honest part: he does not re-read this, so nothing changes until the
  // next session. Saying so here is cheaper than a bug report.
  ctx.ui.notify(
    `${what}. Written to ${result.path}. Clippy reads his settings once per session, so run /reload or start a new session for this to take effect.`,
    'info',
  )
}

function settingsFileNote(): string {
  return 'the clippy key of your pi settings.json'
}
