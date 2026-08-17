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
import type {
  AgentEndEvent,
  ExtensionAPI,
  MessageUpdateEvent,
  ToolExecutionEndEvent,
} from '@earendil-works/pi-coding-agent'
import { readClippyConfig } from '../src/config.ts'
import { ClippyRuntime } from '../src/runtime.ts'
import { ClippyViewer } from '../src/viewer.ts'

export default function (pi: ExtensionAPI) {
  let runtime: ClippyRuntime | undefined
  let viewer: ClippyViewer | undefined

  pi.registerCommand('clippy', {
    description: 'Ask Clippy what it looks like you are doing (party and stats subcommands)',
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
      } else {
        await runtime.triggerBalloon(true)
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
