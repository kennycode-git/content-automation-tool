/**
 * PresetManager.tsx
 *
 * Displays saved presets as pills; lets users apply or delete them,
 * and save the current settings as a new named preset.
 */

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listPresets, createPreset, deletePreset } from '../lib/api'

interface Props {
  currentSettings: Record<string, unknown>
  onApply: (settings: Record<string, unknown>, name: string) => void
}

export default function PresetManager({ currentSettings, onApply }: Props) {
  const qc = useQueryClient()
  const [naming, setNaming] = useState(false)
  const [nameInput, setNameInput] = useState('')

  const { data: presets = [] } = useQuery({
    queryKey: ['presets'],
    queryFn: listPresets,
    staleTime: 60_000,
  })

  const createMut = useMutation({
    mutationFn: ({ name, settings }: { name: string; settings: Record<string, unknown> }) =>
      createPreset(name, settings),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['presets'] })
      setNaming(false)
      setNameInput('')
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deletePreset(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['presets'] }),
  })

  function handleSave() {
    const name = nameInput.trim()
    if (!name) return
    createMut.mutate({ name, settings: currentSettings as unknown as Record<string, unknown> })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        {presets.length === 0 && !naming && (
          <span className="text-xs text-stone-600">No saved presets yet.</span>
        )}
        {presets.map(p => (
          <span
            key={p.id}
            className="flex items-center gap-1 rounded-full border border-stone-700 bg-stone-800 px-2.5 py-0.5"
          >
            <button
              onClick={() => onApply(p.settings, p.name)}
              className="text-xs text-stone-300 hover:text-brand-400"
            >
              {p.name}
            </button>
            <button
              onClick={() => deleteMut.mutate(p.id)}
              className="text-stone-600 hover:text-red-400 leading-none"
              title="Delete preset"
            >
              ×
            </button>
          </span>
        ))}

        {!naming ? (
          <button
            onClick={() => setNaming(true)}
            className="text-xs text-stone-500 hover:text-stone-300"
          >
            + Save current
          </button>
        ) : (
          <form
            onSubmit={e => { e.preventDefault(); handleSave() }}
            className="flex items-center gap-1"
          >
            <input
              autoFocus
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setNaming(false); setNameInput('') } }}
              placeholder="Preset name…"
              maxLength={60}
              className="rounded border border-stone-700 bg-stone-800 px-2 py-0.5 text-xs text-stone-100 focus:outline-none focus:border-brand-500 w-36"
            />
            <button
              type="submit"
              disabled={!nameInput.trim() || createMut.isPending}
              className="text-xs text-brand-500 hover:underline disabled:opacity-40"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => { setNaming(false); setNameInput('') }}
              className="text-xs text-stone-600 hover:text-stone-400"
            >
              Cancel
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
