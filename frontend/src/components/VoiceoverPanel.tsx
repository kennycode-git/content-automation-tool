import type { AiVoiceoverConfig, SubtitleFormat, VoiceoverModel, VoiceoverScriptMode } from '../lib/api'

export const DEFAULT_AI_VOICEOVER: AiVoiceoverConfig = {
  enabled: false,
  provider: 'elevenlabs',
  model_id: 'eleven_multilingual_v2',
  voice_id: '',
  voice_label: '',
  script_mode: 'auto_from_batch',
  script_text: '',
  subtitles_enabled: true,
  subtitle_format: 'burned',
}

const MODEL_OPTIONS: { value: VoiceoverModel; label: string; blurb: string }[] = [
  { value: 'eleven_multilingual_v2', label: 'Multilingual v2', blurb: 'Best quality for polished narration.' },
  { value: 'eleven_flash_v2_5', label: 'Flash v2.5', blurb: 'Fastest turnaround for experiments.' },
  { value: 'eleven_turbo_v2_5', label: 'Turbo v2.5', blurb: 'Balanced speed and quality.' },
  { value: 'eleven_v3', label: 'Eleven v3', blurb: 'Newest expressive model shell.' },
]

const SCRIPT_OPTIONS: { value: VoiceoverScriptMode; label: string; blurb: string }[] = [
  { value: 'auto_from_batch', label: 'Auto from batch', blurb: 'Generate narration from the batch title and terms.' },
  { value: 'custom', label: 'Custom script', blurb: 'Use your own narration copy for this batch.' },
]

const SUBTITLE_OPTIONS: { value: SubtitleFormat; label: string; blurb: string }[] = [
  { value: 'burned', label: 'Burn into video', blurb: 'Best default for social posts.' },
  { value: 'srt', label: 'Export SRT', blurb: 'Keep subtitles separate for future editing.' },
]

function NewBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-amber-300">
      <span aria-hidden="true">✦</span>
      <span>New</span>
    </span>
  )
}

interface Props {
  value: AiVoiceoverConfig | null | undefined
  onChange: (next: AiVoiceoverConfig) => void
}

export default function VoiceoverPanel({ value, onChange }: Props) {
  const voiceover = value ?? DEFAULT_AI_VOICEOVER

  function update(patch: Partial<AiVoiceoverConfig>) {
    onChange({ ...voiceover, ...patch })
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-semibold tracking-widest uppercase text-stone-500">AI voiceover</p>
          <NewBadge />
        </div>
        <span className="text-[9px] text-stone-600">ElevenLabs + subtitles</span>
      </div>

      <p className="rounded-lg border border-amber-500/15 bg-amber-500/5 px-2.5 py-2 text-[10px] leading-relaxed text-stone-300">
        This shell stores per-batch voice and subtitle settings now, so we can wire the actual ElevenLabs render pass in next.
      </p>

      <div>
        <p className="mb-1 text-[9px] font-semibold tracking-widest uppercase text-stone-600">Voice ID</p>
        <input
          type="text"
          value={voiceover.voice_id ?? ''}
          onChange={e => update({ voice_id: e.target.value })}
          placeholder="Enter an ElevenLabs voice ID..."
          className="w-full rounded-lg border border-stone-700 bg-stone-800 px-2.5 py-1.5 text-xs text-stone-100 placeholder-stone-600 focus:border-brand-500 focus:outline-none"
        />
      </div>

      <div>
        <p className="mb-1 text-[9px] font-semibold tracking-widest uppercase text-stone-600">Voice label</p>
        <input
          type="text"
          value={voiceover.voice_label ?? ''}
          onChange={e => update({ voice_label: e.target.value })}
          placeholder="Optional internal label..."
          className="w-full rounded-lg border border-stone-700 bg-stone-800 px-2.5 py-1.5 text-xs text-stone-100 placeholder-stone-600 focus:border-brand-500 focus:outline-none"
        />
      </div>

      <div>
        <p className="mb-1.5 text-[9px] font-semibold tracking-widest uppercase text-stone-600">Model</p>
        <div className="space-y-1">
          {MODEL_OPTIONS.map(option => (
            <button
              key={option.value}
              onClick={() => update({ model_id: option.value })}
              className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${
                voiceover.model_id === option.value
                  ? 'border-brand-500/50 bg-brand-500/10 text-stone-100'
                  : 'border-stone-700 bg-stone-800 text-stone-400 hover:border-stone-600 hover:text-stone-200'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium">{option.label}</span>
                {voiceover.model_id === option.value && <span className="text-[9px] uppercase tracking-[0.18em] text-brand-300">Selected</span>}
              </div>
              <p className="mt-0.5 text-[10px] text-stone-500">{option.blurb}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[9px] font-semibold tracking-widest uppercase text-stone-600">Script</p>
        <div className="space-y-1">
          {SCRIPT_OPTIONS.map(option => (
            <button
              key={option.value}
              onClick={() => update({ script_mode: option.value })}
              className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${
                voiceover.script_mode === option.value
                  ? 'border-brand-500/50 bg-brand-500/10 text-stone-100'
                  : 'border-stone-700 bg-stone-800 text-stone-400 hover:border-stone-600 hover:text-stone-200'
              }`}
            >
              <div className="text-[11px] font-medium">{option.label}</div>
              <p className="mt-0.5 text-[10px] text-stone-500">{option.blurb}</p>
            </button>
          ))}
        </div>
      </div>

      {voiceover.script_mode === 'custom' && (
        <div>
          <p className="mb-1 text-[9px] font-semibold tracking-widest uppercase text-stone-600">Narration copy</p>
          <textarea
            rows={4}
            value={voiceover.script_text ?? ''}
            onChange={e => update({ script_text: e.target.value })}
            placeholder="Write the exact narration for this batch..."
            className="w-full rounded-lg border border-stone-700 bg-stone-800 px-2.5 py-1.5 text-xs text-stone-100 placeholder-stone-600 focus:border-brand-500 focus:outline-none resize-none"
          />
        </div>
      )}

      <div className="rounded-lg border border-stone-800 bg-stone-950/70 p-2.5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">Subtitles</p>
            <p className="mt-0.5 text-[10px] text-stone-600">Keep captions tied to this narration setup.</p>
          </div>
          <button
            onClick={() => update({ subtitles_enabled: !voiceover.subtitles_enabled })}
            className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${voiceover.subtitles_enabled ? 'bg-brand-500' : 'bg-stone-700'}`}
          >
            <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${voiceover.subtitles_enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {voiceover.subtitles_enabled && (
          <div className="mt-2 space-y-1">
            {SUBTITLE_OPTIONS.map(option => (
              <button
                key={option.value}
                onClick={() => update({ subtitle_format: option.value })}
                className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${
                  voiceover.subtitle_format === option.value
                    ? 'border-brand-500/50 bg-brand-500/10 text-stone-100'
                    : 'border-stone-700 bg-stone-800 text-stone-400 hover:border-stone-600 hover:text-stone-200'
                }`}
              >
                <div className="text-[11px] font-medium">{option.label}</div>
                <p className="mt-0.5 text-[10px] text-stone-500">{option.blurb}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
