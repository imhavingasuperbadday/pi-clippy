/** Voice settings for the Clippy window: Clippy and every buddy speak their
 * balloons aloud via the renderer's speechSynthesis (Electron shell).
 *
 * A single value that flows config → viewer → page URL params, instead of
 * three loose numbers threaded through each layer. */

export interface VoiceSettings {
  readonly enabled: boolean
  /** Speech rate (0.5 - 2). */
  readonly rate: number
  /** Speech pitch (0 - 2). */
  readonly pitch: number
}

export const VOICE_OFF: VoiceSettings = { enabled: false, rate: 1, pitch: 1 }

/** Collect the voice settings into the page-URL params consumed by the
 * renderer (assets/client.js reads voice / voiceRate / voicePitch). */
export function applyVoiceParams(params: URLSearchParams, voice: VoiceSettings): void {
  if (!voice.enabled) return
  params.set('voice', '1')
  params.set('voiceRate', String(voice.rate))
  params.set('voicePitch', String(voice.pitch))
}
