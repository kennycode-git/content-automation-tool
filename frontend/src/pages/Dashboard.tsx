/**
 * Dashboard.tsx
 *
 * Main tool page: batch editor + settings + run pipeline + job status + recent jobs.
 *
 * Each # block in the batch editor becomes a separate job submission.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'

const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS === 'true'
import { generateVideo, prefetchImages, stagePreview, deleteJob } from '../lib/api'
import type { JobStatus, PreviewBatchResult } from '../lib/api'
import BatchEditor from '../components/BatchEditor'
import type { BatchOutput } from '../components/BatchEditor'
import SettingsPanel from '../components/SettingsPanel'
import type { VideoSettings } from '../components/SettingsPanel'
import JobPanel from '../components/JobPanel'
import RecentJobs from '../components/RecentJobs'
import TermBundles from '../components/TermBundles'
import ToastStack from '../components/Toast'
import type { ToastItem } from '../components/Toast'
import PreviewModal from '../components/PreviewModal'
import type { ConfirmedBatch } from '../components/PreviewModal'
import AdvancedModal from '../components/AdvancedModal'

interface Props {
  session: Session
}

const DEFAULT_SETTINGS: VideoSettings = {
  resolution: '1080x1920',
  seconds_per_image: 0.5,
  total_seconds: 5,
  fps: 30,
  allow_repeats: true,
  color_theme: 'none',
  max_per_query: 3,
}

const VARIANT_THEMES = [
  { value: 'dark',  label: 'Dark Tones' },
  { value: 'none',  label: 'Natural' },
  { value: 'warm',  label: 'Amber & Earth' },
  { value: 'grey',  label: 'Silver & Slate' },
  { value: 'blue',  label: 'Cobalt & Mist' },
  { value: 'red',   label: 'Crimson & Rose' },
  { value: 'bw',    label: 'Monochrome' },
]

export default function Dashboard({ session }: Props) {
  const [batches, setBatches] = useState<BatchOutput[]>([])
  const [settings, setSettings] = useState<VideoSettings>(DEFAULT_SETTINGS)
  const [activeJobs, setActiveJobs] = useState<{ jobId: string; title: string | null }[]>(() => {
    try { return JSON.parse(localStorage.getItem('cogito_active_jobs') ?? '[]') } catch { return [] }
  })
  const [minimizedJobs, setMinimizedJobs] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('cogito_minimized_jobs') ?? '[]')) } catch { return new Set() }
  })
  const [pendingCount, setPendingCount] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [pendingReuse, setPendingReuse] = useState<{ title: string | null; terms: string[] } | null>(null)
  const [pendingBundles, setPendingBundles] = useState<{ title: string | null; terms: string[] }[] | null>(null)
  const [appliedPresetName, setAppliedPresetName] = useState<string | null>(null)
  const [showVariants, setShowVariants] = useState(false)
  const [checkedThemes, setCheckedThemes] = useState<Set<string>>(new Set(['dark', 'bw', 'none']))
  const [variantStatus, setVariantStatus] = useState<string | null>(null)
  const [uploadedOnly, setUploadedOnly] = useState(false)
  const [accentFolder, setAccentFolder] = useState<string | null>(null)
  const [staging, setStaging] = useState(false)
  const [stagingError, setStagingError] = useState<string | null>(null)
  const [previewData, setPreviewData] = useState<PreviewBatchResult[] | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showGenDropdown, setShowGenDropdown] = useState(false)
  const genDropdownRef = useRef<HTMLDivElement>(null)
  const stagingAbortRef = useRef<AbortController | null>(null)

  // Browser tab title: show pending job count while running
  useEffect(() => {
    document.title = pendingCount > 0
      ? `(${pendingCount}) PassiveClip`
      : 'PassiveClip'
    return () => { document.title = 'PassiveClip' }
  }, [pendingCount])

  // Click-outside handler for gen dropdown
  useEffect(() => {
    if (!showGenDropdown) return
    function handleClick(e: MouseEvent) {
      if (genDropdownRef.current && !genDropdownRef.current.contains(e.target as Node))
        setShowGenDropdown(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showGenDropdown])

  function addToast(message: string) {
    const id = crypto.randomUUID()
    setToasts(prev => [...prev, { id, message }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 5000)
  }

  function dismissToast(id: string) {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  // Persist active jobs + minimized state across page refreshes
  useEffect(() => {
    try { localStorage.setItem('cogito_active_jobs', JSON.stringify(activeJobs)) } catch { /* ignore */ }
  }, [activeJobs])

  useEffect(() => {
    try { localStorage.setItem('cogito_minimized_jobs', JSON.stringify([...minimizedJobs])) } catch { /* ignore */ }
  }, [minimizedJobs])

  function dismissJob(jobId: string) {
    setActiveJobs(prev => prev.filter(j => j.jobId !== jobId))
    setMinimizedJobs(prev => { const next = new Set(prev); next.delete(jobId); return next })
  }

  async function cancelJob(jobId: string) {
    await deleteJob(jobId)
    dismissJob(jobId)
    setPendingCount(prev => Math.max(0, prev - 1))
  }

  function toggleMinimize(jobId: string) {
    setMinimizedJobs(prev => {
      const next = new Set(prev)
      if (next.has(jobId)) next.delete(jobId)
      else next.add(jobId)
      return next
    })
  }

  const handleGenerate = useCallback(async () => {
    const validBatches = batches.filter(b => b.terms.length > 0)
    if (validBatches.length === 0) {
      setError('Enter at least one search term.')
      return
    }
    setError(null)
    setSubmitting(true)
    setPendingCount(validBatches.length)
    try {
      const submitted: { jobId: string; title: string | null }[] = []
      for (const batch of validBatches) {
        const res = await generateVideo({
          search_terms: batch.terms,
          ...settings,
          batch_title: batch.title,
          uploaded_image_paths: batch.uploaded_image_paths?.length ? batch.uploaded_image_paths : undefined,
          preset_name: appliedPresetName ?? undefined,
          uploaded_only: uploadedOnly || undefined,
          accent_folder: accentFolder ?? undefined,
        })
        submitted.push({ jobId: res.job_id, title: batch.title })
      }
      setActiveJobs(submitted)
      setMinimizedJobs(new Set())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setPendingCount(0)
    } finally {
      setSubmitting(false)
    }
  }, [batches, settings])

  const handleGenerateVariants = useCallback(async () => {
    const validBatches = batches.filter(b => b.terms.length > 0)
    if (validBatches.length === 0) {
      setError('Enter at least one search term.')
      return
    }
    if (checkedThemes.size === 0) {
      setError('Select at least one theme variant.')
      return
    }
    setError(null)
    setSubmitting(true)
    const themesToRun = VARIANT_THEMES.filter(t => checkedThemes.has(t.value))
    const totalJobs = validBatches.length * themesToRun.length
    setPendingCount(totalJobs)
    try {
      const submitted: { jobId: string; title: string | null }[] = []
      for (const batch of validBatches) {
        // Prefetch images once for this batch — all theme variants share the same source images
        setVariantStatus(batch.title ? `Fetching images for "${batch.title}"…` : 'Fetching images…')
        const { paths } = await prefetchImages({
          search_terms: batch.terms,
          resolution: settings.resolution,
          seconds_per_image: settings.seconds_per_image,
          total_seconds: settings.total_seconds,
          max_per_query: settings.max_per_query,
        })

        setVariantStatus('Queuing jobs…')
        for (const theme of themesToRun) {
          const title = batch.title ? `${batch.title} · ${theme.label}` : theme.label
          const res = await generateVideo({
            search_terms: batch.terms,
            ...settings,
            color_theme: theme.value,
            batch_title: title,
            uploaded_image_paths: paths.length ? paths : undefined,
            uploaded_only: uploadedOnly || undefined,
            accent_folder: accentFolder ?? undefined,
          })
          submitted.push({ jobId: res.job_id, title })
        }
      }
      setActiveJobs(submitted)
      setMinimizedJobs(new Set())
      setShowVariants(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setPendingCount(0)
    } finally {
      setSubmitting(false)
      setVariantStatus(null)
    }
  }, [batches, settings, checkedThemes])

  const handleStagePreview = useCallback(async () => {
    const validBatches = batches.filter(b => b.terms.length > 0)
    if (validBatches.length === 0) {
      setError('Enter at least one search term.')
      return
    }
    setError(null)
    setStagingError(null)
    setStaging(true)
    const abort = new AbortController()
    stagingAbortRef.current = abort
    try {
      const res = await stagePreview({
        batches: validBatches.map(b => ({
          search_terms: b.terms,
          batch_title: b.title,
          uploaded_image_paths: b.uploaded_image_paths?.length ? b.uploaded_image_paths : undefined,
        })),
        resolution: settings.resolution,
        seconds_per_image: settings.seconds_per_image,
        total_seconds: settings.total_seconds,
        max_per_query: settings.max_per_query,
        color_theme: settings.color_theme,
      }, abort.signal)
      setPreviewData(res.batches)
    } catch (e: unknown) {
      if ((e as { name?: string }).name !== 'AbortError') {
        setStagingError(e instanceof Error ? e.message : 'Staging failed')
      }
    } finally {
      stagingAbortRef.current = null
      setStaging(false)
    }
  }, [batches, settings])

  const handlePreviewConfirm = useCallback(async (confirmedBatches: ConfirmedBatch[]) => {
    setPreviewData(null)
    const eligible = confirmedBatches.filter(b => b.images.length > 0)
    if (eligible.length === 0) return
    setError(null)
    setSubmitting(true)
    setPendingCount(eligible.length)
    try {
      const submitted: { jobId: string; title: string | null }[] = []
      for (const batch of eligible) {
        const res = await generateVideo({
          search_terms: batch.search_terms,
          ...settings,
          color_theme: 'none',  // already graded at staging time
          batch_title: batch.batch_title,
          uploaded_image_paths: batch.images.map(img => img.storage_path),
          uploaded_only: true,
          accent_folder: accentFolder ?? undefined,
          preset_name: appliedPresetName ?? undefined,
        })
        submitted.push({ jobId: res.job_id, title: batch.batch_title })
      }
      setActiveJobs(submitted)
      setMinimizedJobs(new Set())
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setPendingCount(0)
    } finally {
      setSubmitting(false)
    }
  }, [settings, accentFolder, appliedPresetName])

  // Ctrl/Cmd+Enter to generate
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !submitting) {
        handleGenerate()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleGenerate, submitting])

  function handleJobDone(job: JobStatus) {
    setPendingCount(prev => Math.max(0, prev - 1))
    const name = job.batch_title || 'Video'
    addToast(`✅ ${name} ready — download below`)
  }

  function handleReuse(title: string | null, terms: string[], restoredSettings: Partial<VideoSettings> | null) {
    setPendingReuse({ title, terms })
    if (restoredSettings) setSettings(prev => ({ ...prev, ...restoredSettings }))
  }

  function toggleTheme(value: string) {
    setCheckedThemes(prev => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }

  const batchCount = batches.filter(b => b.terms.length > 0).length
  const variantJobCount = batchCount * checkedThemes.size

  return (
    <div className="min-h-screen bg-stone-950">
      {DEV_BYPASS && (
        <div className="bg-amber-900/60 border-b border-amber-700 px-4 py-1.5 text-center text-xs text-amber-300">
          Dev bypass active — remove <code className="font-mono">VITE_DEV_BYPASS</code> from .env.local before deploying
        </div>
      )}

      {/* Navbar */}
      <nav className="border-b border-stone-800 bg-stone-900 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="" className="h-12 w-auto" />
          <img src="/just%20text.png" alt="PassiveClip" className="h-9 w-auto" />
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-stone-500">{session.user.email}</span>
          <Link to="/account" className="text-xs text-stone-400 hover:text-stone-200">
            Account
          </Link>
        </div>
      </nav>

      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

          {/* Left column: batch editor + settings + generate */}
          <div className="lg:col-span-2">

            {/* Step 1 */}
            <div className="flex items-center gap-2 mb-2">
              <span className="rounded bg-brand-500/20 px-2 py-0.5 text-[10px] font-bold text-brand-400 tracking-wider">STEP 1</span>
              <span className="text-xs text-stone-500">Search terms</span>
            </div>
            <div className="rounded-2xl border border-stone-800 bg-stone-900 p-6">
              <TermBundles onLoad={bundles => setPendingBundles(bundles)} />
              <hr className="border-stone-800 my-4" />
              <BatchEditor
                onBatchesChange={setBatches}
                pendingReuse={pendingReuse}
                onReuseHandled={() => setPendingReuse(null)}
                pendingBundles={pendingBundles}
                onBundlesHandled={() => setPendingBundles(null)}
              />
            </div>

            {/* Step 2 */}
            <div className="flex items-center gap-2 mb-2 mt-6">
              <span className="rounded bg-brand-500/20 px-2 py-0.5 text-[10px] font-bold text-brand-400 tracking-wider">STEP 2</span>
              <span className="text-xs text-stone-500">Video settings</span>
            </div>
            <div className="rounded-2xl border border-stone-800 bg-stone-900 p-6">
              <SettingsPanel
                settings={settings}
                onChange={s => { setSettings(s); setAppliedPresetName(null) }}
                onPresetApplied={setAppliedPresetName}
              />
            </div>

            {/* Step 3 */}
            <div className="flex items-center gap-2 mb-2 mt-6">
              <span className="rounded bg-brand-500/20 px-2 py-0.5 text-[10px] font-bold text-brand-400 tracking-wider">STEP 3</span>
              <span className="text-xs text-stone-500">Generate</span>
            </div>

            {(error || stagingError) && (
              <div className="rounded-xl bg-red-950 px-4 py-3 text-sm text-red-400 mb-3">
                {error ?? stagingError}
              </div>
            )}

            {/* Action row */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAdvanced(true)}
                className="rounded-xl border border-stone-700 px-4 py-3 text-stone-400 hover:border-stone-500 hover:text-stone-200 transition shrink-0"
                title="Advanced settings"
              >
                ⚙
              </button>

              <button
                onClick={() => setShowVariants(v => !v)}
                disabled={submitting || staging}
                className={`rounded-xl border px-4 py-3 text-sm transition shrink-0 disabled:opacity-50 ${showVariants ? 'border-brand-500 text-brand-400' : 'border-stone-700 text-stone-400 hover:border-stone-500 hover:text-stone-200'}`}
                title="Colour variants"
              >
                🎨
              </button>

              <div ref={genDropdownRef} className="relative flex-1 flex">
                <button
                  onClick={handleGenerate}
                  disabled={submitting || staging}
                  className="flex-1 rounded-l-xl bg-brand-500 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 transition"
                >
                  {submitting ? 'Submitting…' : staging ? 'Fetching images…'
                    : batchCount > 1 ? `Generate ${batchCount} videos` : 'Generate video'}
                </button>
                <button
                  onClick={() => setShowGenDropdown(v => !v)}
                  disabled={submitting || staging}
                  className="rounded-r-xl bg-brand-700 px-3 text-white hover:bg-brand-800 disabled:opacity-50 transition border-l border-brand-600"
                >
                  ▾
                </button>
                {showGenDropdown && (
                  <div className="absolute right-0 bottom-full mb-1 w-52 rounded-xl border border-stone-700 bg-stone-800 shadow-xl z-20 py-1">
                    <button
                      onClick={() => { setShowGenDropdown(false); handleGenerate() }}
                      className="w-full px-4 py-2.5 text-left text-sm text-stone-300 hover:bg-stone-700"
                    >
                      Generate directly
                    </button>
                    <button
                      onClick={() => { setShowGenDropdown(false); handleStagePreview() }}
                      className="w-full px-4 py-2.5 text-left text-sm text-stone-300 hover:bg-stone-700"
                    >
                      Preview images first →
                    </button>
                  </div>
                )}
              </div>
            </div>
            <p className="text-center text-xs text-stone-600 mt-2">or press Ctrl+Enter</p>

            {/* Variants inline panel */}
            {showVariants && (
              <div className="rounded-xl border border-stone-800 bg-stone-900 p-4 space-y-3 mt-3">
                <p className="text-xs text-stone-400">Select colour themes to generate one video per theme per batch:</p>
                <div className="flex flex-wrap gap-2">
                  {VARIANT_THEMES.map(t => (
                    <label key={t.value} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checkedThemes.has(t.value)}
                        onChange={() => toggleTheme(t.value)}
                        className="accent-brand-500"
                      />
                      <span className="text-xs text-stone-300">{t.label}</span>
                    </label>
                  ))}
                </div>
                <button
                  onClick={handleGenerateVariants}
                  disabled={submitting || checkedThemes.size === 0 || batchCount === 0}
                  className="w-full rounded-lg bg-stone-700 py-2 text-xs font-semibold text-stone-200 hover:bg-stone-600 disabled:opacity-40 transition"
                >
                  {variantStatus ?? (submitting
                    ? 'Submitting…'
                    : `Generate ${variantJobCount} variant${variantJobCount !== 1 ? 's' : ''}`)}
                </button>
              </div>
            )}
          </div>

          {/* Right column: active jobs + recent jobs */}
          <div className="space-y-6">
            {staging && (
              <div>
                <h2 className="mb-3 text-sm font-semibold text-stone-300">Staging preview</h2>
                <div className="rounded-xl border border-stone-700 bg-stone-800 p-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-stone-200">⏳ Fetching…</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-stone-500">preview</span>
                      <button
                        onClick={() => {
                          if (!confirm('Cancel the preview fetch?')) return
                          stagingAbortRef.current?.abort()
                        }}
                        className="text-xs text-stone-600 hover:text-red-400 leading-none"
                        title="Cancel preview"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-stone-400 mb-2">Fetching and grading preview images…</p>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-700">
                    <div className="h-1.5 w-2/3 rounded-full bg-brand-500 animate-pulse" />
                  </div>
                </div>
              </div>
            )}
            {activeJobs.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm font-semibold text-stone-300">
                  {activeJobs.length > 1 ? `Current jobs (${activeJobs.length})` : 'Current job'}
                </h2>
                <div className="space-y-3">
                  {activeJobs.map(({ jobId, title }) => (
                    <JobPanel
                      key={jobId}
                      jobId={jobId}
                      title={title}
                      minimized={minimizedJobs.has(jobId)}
                      onToggleMinimize={() => toggleMinimize(jobId)}
                      onDismiss={() => dismissJob(jobId)}
                      onDone={handleJobDone}
                      onCancel={() => cancelJob(jobId)}
                    />
                  ))}
                </div>
              </div>
            )}

            <div>
              <h2 className="mb-3 text-sm font-semibold text-stone-300">Recent jobs</h2>
              <RecentJobs onReuse={handleReuse} />
            </div>
          </div>
        </div>
      </div>

      {showAdvanced && (
        <AdvancedModal
          settings={settings}
          uploadedOnly={uploadedOnly}
          accentFolder={accentFolder}
          onSettingsChange={s => { setSettings(s); setAppliedPresetName(null) }}
          onUploadedOnlyChange={setUploadedOnly}
          onAccentFolderChange={setAccentFolder}
          onPresetApplied={setAppliedPresetName}
          onClose={() => setShowAdvanced(false)}
        />
      )}

      {previewData && (
        <PreviewModal
          batches={previewData}
          onConfirm={handlePreviewConfirm}
          onCancel={() => setPreviewData(null)}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
