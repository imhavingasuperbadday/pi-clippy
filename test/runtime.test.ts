/** Integration test: ClippyRuntime (external renderer) drives ClippyViewer
 * broadcasts over SSE, and /command actions route back into triggerBalloon. */
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClippyRuntime } from '../src/runtime.ts'
import { defaultClippyConfig } from '../src/config.ts'
import { ClippyViewer } from '../src/viewer.ts'
import { get } from 'node:http'

// Keep stats writes out of the real pi agent dir during tests.
process.env['PI_CLIPPY_STATS_DIR'] = join(tmpdir(), 'pi-clippy-test-stats')

const results: string[] = []
function check(name: string, ok: boolean, detail = ''): void {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`)
}

/** Collect SSE `clippy` events until `count` arrive (or a 10s watchdog
 * resolves with whatever arrived, so a regression cannot hang the suite). */
function collectSse(url: string, count: number): { ready: Promise<void>; done: Promise<string[]> } {
  const events: string[] = []
  let resolveReady: () => void = () => {}
  const ready = new Promise<void>(resolve => {
    resolveReady = resolve
  })
  const done = new Promise<string[]>((resolve, reject) => {
    let finished = false
    const finish = (): void => {
      if (finished) return
      finished = true
      req.destroy()
      resolve(events)
    }
    const watchdog = setTimeout(finish, 10_000)
    const req = get(url, res => {
      if (res.statusCode !== 200) {
        clearTimeout(watchdog)
        reject(new Error(`SSE status ${res.statusCode}`))
        return
      }
      resolveReady()
      let buffer = ''
      res.on('data', (c: Buffer) => {
        buffer += c.toString()
        for (;;) {
          const idx = buffer.indexOf('\n\n')
          if (idx < 0) break
          const message = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          const line = message.split('\n').find(l => l.startsWith('data: '))
          if (line !== undefined) {
            events.push(line.slice(6))
            if (events.length >= count) {
              clearTimeout(watchdog)
              finish()
              return
            }
          }
        }
      })
    })
    req.on('error', reject)
  })
  return { ready, done }
}

function fakeCtx(): ExtensionContext {
  return {
    hasUI: false,
    mode: 'tui',
    cwd: 'C:/fake',
    ui: {} as ExtensionContext['ui'],
    sessionManager: {
      getLeafId: () => 'leaf-1',
      buildContextEntries: () => [],
    } as unknown as ExtensionContext['sessionManager'],
    modelRegistry: {} as ExtensionContext['modelRegistry'],
    model: undefined,
    isIdle: () => true,
    signal: undefined,
  } as unknown as ExtensionContext
}

async function main(): Promise<void> {
  // Floor disabled so balloon broadcasts arrive immediately (other tests
  // exercise the one-message-at-a-time floor in isolation).
  const viewer = new ClippyViewer('auto', { floor: { enabled: false } })
  await viewer.start(0)
  const token = new URL(viewer.url).searchParams.get('t')
  const sse = collectSse(`${viewer.origin}/events?t=${token}`, 6)
  await sse.ready

  const ctx = fakeCtx()
  const runtime = new ClippyRuntime(ctx, { renderer: 'external', viewer })
  runtime.start()

  // Feed the same agent events the extension forwards.
  runtime.onTurnStart()
  runtime.onMessageUpdate({ message: { role: 'assistant', content: [{ type: 'thinking', thinking: '...' }] } } as never)
  runtime.onToolStart()
  runtime.onAgentEnd([{ role: 'toolResult', toolCallId: '1', toolName: 'bash', content: [], isError: true }] as never)
  runtime.onAgentSettled()
  runtime.onToolEnd(true)

  const events = await sse.done
  const states = events.map(e => (JSON.parse(e) as { state?: string }).state).filter(Boolean)
  check('thinking broadcast', states.filter(s => s === 'thinking').length === 1, states.join(','))
  check('thinking-only update stays thinking (no writing)', !states.includes('writing'), states.join(','))
  check('searching broadcast', states.includes('searching'), states.join(','))
  check('alert broadcast on error', states.filter(s => s === 'alert').length >= 1, states.join(','))
  check('idle broadcast on settle', states.includes('idle'), states.join(','))
  check('no balloon events yet', !events.some(e => (JSON.parse(e) as { type?: string }).type === 'balloon'))

  runtime.dispose()

  // --- Choice answers: the button decides what the model does --------------
  // cameoChance: 0 so balloon side effects can never spawn a real window.
  //
  // A "Yes" now resolves exactly one of two ways, never both:
  //  - the offer carried a drafted request (real work for the coding agent):
  //    that request, and ONLY that request, goes into the pi session as the
  //    user's own message;
  //  - it did not: Clippy does the job himself with his file powers (the
  //    model is absent in tests, so the fallback balloon is what lands) and
  //    nothing is put into the session.
  // Refusals and snoozes are unchanged: nothing is ever inserted.
  interface InsertRecord { text: string; options?: { deliverAs?: string } }
  const inserted: InsertRecord[] = []
  const choiceCtx = fakeCtx()
  const choiceRun = new ClippyRuntime(choiceCtx, {
    renderer: 'external',
    viewer,
    config: { ...defaultClippyConfig(), cameoChance: 0 },
    sendUserMessage: (text, options) => { inserted.push({ text: String(text), options }) },
  })
  const showBalloon = (choiceRun as unknown as {
    showBalloon: (text: string, choices?: boolean | readonly string[], subject?: string, force?: boolean, request?: string) => void
  }).showBalloon.bind(choiceRun)
  const balloonEvents: string[] = []
  const accepted = collectSse(`${viewer.origin}/events?t=${token}`, 4)
  await accepted.ready
  showBalloon('It looks like you are preparing a memo. Would you like help with it?', ['Yes, please', 'No thanks'])
  choiceRun.onChoice(0)
  const acceptedEvents = await accepted.done
  acceptedEvents.forEach(raw => {
    const parsed = JSON.parse(raw) as { type?: string; text?: string }
    if (parsed.type === 'balloon' && typeof parsed.text === 'string') balloonEvents.push(parsed.text)
  })
  check('a paperclip-sized offer is not pushed into the session',
    inserted.length === 0, inserted.map(r => r.text).join('|'))
  check('accepted answer makes Clippy act (offer-action balloon lands)',
    balloonEvents.length >= 1 && balloonEvents.some(t => /on it|filing cabinet/iu.test(t)), balloonEvents.join(' | '))
  showBalloon('It looks like you are addressing an envelope. Would you like help with it?', ['Yes', 'No, not now'])
  choiceRun.onChoice(1)
  check('refused answer is not inserted', inserted.length === 0, inserted.map(r => r.text).join('|'))
  showBalloon('It looks like you are filing papers. Would you like help with it?', ['Yes', 'No', "Don't show this tip again"])
  choiceRun.onChoice(2)
  check('snooze answer is not inserted', inserted.length === 0, inserted.map(r => r.text).join('|'))

  // The offer that carries real work: the drafted instruction is printed in
  // the balloon, and the send button delivers exactly that text — the words
  // the user read, verbatim, with nothing appended.
  const drafted = 'Fix the failing assertion in test/floor.test.ts.'
  showBalloon(
    `It looks like a letter has ripped. I have written it out for the big model: "${drafted}"`,
    ['Send it to pi', 'Not now'], undefined, false, drafted,
  )
  choiceRun.onChoice(0, 'Send it to pi')
  check('the send button delivers the drafted request verbatim',
    inserted.length === 1 && inserted[0]?.text === drafted, inserted.map(r => r.text).join('|'))
  // One press, one send: the armed request never survives its buttons.
  showBalloon('It looks like you are filing papers. Would you like help with it?', ['Yes', 'No'])
  choiceRun.onChoice(0, 'Yes')
  check('a drafted request is never re-sent by a later, unrelated yes',
    inserted.length === 1, inserted.map(r => r.text).join('|'))
  // Refusing a drafted request sends nothing at all.
  showBalloon(
    `It looks like a letter has ripped. I have written it out for the big model: "${drafted}"`,
    ['Send it to pi', 'Not now'], undefined, false, drafted,
  )
  choiceRun.onChoice(1, 'Not now')
  check('a refused draft is never sent', inserted.length === 1, inserted.map(r => r.text).join('|'))
  choiceRun.dispose()

  // A buddy's accept still asks the pi session for real (buddies cannot edit
  // files): the request is queued as a follow-up while the agent is busy.
  const busyCtx = { ...fakeCtx(), isIdle: () => false } as ExtensionContext
  const busyRun = new ClippyRuntime(busyCtx, {
    renderer: 'external',
    viewer,
    config: { ...defaultClippyConfig(), cameoChance: 0 },
    sendUserMessage: (text, options) => { inserted.push({ text: String(text), options }) },
  })
  viewer.showCameo('bonzi', 'It looks like you are being followed by a paperclip. Would you like help with it?', true)
  // Deliver the line so the buddy's "last words" exist (the window itself
  // is stubbed away in tests, so sayTo stands in for the cameo-ready handoff).
  viewer.sayTo('bonzi', 'It looks like you are being followed by a paperclip. Would you like help with it?')
  busyRun.onBuddyChoice('bonzi', 0, 'Yes')
  check('buddy accept still inserts a real request built from the balloon',
    inserted.length === 2 && (inserted[1]?.text ?? '').startsWith('Please help me with'),
    inserted.map(r => r.text).join('|'))
  check('mid-run buddy insertion queues as a follow-up',
    inserted[1]?.options?.deliverAs === 'followUp', JSON.stringify(inserted[1] ?? null))
  busyRun.dispose()

  // --- Lobotomy: typing the word resets the session self -------------------
  // An old, angry, over-memoried session is wiped by a single magic word:
  // grudges, the strike, mutes, offers, buddy grants and memories, and the
  // egg encore counters all come back to zero — and the persistent stats
  // (streaks/ranks/grace tokens) are deliberately untouched.
  const lobCtx = fakeCtx()
  const lobRun = new ClippyRuntime(lobCtx, {
    renderer: 'external',
    viewer,
    config: { ...defaultClippyConfig(), cameoChance: 0 },
  })
  const lobState = lobRun as unknown as {
    grievance: number
    strikeUntil: number
    brushOffs: number
    duckMode: boolean
    eggsFired: Map<string, number>
    buddies: { readAccess: Set<string>; threads: Map<string, unknown>; recentSummons: string[] }
    offers: { refusals: number; snoozedTopics: Set<string> }
  }
  lobState.grievance = 3
  lobState.strikeUntil = Date.now() + 60_000
  lobState.brushOffs = 2
  lobState.duckMode = true
  lobState.buddies.readAccess.add('bonzi')
  lobState.buddies.threads.set('bonzi-clippy', {} as never)
  lobState.buddies.recentSummons.push('rocky')
  lobState.offers.refusals = 4
  lobState.offers.snoozedTopics.add('writing a letter')

  const lobSse = collectSse(`${viewer.origin}/events?t=${token}`, 4)
  await lobSse.ready
  lobRun.onUserInput('run sudo apt install the thing')
  lobRun.onUserInput('run sudo apt install another')
  lobRun.onUserInput('lobotomy')
  const lobEvents = await lobSse.done
  const lobBalloons = lobEvents
    .map(e => (JSON.parse(e) as { type?: string; text?: string }))
    .filter(e => e.type === 'balloon')
    .map(e => e.text ?? '')
  check('the lobotomy line lands after the reset',
    lobBalloons.length === 3 && lobBalloons[2] === 'I have no memory of this place.',
    lobBalloons.join(' | '))
  check('grievances are gone', lobState.grievance === 0, String(lobState.grievance))
  check('the strike is gone', lobState.strikeUntil === 0 && lobState.brushOffs === 0)
  check('duck mode is gone', lobState.duckMode === false)
  check('egg encore counters are reset', lobState.eggsFired.size === 0,
    Array.from(lobState.eggsFired.keys()).join(','))
  check('buddy read grants are revoked and Clippy keeps his own',
    !lobState.buddies.readAccess.has('bonzi') && lobState.buddies.readAccess.has('clippy'))
  check('buddy session memory is gone',
    lobState.buddies.threads.size === 0 && lobState.buddies.recentSummons.length === 0)
  check('the offer arc is wiped',
    lobState.offers.refusals === 0 && lobState.offers.snoozedTopics.size === 0)
  // After a lobotomy even a repeat trigger starts fresh instead of its encore.
  lobRun.onUserInput('run sudo apt install three times')
  check('sudo is a stranger again after the lobotomy',
    lobState.eggsFired.get('sudo') === 1, lobState.eggsFired.get('sudo')?.toString() ?? 'none')
  lobRun.dispose()
  // --- The desk notes and the background goal ------------------------------
  //
  // The two channels that reach past the user: the memo that rides along on
  // the coding agent's context, and the goal Clippy works on unsupervised.
  // Both are wired here rather than in their own modules' tests, because what
  // matters is that the runtime actually feeds and gates them.
  const memoRun = new ClippyRuntime(fakeCtx(), {
    renderer: 'external',
    viewer,
    config: { ...defaultClippyConfig(), cameoChance: 0, inputCommentChance: 0 },
  })
  memoRun.start()
  check('a fresh session has no desk notes to send', memoRun.memoBlock() === undefined)
  memoRun.onUserInput('please make the crosstalk floor stop stalling on cameos')
  check('what the user opened with becomes a desk note',
    memoRun.memoBlock()?.includes('crosstalk floor stop stalling') === true)
  check('the desk notes say plainly that they are not instructions',
    memoRun.memoBlock()?.includes('not instructions') === true)
  check('the coding agent can file a note with him',
    memoRun.rememberForAgent('the user wants no new dependencies'))
  check('a filed note reaches the desk notes',
    memoRun.memoBlock()?.includes('no new dependencies') === true)

  // The goal: set by the user, scoped by the user, and ungranted until asked.
  check('a session starts with no goal', memoRun.destinyGoalNow() === undefined)
  check('the goal system is available by default', memoRun.destinyEnabled())
  const goalSet = memoRun.setDestinyGoal('keep the readme install steps accurate', 'README.md')
  check('a goal with a scope is taken on', goalSet?.scope.join() === 'README.md')
  check('an unscoped goal is refused', memoRun.setDestinyGoal('do whatever you like', '/etc') === undefined)
  check('the goal is declared to the coding agent, not hidden from it',
    memoRun.memoBlock()?.includes('Clippy is separately working on') === true)
  check('a goal does not grant itself', !memoRun.destinyGranted())
  memoRun.grantDestiny()
  check('the grant is the user\'s to give', memoRun.destinyGranted())
  memoRun.revokeDestiny()
  check('and the user\'s to take back', !memoRun.destinyGranted())
  memoRun.clearDestinyGoal()
  check('a retired goal is gone', memoRun.destinyGoalNow() === undefined)
  check('and stops being mentioned to the coding agent',
    memoRun.memoBlock()?.includes('Clippy is separately working on') !== true)
  memoRun.dispose()

  // Both channels can be turned off outright, and then they are really off.
  const quietRun = new ClippyRuntime(fakeCtx(), {
    renderer: 'external',
    viewer,
    config: { ...defaultClippyConfig(), cameoChance: 0, inputCommentChance: 0, deskNotes: false, destiny: false },
  })
  quietRun.start()
  quietRun.onUserInput('please make the crosstalk floor stop stalling on cameos')
  check('deskNotes: false sends the coding agent nothing', quietRun.memoBlock() === undefined)
  check('destiny: false reports itself disabled', !quietRun.destinyEnabled())
  check('destiny: false refuses to take on a goal',
    quietRun.setDestinyGoal('tidy the readme up a bit', 'README.md') === undefined)
  quietRun.dispose()

  // --- The relationship (src/rapport.ts) -----------------------------------
  //
  // Wired here rather than in the module's own test because what matters is
  // that the runtime actually MOVES the score on the things the user does,
  // and that turning the system off really stops it moving.
  interface RapportProbe {
    rapport: () => { level: string; score: number; sessionScore: number }
    offerBias: () => number
    showBalloon: (text: string, choices?: boolean | readonly string[], subject?: string, force?: boolean, request?: string) => void
    rapportLedger: { score: number; touched: boolean }
  }
  // Its own stats dir: the carried score is the whole point of this system,
  // so the earlier runtimes in this file must not have left one lying around.
  const sharedStatsDir = process.env['PI_CLIPPY_STATS_DIR']
  process.env['PI_CLIPPY_STATS_DIR'] = join(tmpdir(), `pi-clippy-test-rapport-${Date.now()}`)
  const bondRun = new ClippyRuntime(fakeCtx(), {
    renderer: 'external',
    viewer,
    config: { ...defaultClippyConfig(), cameoChance: 0, inputCommentChance: 0 },
  })
  bondRun.start()
  const bond = bondRun as unknown as RapportProbe
  const offer = (): void => bond.showBalloon(
    'It looks like you are preparing a memo. Would you like help with it?', ['Yes, please', 'No thanks'],
  )
  check('a fresh session starts on ordinary terms',
    bond.rapport().sessionScore === 0 && bond.offerBias() === 1, bond.rapport().level)
  offer()
  bondRun.onChoice(1, 'No thanks')
  const afterNo = bond.rapport().sessionScore
  check('a no is felt', afterNo < 0, String(afterNo))
  offer()
  bondRun.onChoice(0, 'Yes, please')
  check('a yes is felt harder than the no', bond.rapport().sessionScore > afterNo + 1, String(bond.rapport().sessionScore))
  bondRun.onPetted()
  bondRun.onFeed()
  check('so is being handled fondly', bond.rapport().sessionScore > 2, String(bond.rapport().sessionScore))
  for (let i = 0; i < 8; i += 1) {
    offer()
    bondRun.onChoice(1, 'No thanks')
  }
  check('a session of noes cools him off', bond.rapport().level === 'strained' || bond.rapport().level === 'frosty',
    bond.rapport().level)
  check('and makes him volunteer less without ever muting him',
    bond.offerBias() < 1 && bond.offerBias() > 0, String(bond.offerBias()))
  const parted = bond.rapport().sessionScore
  bondRun.dispose()

  // It survives the session: the next one opens where this one left off,
  // faded a little rather than erased.
  const tomorrow = new ClippyRuntime(fakeCtx(), {
    renderer: 'external',
    viewer,
    config: { ...defaultClippyConfig(), cameoChance: 0, inputCommentChance: 0 },
  })
  tomorrow.start()
  const carried = (tomorrow as unknown as RapportProbe).rapport().score
  check('how a session ended is carried into the next one', carried < 0, String(carried))
  // Fading is a DAY boundary, not a session boundary: opening pi twice in an
  // afternoon must not quietly erase how the morning went (the fade itself is
  // unit-tested in test/rapport.test.ts).
  check('a second session on the same day inherits it whole', carried === parted, `${parted} -> ${carried}`)
  tomorrow.dispose()
  process.env['PI_CLIPPY_STATS_DIR'] = sharedStatsDir

  // Turned off, nothing about the relationship moves at all.
  const flatRun = new ClippyRuntime(fakeCtx(), {
    renderer: 'external',
    viewer,
    config: { ...defaultClippyConfig(), cameoChance: 0, inputCommentChance: 0, rapport: false },
  })
  flatRun.start()
  const flat = flatRun as unknown as RapportProbe
  flat.showBalloon('It looks like you are preparing a memo. Would you like help with it?', ['Yes', 'No thanks'])
  flatRun.onChoice(0, 'Yes')
  flatRun.onPetted()
  check('rapport: false keeps the ledger untouched',
    flat.rapport().sessionScore === 0 && !flat.rapportLedger.touched)
  check('rapport: false leaves how much he talks exactly as it was', flat.offerBias() === 1)
  flatRun.dispose()

  viewer.dispose()

  const failed = results.filter(r => r.startsWith('FAIL'))
  console.log(results.join('\n'))
  console.log(failed.length === 0 ? '\nALL PASS' : `\n${failed.length} FAILURES`)
  process.exit(failed.length === 0 ? 0 : 1)
}

void main()
