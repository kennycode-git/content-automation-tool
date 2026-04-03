/**
 * Dashboard.tsx
 *
 * Main tool page: batch editor + settings + run pipeline + job status + recent jobs.
 *
 * Each # block in the batch editor becomes a separate job submission.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'

const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS === 'true'
import { generateVideo, generateVariants, stagePreview, deleteJob, getUsage, fetchVideoClips, generateFromClips } from '../lib/api'
import type { LayeredConfig } from '../lib/api'
import type { JobStatus, PreviewBatchResult, UsageInfo, ClipSearchResult, SelectedClip } from '../lib/api'
import BatchEditor from '../components/BatchEditor'
import type { BatchOutput } from '../components/BatchEditor'
import SettingsPanel from '../components/SettingsPanel'
import type { VideoSettings, CustomGradeParams } from '../components/SettingsPanel'
import ClipsSettingsPanel, { DEFAULT_CLIPS_SETTINGS } from '../components/ClipsSettingsPanel'
import type { ClipsSettings } from '../components/ClipsSettingsPanel'
import ClipBundles from '../components/ClipBundles'
import ClipPreviewGrid from '../components/ClipPreviewGrid'
import { DEFAULT_LAYERED_CONFIG, OPACITY_PRESETS } from '../components/LayeredPanel'
import type { LayeredPanelConfig } from '../components/LayeredPanel'
import LayeredTour, { LAYERED_TOUR_KEY } from '../components/LayeredTour'
import JobPanel from '../components/JobPanel'
import RecentJobs from '../components/RecentJobs'
import TermBundles from '../components/TermBundles'
import ToastStack from '../components/Toast'
import type { ToastItem } from '../components/Toast'
import PreviewModal from '../components/PreviewModal'
import type { ConfirmedBatch } from '../components/PreviewModal'
import AdvancedModal from '../components/AdvancedModal'
import OnboardingTour, { TOUR_STORAGE_KEY } from '../components/OnboardingTour'
import PromptModal from '../components/PromptModal'
import AppNavbar from '../components/AppNavbar'
import InspirationCarousel from '../components/InspirationCarousel'

type ContentMode = 'images' | 'clips' | 'layered'

interface Props {
  session: Session
}

const DEFAULT_SETTINGS: VideoSettings = {
  resolution: '1080x1920',
  seconds_per_image: 0.13,
  total_seconds: 11,
  fps: 30,
  allow_repeats: true,
  color_theme: 'none',
  max_per_query: 3,
}

const VARIANT_THEMES = [
  { value: 'none',    label: 'Natural',     dot: 'bg-stone-400' },
  { value: 'dark',    label: 'Dark Tones',  dot: 'bg-stone-900 ring-1 ring-stone-600' },
  { value: 'sepia',   label: 'Sepia',       dot: 'bg-amber-800' },
  { value: 'warm',    label: 'Amber',       dot: 'bg-amber-500' },
  { value: 'low_exp', label: 'Low Exposure',dot: 'bg-stone-950 ring-1 ring-stone-700' },
  { value: 'grey',    label: 'Silver',      dot: 'bg-slate-400' },
  { value: 'blue',    label: 'Cobalt',      dot: 'bg-blue-500' },
  { value: 'red',     label: 'Crimson',     dot: 'bg-red-500' },
  { value: 'bw',      label: 'Monochrome',  dot: 'bg-white ring-1 ring-stone-500' },
  { value: 'mocha',   label: 'Mocha',       dot: 'bg-amber-950' },
  { value: 'noir',    label: 'Noir',        dot: 'bg-stone-900 ring-1 ring-amber-900' },
  { value: 'midnight', label: 'Midnight',    dot: 'bg-blue-950 ring-1 ring-cyan-900' },
  { value: 'dusk',    label: 'Dusk',        dot: 'bg-purple-900 ring-1 ring-purple-700' },
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
  const submittingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [pendingReuse, setPendingReuse] = useState<{ title: string | null; terms: string[] } | null>(null)
  const [pendingBundles, setPendingBundles] = useState<{ title: string | null; terms: string[]; colorTheme?: string; customGradeParams?: CustomGradeParams; accentFolder?: string | null }[] | null>(null)
  const [appliedPresetName, setAppliedPresetName] = useState<string | null>(null)
  const [showVariants, setShowVariants] = useState(false)
  const [showVariantsConfirm, setShowVariantsConfirm] = useState(false)
  const [showPromptModal, setShowPromptModal] = useState(false)
  const [checkedThemes, setCheckedThemes] = useState<Set<string>>(new Set(['dark', 'bw', 'none']))
  const [jobEstimates, setJobEstimates] = useState<Record<string, number>>({})
  const [completedJobIds, setCompletedJobIds] = useState<Set<string>>(new Set())
  const activeJobsRef = useRef(activeJobs)
  const [variantStatus, setVariantStatus] = useState<string | null>(null)
  const [accentFolder, setAccentFolder] = useState<string | null>(null)
  const [contentMode, setContentMode] = useState<ContentMode>('images')
  const [clipsSettings, setClipsSettings] = useState<ClipsSettings>(DEFAULT_CLIPS_SETTINGS)
  const [fetchedClips, setFetchedClips] = useState<ClipSearchResult[] | null>(null)
  const [selectedClips, setSelectedClips] = useState<SelectedClip[]>([])
  const [clipPreviewBatch, setClipPreviewBatch] = useState<BatchOutput | null>(null)
  const [clipsSearching, setClipsSearching] = useState(false)
  const [clipsGenerating, setClipsGenerating] = useState(false)
  const [clipsError, setClipsError] = useState<string | null>(null)
  const [layeredConfig, setLayeredConfig] = useState<LayeredPanelConfig>(DEFAULT_LAYERED_CONFIG)
  const [layeredError, setLayeredError] = useState<string | null>(null)
  const [layeredSubmitting, setLayeredSubmitting] = useState(false)
  const [showLayeredTour, setShowLayeredTour] = useState(false)
  const [staging, setStaging] = useState(false)
  const [stagingError, setStagingError] = useState<string | null>(null)
  const [stagingUsedPexels, setStagingUsedPexels] = useState(false)
  const [previewData, setPreviewData] = useState<PreviewBatchResult[] | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showTour, setShowTour] = useState(false)
  const [carouselKey, setCarouselKey] = useState(0)
  const [carouselVisible, setCarouselVisible] = useState(true)
  const [imageSource, setImageSource] = useState<'auto' | 'unsplash' | 'pexels' | 'both'>('auto')
  const [showStagingOverlay, setShowStagingOverlay] = useState(false)
  const stagingAbortRef = useRef<AbortController | null>(null)
  const stagingOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Usage query
  const { data: usageInfo } = useQuery<UsageInfo>({
    queryKey: ['usage'],
    queryFn: getUsage,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const trialExpired = usageInfo?.trial_expired === true
  // 'auto' = Pexels (best default); translate before sending to API
  const resolvedSource = imageSource === 'auto' ? 'pexels' : imageSource

  // Auto-start tour on first visit
  useEffect(() => {
    if (!localStorage.getItem(TOUR_STORAGE_KEY)) {
      const t = setTimeout(() => setShowTour(true), 800)
      return () => clearTimeout(t)
    }
  }, [])

  // Auto-show layered tour on first visit to the Layered tab
  useEffect(() => {
    if (contentMode === 'layered' && !localStorage.getItem(LAYERED_TOUR_KEY)) {
      const t = setTimeout(() => setShowLayeredTour(true), 400)
      return () => clearTimeout(t)
    }
  }, [contentMode])

  // Browser tab title: show pending job count while running
  useEffect(() => {
    document.title = pendingCount > 0
      ? `(${pendingCount}) PassiveClip`
      : 'PassiveClip'
    return () => { document.title = 'PassiveClip' }
  }, [pendingCount])

  // Click-outside handler for gen dropdown
  function addToast(message: string, duration = 5000) {
    const id = crypto.randomUUID()
    setToasts(prev => [...prev, { id, message, duration }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
  }

  function dismissToast(id: string) {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  // Allow JobPanel (no addToast prop) to fire toasts via DOM event
  useEffect(() => {
    function onCogitoToast(e: Event) {
      const { message, duration } = (e as CustomEvent<{ message: string; duration?: number }>).detail
      addToast(message, duration)
    }
    window.addEventListener('cogito:toast', onCogitoToast)
    return () => window.removeEventListener('cogito:toast', onCogitoToast)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist active jobs + minimized state across page refreshes
  useEffect(() => {
    try { localStorage.setItem('cogito_active_jobs', JSON.stringify(activeJobs)) } catch { /* ignore */ }
    activeJobsRef.current = activeJobs
  }, [activeJobs])

  useEffect(() => {
    try { localStorage.setItem('cogito_minimized_jobs', JSON.stringify([...minimizedJobs])) } catch { /* ignore */ }
  }, [minimizedJobs])

  // Auto-compute max_per_query so at least 75% of the target image count is reachable.
  // Only updates when the user hasn't manually overridden (tracked via autoMaxPerQuery ref).
  const autoMaxPerQueryRef = useRef<number>(DEFAULT_SETTINGS.max_per_query)
  useEffect(() => {
    const totalTerms = batches.reduce((sum, b) => sum + b.terms.length, 0)
    if (totalTerms === 0) return
    const targetImages = Math.ceil(settings.total_seconds / settings.seconds_per_image)
    const needed = Math.ceil(targetImages * 0.75)
    const auto = Math.min(30, Math.max(3, Math.ceil(needed / totalTerms)))
    if (auto !== autoMaxPerQueryRef.current) {
      autoMaxPerQueryRef.current = auto
      setSettings(prev => ({ ...prev, max_per_query: auto }))
    }
  }, [batches, settings.total_seconds, settings.seconds_per_image])

  // Browser notifications
  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }
  function notifyJobDone(name: string) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    new Notification('PassiveClip', { body: `${name} is ready to download`, icon: '/logo.png' })
  }

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
    if (submittingRef.current) return
    if (trialExpired) {
      setError('Your trial has ended. Upgrade to continue generating.')
      return
    }
    const validBatches = batches.filter(b => b.terms.length > 0)
    if (validBatches.length === 0) {
      setError('Enter at least one search term.')
      return
    }
    requestNotificationPermission()
    setError(null)
    submittingRef.current = true
    setSubmitting(true)
    setPendingCount(prev => prev + validBatches.length)
    try {
      const submitted: { jobId: string; title: string | null }[] = []
      for (const batch of validBatches) {
        const effectiveTheme = batch.color_theme ?? settings.color_theme
        const effectiveGradeParams = effectiveTheme === 'custom'
          ? (batch.custom_grade_params ?? settings.custom_grade_params)
          : undefined
        const effectiveAccent = batch.accent_folder_override !== undefined
          ? batch.accent_folder_override
          : accentFolder
        const res = await generateVideo({
          search_terms: batch.terms,
          ...settings,
          color_theme: effectiveTheme,
          custom_grade_params: effectiveGradeParams,
          batch_title: batch.title,
          uploaded_image_paths: batch.uploaded_image_paths?.length ? batch.uploaded_image_paths : undefined,
          preset_name: appliedPresetName ?? undefined,
          accent_folder: effectiveAccent ?? undefined,
          philosopher: batch.philosopher ?? undefined,
          philosopher_count: batch.philosopher_count,
          grade_philosopher: batch.grade_philosopher || undefined,
          philosopher_is_user: batch.philosopher_is_user || undefined,
          image_source: resolvedSource,
          text_overlay: batch.text_overlay ?? undefined,
          ai_voiceover: batch.ai_voiceover ?? undefined,
        })
        submitted.push({ jobId: res.job_id, title: batch.title })
      }
      setActiveJobs(prev => [...submitted, ...prev])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setPendingCount(0)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }, [batches, settings, trialExpired, appliedPresetName, accentFolder, resolvedSource])

  const handleGenerateVariants = useCallback(async () => {
    if (submittingRef.current) return
    if (trialExpired) {
      setError('Your trial has ended. Upgrade to continue generating.')
      return
    }
    const validBatches = batches.filter(b => b.terms.length > 0)
    if (validBatches.length === 0) {
      setError('Enter at least one search term.')
      return
    }
    if (checkedThemes.size === 0) {
      setError('Select at least one theme variant.')
      return
    }
    requestNotificationPermission()
    setError(null)
    submittingRef.current = true
    setSubmitting(true)
    const themesToRun = VARIANT_THEMES.filter(t => checkedThemes.has(t.value))
    // totalJobs varies per batch when a batch has its own theme not already in the checked set
    const totalJobs = validBatches.reduce((sum, batch) => {
      const hasExtra = batch.color_theme && !checkedThemes.has(batch.color_theme)
      return sum + themesToRun.length + (hasExtra ? 1 : 0)
    }, 0)
    setPendingCount(prev => prev + totalJobs)
    try {
      const submitted: { jobId: string; title: string | null }[] = []
      for (const batch of validBatches) {
        setVariantStatus(batch.title ? `Queuing variants for "${batch.title}"…` : 'Queuing variants…')
        // Include the batch's own theme override as an extra variant if not already checked
        const batchExtra = (batch.color_theme && !checkedThemes.has(batch.color_theme))
          ? (VARIANT_THEMES.find(t => t.value === batch.color_theme) ?? { value: batch.color_theme, label: batch.color_theme })
          : null
        const effectiveThemes = batchExtra ? [...themesToRun, batchExtra] : themesToRun
        const res = await generateVariants({
          search_terms: batch.terms,
          resolution: settings.resolution,
          seconds_per_image: settings.seconds_per_image,
          total_seconds: settings.total_seconds,
          fps: settings.fps,
          allow_repeats: settings.allow_repeats,
          max_per_query: settings.max_per_query,
          batch_title: batch.title ?? null,
          themes: effectiveThemes.map(t => t.value),
        })
        res.job_ids.forEach((jobId, i) => {
          const theme = effectiveThemes[i]
          const title = batch.title ? `${batch.title} · ${theme.label}` : theme.label
          submitted.push({ jobId, title })
        })
      }
      setActiveJobs(prev => [...submitted, ...prev])
      setShowVariants(false)
      setShowVariantsConfirm(false)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setPendingCount(0)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
      setVariantStatus(null)
    }
  }, [batches, settings, checkedThemes, trialExpired])

  const handleStagePreview = useCallback(async () => {
    const validBatches = batches.filter(b => b.terms.length > 0)
    if (validBatches.length === 0) {
      if (contentMode === 'layered') setLayeredError('Enter at least one search term.')
      else setError('Enter at least one search term.')
      return
    }
    setError(null)
    setLayeredError(null)
    setStagingError(null)
    setStagingUsedPexels(false)
    setStaging(true)
    const abort = new AbortController()
    stagingAbortRef.current = abort
    try {
      const res = await stagePreview({
        batches: validBatches.map(b => {
          const effectiveTheme = b.color_theme ?? settings.color_theme
          const effectiveGradeParams = effectiveTheme === 'custom'
            ? (b.custom_grade_params ?? settings.custom_grade_params)
            : undefined
          return {
            search_terms: b.terms,
            batch_title: b.title,
            uploaded_image_paths: b.uploaded_image_paths?.length ? b.uploaded_image_paths : undefined,
            color_theme: effectiveTheme,
            custom_grade_params: effectiveGradeParams as Record<string, number> | undefined,
            philosopher: b.philosopher ?? undefined,
            grade_philosopher: b.grade_philosopher,
            philosopher_is_user: b.philosopher_is_user,
          }
        }),
        resolution: settings.resolution,
        seconds_per_image: settings.seconds_per_image,
        total_seconds: settings.total_seconds,
        max_per_query: settings.max_per_query,
        color_theme: settings.color_theme,
        image_source: resolvedSource,
      }, abort.signal)
      if (res.pexels_fallback) setStagingUsedPexels(true)
      setPreviewData(res.batches)
    } catch (e: unknown) {
      if ((e as { name?: string }).name !== 'AbortError') {
        setStagingError(e instanceof Error ? e.message : 'Staging failed')
      }
    } finally {
      stagingAbortRef.current = null
      setStaging(false)
    }
  }, [batches, settings, resolvedSource, contentMode])

  const handlePreviewConfirm = useCallback(async (confirmedBatches: ConfirmedBatch[]) => {
    setPreviewData(null)
    const eligible = confirmedBatches.filter(b => b.images.length > 0)
    if (eligible.length === 0) return
    if (contentMode === 'layered') {
      const missingBg = eligible.find(b => {
        const originalBatch = batches.find(ob => ob.title === b.batch_title)
        return !(originalBatch?.layered_background_video_urls?.length)
      })
      if (missingBg) {
        setLayeredError(`Select at least one background video for ${missingBg.batch_title?.trim() || 'each layered batch'}.`)
        return
      }
    }
    if (contentMode === 'layered') setLayeredError(null)
    else setError(null)
    setSubmitting(true)
    setPendingCount(prev => prev + eligible.length)
    try {
      const submitted: { jobId: string; title: string | null }[] = []
      for (const batch of eligible) {
        const originalBatch = batches.find(b => b.title === batch.batch_title)
        const effectiveAccent = originalBatch?.accent_folder_override !== undefined
          ? originalBatch.accent_folder_override
          : accentFolder
        const reqBase = {
          search_terms: batch.search_terms,
          ...settings,
          color_theme: 'none' as const,
          batch_title: batch.batch_title,
          uploaded_image_paths: batch.images.map(img => img.storage_path),
          uploaded_only: true,
          accent_folder: effectiveAccent ?? undefined,
          philosopher: originalBatch?.philosopher ?? undefined,
          philosopher_count: originalBatch?.philosopher_count,
          grade_philosopher: originalBatch?.grade_philosopher || undefined,
          philosopher_is_user: originalBatch?.philosopher_is_user || undefined,
          preset_name: appliedPresetName ?? undefined,
          image_source: resolvedSource,
          text_overlay: originalBatch?.text_overlay ?? undefined,
          ai_voiceover: originalBatch?.ai_voiceover ?? undefined,
        }
        const res = contentMode === 'layered'
          ? await generateVideo({
              ...reqBase,
              layered_config: {
                background_video_urls: originalBatch?.layered_background_video_urls ?? [],
                foreground_opacity: layeredConfig.opacity,
                foreground_speed: settings.seconds_per_image,
                grade_target: layeredConfig.gradeTarget,
                crossfade_duration: layeredConfig.crossfadeDuration,
              },
            })
          : await generateVideo(reqBase)
        submitted.push({ jobId: res.job_id, title: batch.batch_title })
      }
      setActiveJobs(prev => [...submitted, ...prev])
    } catch (e: unknown) {
      if (contentMode === 'layered') setLayeredError(e instanceof Error ? e.message : 'Unknown error')
      else setError(e instanceof Error ? e.message : 'Unknown error')
      setPendingCount(0)
    } finally {
      setSubmitting(false)
    }
  }, [settings, batches, accentFolder, appliedPresetName, resolvedSource, contentMode, layeredConfig])

  // Ctrl/Cmd+Enter to generate
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && !submitting && !layeredSubmitting) {
        if (contentMode === 'layered') handleGenerateLayered()
        else handleGenerate()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleGenerate, submitting, layeredSubmitting, contentMode])

  function handleJobDone(job: JobStatus) {
    setPendingCount(prev => Math.max(0, prev - 1))
    setCompletedJobIds(prev => new Set([...prev, job.job_id]))

    // Only notify once per job across page refreshes
    const NOTIFIED_KEY = 'cogito_notified_jobs'
    let notified: string[] = []
    try { notified = JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '[]') } catch { /* ignore */ }
    if (notified.includes(job.job_id)) return
    try { localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...notified, job.job_id])) } catch { /* ignore */ }

    const name = job.batch_title || 'Video'
    addToast(`✅ ${name} ready. Download below`)
    notifyJobDone(name)
  }

  async function handleRetry(job: JobStatus) {
    if (!job.search_terms?.length) return
    try {
      const res = await generateVideo({
        search_terms: job.search_terms,
        resolution: job.resolution ?? undefined,
        seconds_per_image: job.seconds_per_image ?? undefined,
        total_seconds: job.total_seconds ?? undefined,
        fps: job.fps ?? undefined,
        allow_repeats: job.allow_repeats ?? undefined,
        color_theme: job.color_theme ?? undefined,
        max_per_query: job.max_per_query ?? undefined,
        batch_title: job.batch_title ?? undefined,
        preset_name: job.preset_name ?? undefined,
        custom_grade_params: job.custom_grade_params ?? undefined,
        ai_voiceover: job.ai_voiceover ?? undefined,
      })
      setPendingCount(prev => prev + 1)
      setActiveJobs(prev => [{ jobId: res.job_id, title: job.batch_title ?? null }, ...prev])
      dismissJob(job.job_id)
    } catch (e: unknown) {
      addToast(`❌ Retry failed: ${e instanceof Error ? e.message : 'Unknown error'}`)
    }
  }

  const handleEditImages = useCallback(async (terms: string[], batchTitle: string | null) => {
    setError(null)
    setStagingError(null)
    setStagingUsedPexels(false)
    setStaging(true)
    const abort = new AbortController()
    stagingAbortRef.current = abort
    try {
      const res = await stagePreview({
        batches: [{ search_terms: terms, batch_title: batchTitle, uploaded_image_paths: undefined }],
        resolution: settings.resolution,
        seconds_per_image: settings.seconds_per_image,
        total_seconds: settings.total_seconds,
        max_per_query: settings.max_per_query,
        color_theme: settings.color_theme,
        image_source: resolvedSource,
      }, abort.signal)
      if (res.pexels_fallback) setStagingUsedPexels(true)
      setPreviewData(res.batches)
    } catch (e: unknown) {
      if ((e as { name?: string }).name !== 'AbortError') {
        setStagingError(e instanceof Error ? e.message : 'Staging failed')
      }
    } finally {
      stagingAbortRef.current = null
      setStaging(false)
    }
  }, [settings, resolvedSource])

  function handleReuse(title: string | null, terms: string[], restoredSettings: Partial<VideoSettings> | null) {
    setPendingReuse({ title, terms })
    if (restoredSettings) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { color_theme: _ct, ...rest } = restoredSettings
      setSettings(prev => ({ ...prev, ...rest }))
    }
  }

  const handleColourGrade = useCallback(async (
    terms: string[],
    batchTitle: string | null,
    restoredSettings: Partial<VideoSettings> | null,
    theme: string,
  ) => {
    if (trialExpired) { setError('Your trial has ended. Upgrade to continue generating.'); return }
    if (terms.length === 0) { setError('No search terms found for this job.'); return }
    setError(null)
    setSubmitting(true)
    setPendingCount(prev => prev + 1)
    try {
      const merged = { ...settings, ...(restoredSettings ?? {}), color_theme: theme }
      const res = await generateVideo({
        search_terms: terms,
        ...merged,
        batch_title: batchTitle ? `${batchTitle} · ${theme}` : theme,
        image_source: resolvedSource,
        ai_voiceover: undefined,
      })
      setActiveJobs(prev => [{ jobId: res.job_id, title: batchTitle ? `${batchTitle} · ${theme}` : theme }, ...prev])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Unknown error')
      setPendingCount(0)
    } finally {
      setSubmitting(false)
    }
  }, [settings, trialExpired, resolvedSource])


  async function handleRegrade(newJobId: string, title: string | null) {
    setPendingCount(prev => prev + 1)
    setActiveJobs(prev => [{ jobId: newJobId, title }, ...prev])
  }

  function getValidClipBatches() {
    return batches.filter(b => b.terms.length > 0)
  }

  function getClipBatchTitle(batch: BatchOutput) {
    return batch.title?.trim() || batch.terms.join(', ') || 'Video Clips'
  }

  function getClipBatchTheme(batch: BatchOutput) {
    return batch.color_theme ?? clipsSettings.color_theme
  }

  function getClipBatchOverlay(batch: BatchOutput) {
    const overlay = batch.text_overlay
    return overlay?.enabled && overlay.text.trim() ? overlay : null
  }

  async function handleSearchClips() {
    const validBatches = getValidClipBatches()
    if (validBatches.length === 0) { setClipsError('Enter at least one search term.'); return }
    if (validBatches.length > 1) {
      setClipsError('Preview & select currently supports one clip batch at a time. Use Generate directly for multiple batches.')
      return
    }
    const batch = validBatches[0]
    setClipsError(null)
    setClipsSearching(true)
    setFetchedClips(null)
    setSelectedClips([])
    setClipPreviewBatch(batch)
    try {
      const res = await fetchVideoClips(batch.terms, clipsSettings.clips_per_term, getClipBatchTheme(batch))
      setFetchedClips(res.clips)
      setSelectedClips(res.clips.map(c => ({
        id: c.id,
        download_url: c.download_url,
        preview_url: c.preview_url,
        thumbnail: c.thumbnail,
        duration: c.duration,
        trim_start: 0,
        trim_end: 0,
      })))
    } catch (e: unknown) {
      setClipPreviewBatch(null)
      setClipsError(e instanceof Error ? e.message : 'Clip search failed')
    } finally {
      setClipsSearching(false)
    }
  }

  async function handleGenerateClips(clips: SelectedClip[]) {
    if (clips.length === 0) { setClipsError('Select at least one clip.'); return }
    if (trialExpired) { setClipsError('Your trial has ended. Upgrade to continue generating.'); return }
    if (!clipPreviewBatch) { setClipsError('No clip batch selected for generation.'); return }
    setClipsError(null)
    setClipsGenerating(true)
    setPendingCount(prev => prev + 1)
    try {
      const batchTitle = getClipBatchTitle(clipPreviewBatch)
      const res = await generateFromClips({
        clips: clips.map(c => ({
          id: c.id,
          download_url: c.download_url,
          trim_start: c.trim_start,
          trim_end: c.trim_end,
          duration: c.duration,
        })),
        resolution: clipsSettings.resolution,
        fps: clipsSettings.fps,
        color_theme: getClipBatchTheme(clipPreviewBatch),
        transition: clipsSettings.transition,
        transition_duration: clipsSettings.transition_duration,
        max_clip_duration: clipsSettings.max_clip_duration,
        batch_title: batchTitle,
        text_overlay: getClipBatchOverlay(clipPreviewBatch),
        ai_voiceover: clipPreviewBatch.ai_voiceover ?? undefined,
      })
      setActiveJobs(prev => [{ jobId: res.job_id, title: batchTitle }, ...prev])
      setFetchedClips(null)
      setSelectedClips([])
      setClipPreviewBatch(null)
    } catch (e: unknown) {
      setClipsError(e instanceof Error ? e.message : 'Unknown error')
      setPendingCount(prev => Math.max(0, prev - 1))
    } finally {
      setClipsGenerating(false)
    }
  }

  async function handleAutoGenerateClips() {
    const validBatches = getValidClipBatches()
    if (validBatches.length === 0) { setClipsError('Enter at least one search term.'); return }
    if (trialExpired) { setClipsError('Your trial has ended. Upgrade to continue generating.'); return }
    setClipsError(null)
    setClipsSearching(true)
    setPendingCount(prev => prev + validBatches.length)
    try {
      const submitted: { jobId: string; title: string | null }[] = []
      for (const batch of validBatches) {
        const res = await fetchVideoClips(batch.terms, clipsSettings.clips_per_term, getClipBatchTheme(batch))
        const clips: SelectedClip[] = res.clips.map(c => ({
          id: c.id,
          download_url: c.download_url,
          preview_url: c.preview_url,
          thumbnail: c.thumbnail,
          duration: c.duration,
          trim_start: 0,
          trim_end: 0,
        }))
        const title = getClipBatchTitle(batch)
        const job = await generateFromClips({
          clips: clips.map(c => ({
            id: c.id,
            download_url: c.download_url,
            trim_start: c.trim_start,
            trim_end: c.trim_end,
            duration: c.duration,
          })),
          resolution: clipsSettings.resolution,
          fps: clipsSettings.fps,
          color_theme: getClipBatchTheme(batch),
          transition: clipsSettings.transition,
          transition_duration: clipsSettings.transition_duration,
          max_clip_duration: clipsSettings.max_clip_duration,
          batch_title: title,
          text_overlay: getClipBatchOverlay(batch),
          ai_voiceover: batch.ai_voiceover ?? undefined,
        })
        submitted.push({ jobId: job.job_id, title: batch.title })
      }
      setActiveJobs(prev => [...submitted, ...prev])
      setFetchedClips(null)
      setSelectedClips([])
      setClipPreviewBatch(null)
      setClipsSearching(false)
    } catch (e: unknown) {
      setClipsError(e instanceof Error ? e.message : 'Clip search failed')
      setPendingCount(prev => Math.max(0, prev - validBatches.length))
      setClipsSearching(false)
    }
  }

  async function handleGenerateLayered() {
    if (submittingRef.current) return
    if (trialExpired) {
      setLayeredError('Your trial has ended. Upgrade to continue generating.')
      return
    }
    const validBatches = batches.filter(b => b.terms.length > 0)
    if (validBatches.length === 0) {
      setLayeredError('Enter at least one search term.')
      return
    }
    const missingBgBatch = validBatches.find(b => !(b.layered_background_video_urls?.length))
    if (missingBgBatch) {
      setLayeredError(`Select at least one background video for ${missingBgBatch.title?.trim() || 'each layered batch'}.`)
      return
    }
    setLayeredError(null)
    submittingRef.current = true
    setLayeredSubmitting(true)
    setPendingCount(prev => prev + validBatches.length)
    try {
      const submitted: { jobId: string; title: string | null }[] = []
      for (const batch of validBatches) {
        const effectiveTheme = batch.color_theme ?? settings.color_theme
        const effectiveGradeParams = effectiveTheme === 'custom'
          ? (batch.custom_grade_params ?? settings.custom_grade_params)
          : undefined
        const effectiveAccent = batch.accent_folder_override !== undefined
          ? batch.accent_folder_override
          : accentFolder
        const lc: LayeredConfig = {
          background_video_urls: batch.layered_background_video_urls ?? [],
          foreground_opacity: layeredConfig.opacity,
          foreground_speed: settings.seconds_per_image,
          grade_target: layeredConfig.gradeTarget,
          crossfade_duration: layeredConfig.crossfadeDuration,
        }
        const res = await generateVideo({
          search_terms: batch.terms,
          ...settings,
          color_theme: effectiveTheme,
          custom_grade_params: effectiveGradeParams,
          batch_title: batch.title,
          accent_folder: effectiveAccent ?? undefined,
          image_source: resolvedSource,
          text_overlay: batch.text_overlay ?? undefined,
          ai_voiceover: batch.ai_voiceover ?? undefined,
          layered_config: lc,
        })
        submitted.push({ jobId: res.job_id, title: batch.title })
      }
      setActiveJobs(prev => [...submitted, ...prev])
    } catch (e: unknown) {
      setLayeredError(e instanceof Error ? e.message : 'Unknown error')
      setPendingCount(0)
    } finally {
      submittingRef.current = false
      setLayeredSubmitting(false)
    }
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
  const themesToRun = VARIANT_THEMES.filter(t => checkedThemes.has(t.value))
  const variantJobCount = batches.filter(b => b.terms.length > 0).reduce((sum, batch) => {
    const hasExtra = batch.color_theme && !checkedThemes.has(batch.color_theme)
    return sum + themesToRun.length + (hasExtra ? 1 : 0)
  }, 0)

  return (
    <div className="min-h-screen bg-stone-950">
      {DEV_BYPASS && (
        <div className="bg-amber-900/60 border-b border-amber-700 px-4 py-1.5 text-center text-xs text-amber-300">
          Dev bypass active — remove <code className="font-mono">VITE_DEV_BYPASS</code> from .env.local before deploying
        </div>
      )}

      <AppNavbar session={session} activeTool="video" onShowTour={() => setShowTour(true)} />

      {carouselVisible ? (
        <InspirationCarousel
          key={carouselKey}
          onApply={(theme, bundles, appliedAccent, customGradeParams) => {
            if (bundles.length > 0) {
              // Embed theme/accent as per-batch overrides on the new cards
              setPendingBundles(bundles.map(b => ({
                ...b,
                colorTheme: theme,
                customGradeParams: customGradeParams ?? undefined,
                accentFolder: appliedAccent ?? null,
              })))
            } else {
              // No bundle (e.g. Gothic) — apply globally as fallback
              setSettings(prev => ({ ...prev, color_theme: theme, custom_grade_params: customGradeParams ?? undefined }))
              setAccentFolder(appliedAccent ?? null)
            }
          }}
          onHide={() => setCarouselVisible(false)}
        />
      ) : (
        <button
          onClick={() => {
            setCarouselKey(k => k + 1)
            setCarouselVisible(true)
          }}
          className="w-full border-b border-stone-700 bg-stone-900 px-4 py-2.5 flex items-center justify-between hover:bg-stone-800 transition group"
        >
          <span className="text-xs font-medium text-stone-400 group-hover:text-stone-200 transition flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 10h16M4 14h8" />
            </svg>
            Style templates
          </span>
          <svg className="w-3.5 h-3.5 text-stone-500 group-hover:text-stone-300 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      )}

      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

          {/* Left column: batch editor + settings + generate */}
          <div className="lg:col-span-2">

            {/* Mode tabs */}
            <div className="flex gap-1 mb-5 border-b border-stone-800">
              <button
                onClick={() => setContentMode('images')}
                className={`px-4 py-2 text-sm font-medium transition border-b-2 -mb-px ${
                  contentMode === 'images'
                    ? 'border-brand-500 text-brand-400'
                    : 'border-transparent text-stone-500 hover:text-stone-300'}`}
              >
                Images
              </button>
              <button
                onClick={() => setContentMode('clips')}
                className={`px-4 py-2 text-sm font-medium transition border-b-2 -mb-px ${
                  contentMode === 'clips'
                    ? 'border-brand-500 text-brand-400'
                    : 'border-transparent text-stone-500 hover:text-stone-300'}`}
              >
                Video Clips
              </button>
              <button
                onClick={() => setContentMode('layered')}
                className={`px-4 py-2 text-sm font-bold transition border-b-2 -mb-px flex items-center gap-1.5 ${
                  contentMode === 'layered'
                    ? 'border-brand-500 text-brand-400'
                    : 'border-transparent text-stone-500 hover:text-stone-300'}`}
              >
                Layered
                <span className="rounded bg-brand-500/20 px-1 py-0.5 text-[8px] font-bold text-brand-400 tracking-wider leading-none">★ NEW</span>
              </button>
            </div>

            {/* Layered tour banner — always visible when in layered mode */}
            {contentMode === 'layered' && (
              <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 px-4 py-3 mb-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-stone-200">Layered rendering</p>
                  <p className="text-[11px] text-stone-500 mt-0.5">Composite your images over a looping background video</p>
                </div>
                <button
                  onClick={() => setShowLayeredTour(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-1.5 text-xs font-medium text-brand-400 hover:bg-brand-500/20 hover:border-brand-500/50 transition shrink-0"
                >
                  <svg className="w-3 h-3" viewBox="0 0 12 12" fill="currentColor">
                    <path d="M2 2l8 4-8 4z"/>
                  </svg>
                  Take a tour
                </button>
              </div>
            )}

            {/* Step 1 */}
            <div className="flex items-center gap-2 mb-2">
              <span className="rounded bg-brand-500/20 px-2 py-0.5 text-[10px] font-bold text-brand-400 tracking-wider">STEP 1</span>
              <span className="text-xs text-stone-500">Search terms</span>
            </div>

            {(contentMode === 'images' || contentMode === 'layered' || contentMode === 'clips') && (
              <div className="rounded-2xl border border-stone-800 bg-stone-900 p-6" data-tour="batch-editor">
                {contentMode === 'clips' ? (
                  <>
                    <ClipBundles
                      onLoad={terms => setPendingBundles([{ title: null, terms }])}
                      disabled={clipsSearching || clipsGenerating}
                    />
                    <p className="text-xs text-stone-500 mb-3">
                      Use one batch per clip video. Per-batch style overrides include colour theme and text overlay.
                    </p>
                  </>
                ) : (
                  <>
                    <TermBundles onLoad={bundles => setPendingBundles(bundles)} />
                    <hr className="border-stone-800 my-4" />
                  </>
                )}
                <BatchEditor
                  onBatchesChange={setBatches}
                  pendingReuse={pendingReuse}
                  onReuseHandled={() => setPendingReuse(null)}
                  pendingBundles={pendingBundles}
                  onBundlesHandled={() => setPendingBundles(null)}
                  onOpenPrompt={() => setShowPromptModal(true)}
                  mode={contentMode}
                />
              </div>
            )}

            {/* Clip preview grid — shown between Step 1 and Step 2 in clips mode */}
            {contentMode === 'clips' && fetchedClips && (
              <div className="rounded-2xl border border-stone-800 bg-stone-900 p-4 mt-4">
                {clipPreviewBatch && (
                  <p className="text-xs text-stone-500 mb-3">
                    Previewing clips for <span className="text-stone-300">{getClipBatchTitle(clipPreviewBatch)}</span>.
                  </p>
                )}
                <ClipPreviewGrid
                  clips={fetchedClips}
                  selected={selectedClips}
                  onSelectionChange={setSelectedClips}
                  onGenerate={handleGenerateClips}
                  generating={clipsGenerating}
                  maxClipDuration={clipsSettings.max_clip_duration}
                />
              </div>
            )}

            {/* Step 2 */}
            <div className="flex items-center gap-2 mb-2 mt-6">
              <span className="rounded bg-brand-500/20 px-2 py-0.5 text-[10px] font-bold text-brand-400 tracking-wider">STEP 2</span>
              <span className="text-xs text-stone-500">Video settings</span>
            </div>
            <div className="rounded-2xl border border-stone-800 bg-stone-900 p-6" data-tour="theme-selector">
              {contentMode === 'clips' ? (
                <ClipsSettingsPanel
                  settings={clipsSettings}
                  onChange={setClipsSettings}
                />
              ) : (
                <>
                  <SettingsPanel
                    settings={settings}
                    onChange={s => { setSettings(s); setAppliedPresetName(null) }}
                    onPresetApplied={setAppliedPresetName}
                    themeDisabled={batches.length > 0 && batches.every(b => b.color_theme !== undefined)}
                  />
                  {contentMode === 'layered' && (
                    <div className="mt-4 pt-4 border-t border-stone-800" data-tour="layered-opacity">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-stone-300">Foreground image opacity</span>
                        <span className="text-xs tabular-nums text-stone-400">{Math.round(layeredConfig.opacity * 100)}%</span>
                      </div>
                      <div className="flex gap-1.5 mb-3">
                        {OPACITY_PRESETS.map(p => (
                          <button
                            key={p.label}
                            onClick={() => setLayeredConfig(c => ({ ...c, opacity: p.value }))}
                            className={`flex-1 rounded-lg py-1.5 text-[11px] font-medium transition ${
                              Math.abs(layeredConfig.opacity - p.value) < 0.01
                                ? 'bg-brand-500/20 border border-brand-500/50 text-brand-300'
                                : 'bg-stone-800 border border-stone-700 text-stone-400 hover:border-stone-500 hover:text-stone-200'
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                      <input
                        type="range"
                        min={0} max={1} step={0.05}
                        value={layeredConfig.opacity}
                        onChange={e => setLayeredConfig(c => ({ ...c, opacity: parseFloat(e.target.value) }))}
                        className="w-full accent-amber-500"
                      />
                      <div className="mt-4">
                        <span className="text-xs font-medium text-stone-300 block mb-2">Apply colour grade to</span>
                        <div className="grid grid-cols-3 gap-1.5">
                          {(['foreground', 'background', 'both'] as const).map(t => (
                            <button
                              key={t}
                              onClick={() => setLayeredConfig(c => ({ ...c, gradeTarget: t }))}
                              className={`rounded-lg py-2 text-xs font-medium transition capitalize ${
                                layeredConfig.gradeTarget === t
                                  ? 'bg-brand-500/20 border border-brand-500/50 text-brand-300'
                                  : 'bg-stone-800 border border-stone-700 text-stone-400 hover:border-stone-500 hover:text-stone-200'
                              }`}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] text-stone-600 mt-1.5">
                          {layeredConfig.gradeTarget === 'foreground' && 'Images are graded; background video stays natural.'}
                          {layeredConfig.gradeTarget === 'background' && 'Background video is graded; foreground images stay natural.'}
                          {layeredConfig.gradeTarget === 'both' && 'Both foreground images and background video are graded.'}
                        </p>
                      </div>
                      <p className="text-[10px] text-stone-600 mt-4">
                        Background videos are now selected per batch in Step 1.
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Step 3 */}
            <div className="flex items-center gap-2 mb-2 mt-6">
              <span className="rounded bg-brand-500/20 px-2 py-0.5 text-[10px] font-bold text-brand-400 tracking-wider">STEP 3</span>
              <span className="text-xs text-stone-500">Generate</span>
            </div>

            {(contentMode === 'images'
              ? (error || stagingError)
              : contentMode === 'layered'
                ? (layeredError || stagingError)
                : clipsError) && (
              <div className="rounded-xl bg-red-950 px-4 py-3 text-sm text-red-400 mb-3">
                {contentMode === 'images'
                  ? (error ?? stagingError)
                  : contentMode === 'layered'
                    ? (layeredError ?? stagingError)
                    : clipsError}
              </div>
            )}

            {(contentMode === 'images' || contentMode === 'layered') && stagingUsedPexels && !stagingError && (
              <div className="rounded-xl bg-amber-950/60 border border-amber-700/50 px-4 py-2.5 text-xs text-amber-300 mb-3 flex items-center gap-2">
                <span>⚡</span>
                <span>Unsplash rate limit hit. Switched to Pexels for this preview.</span>
              </div>
            )}

            {/* Action row */}
            {contentMode === 'layered' ? (
              <div data-tour="layered-generate" className="flex gap-2">
                <button
                  onClick={handleStagePreview}
                  disabled={submitting || staging || trialExpired}
                  className="flex-1 rounded-xl border border-stone-700 py-3 text-sm font-medium text-stone-300 hover:border-stone-500 hover:text-stone-100 disabled:opacity-50 transition"
                >
                  {staging ? 'Fetching images…' : 'Preview images →'}
                </button>
                <button
                  onClick={handleGenerateLayered}
                  disabled={layeredSubmitting || submitting || staging || batchCount === 0 || trialExpired}
                  className="flex-1 rounded-xl bg-brand-500 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 transition"
                >
                  {layeredSubmitting || submitting ? 'Submitting…'
                    : batchCount === 0 ? 'Add a layered batch first'
                    : batchCount > 1 ? `Generate Layered ×${batchCount}` : 'Generate Layered'}
                </button>
              </div>
            ) : contentMode === 'clips' ? (
              <div className="flex gap-2">
                <button
                  onClick={handleAutoGenerateClips}
                  disabled={clipsSearching || clipsGenerating || trialExpired}
                  className="flex-1 rounded-xl bg-brand-500 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 transition"
                >
                  {clipsSearching ? 'Searching…' : clipsGenerating ? 'Generating…' : 'Generate directly'}
                </button>
                <button
                  onClick={handleSearchClips}
                  disabled={clipsSearching || clipsGenerating || batchCount !== 1}
                  className="flex-1 rounded-xl border border-stone-700 py-3 text-sm font-medium text-stone-300 hover:border-stone-500 hover:text-stone-100 disabled:opacity-50 transition"
                  title={batchCount !== 1 ? 'Preview & select supports one clip batch at a time' : undefined}
                >
                  {clipsSearching ? 'Searching…' : 'Preview & select clips →'}
                </button>
              </div>
            ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAdvanced(true)}
                className="rounded-xl border border-stone-700 px-4 py-3 text-stone-400 hover:border-stone-500 hover:text-stone-200 transition shrink-0"
                title="Advanced settings"
                data-tour="advanced-btn"
              >
                ⚙
              </button>

              <button
                onClick={() => { setShowVariants(v => !v); setShowVariantsConfirm(false) }}
                disabled={submitting || staging}
                data-tour="variants-btn"
                className={`rounded-xl border px-4 py-3 text-sm transition shrink-0 disabled:opacity-50 ${showVariants ? 'border-brand-500 text-brand-400' : 'border-stone-700 text-stone-400 hover:border-stone-500 hover:text-stone-200'}`}
                title="Colour variants"
              >
                🎨
              </button>

              <div className="flex-1 grid grid-cols-2 gap-2">
                <button
                  onClick={handleStagePreview}
                  disabled={submitting || staging || trialExpired}
                  data-tour="gen-dropdown"
                  className="rounded-xl border border-stone-700 py-3 text-sm font-medium text-stone-300 hover:border-stone-500 hover:text-stone-100 disabled:opacity-50 transition"
                >
                  {staging ? 'Fetching images…' : 'Preview images →'}
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={submitting || staging || trialExpired}
                  data-tour="generate-btn"
                  className="rounded-xl bg-brand-500 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 transition"
                >
                  {submitting ? 'Submitting…'
                    : batchCount > 1 ? `Generate ×${batchCount}` : 'Generate'}
                </button>
              </div>
            </div>
            )}
            {(contentMode === 'images' || contentMode === 'layered') && <p className="text-center text-xs text-stone-600 mt-2">or press Ctrl+Enter</p>}

            {/* Variants inline panel — images mode only */}
            {contentMode === 'images' && showVariants && (
              <div className="rounded-xl border border-stone-800 bg-stone-900/80 p-4 space-y-3 mt-3">
                <div className="flex items-baseline justify-between">
                  <p className="text-xs text-stone-500">Select themes (one video per theme per batch):</p>
                  {variantJobCount > 0 && (
                    <span className="text-xs text-stone-400 shrink-0 ml-3">
                      Will create <span className="text-stone-200 font-medium">{variantJobCount}</span> video{variantJobCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {VARIANT_THEMES.map(t => (
                    <button
                      key={t.value}
                      onClick={() => toggleTheme(t.value)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition ${
                        checkedThemes.has(t.value)
                          ? 'border-brand-500 bg-brand-500/10 text-stone-100'
                          : 'border-stone-700 bg-stone-800/60 text-stone-400 hover:border-stone-500 hover:text-stone-200'
                      }`}
                    >
                      <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${t.dot}`} />
                      {t.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => {
                    if (variantJobCount >= 6) {
                      setShowVariantsConfirm(true)
                    } else {
                      handleGenerateVariants()
                    }
                  }}
                  disabled={submitting || checkedThemes.size === 0 || batchCount === 0}
                  className="w-full rounded-lg bg-brand-500/20 border border-brand-500/30 py-2.5 text-xs font-semibold text-brand-300 hover:bg-brand-500/30 disabled:opacity-40 transition"
                >
                  {variantStatus ?? (submitting
                    ? 'Submitting…'
                    : `Generate ${variantJobCount} variant${variantJobCount !== 1 ? 's' : ''}`)}
                </button>

                {/* Confirmation prompt */}
                {showVariantsConfirm && (
                  <div className="rounded-lg border border-amber-800/60 bg-amber-950/40 p-3 space-y-2">
                    <p className="text-xs text-amber-300">This will create {variantJobCount} videos — continue?</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setShowVariantsConfirm(false); handleGenerateVariants() }}
                        className="flex-1 rounded-lg bg-brand-500/20 border border-brand-500/30 py-1.5 text-xs font-semibold text-brand-300 hover:bg-brand-500/30 transition"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setShowVariantsConfirm(false)}
                        className="flex-1 rounded-lg border border-stone-700 py-1.5 text-xs text-stone-400 hover:border-stone-500 hover:text-stone-200 transition"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right column: active jobs + recent jobs */}
          <div className="space-y-6">
            {trialExpired && (
              <div className="rounded-xl border border-red-900 bg-red-950/40 px-4 py-3">
                <p className="text-xs text-red-400 font-medium mb-1">Trial ended</p>
                <p className="text-xs text-stone-500 mb-2">Upgrade to keep generating videos.</p>
                <a href="/pricing" className="block w-full rounded-lg bg-brand-500 py-2 text-center text-xs font-semibold text-white hover:bg-brand-700 transition">
                  Upgrade →
                </a>
              </div>
            )}

            {staging && (
              <div>
                <h2 className="mb-3 text-sm font-semibold text-stone-300">Staging preview</h2>
                <div className="rounded-xl border border-stone-700 bg-stone-800 p-4 relative">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-stone-200">⏳ Fetching…</span>
                      <button
                        onMouseEnter={() => { if (stagingOverlayTimerRef.current) clearTimeout(stagingOverlayTimerRef.current); setShowStagingOverlay(true) }}
                        onMouseLeave={() => { stagingOverlayTimerRef.current = setTimeout(() => setShowStagingOverlay(false), 200) }}
                        className="text-stone-500 hover:text-stone-200 transition-colors focus:outline-none"
                        aria-label="Show preview steps"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                          <circle cx="8.5" cy="8.5" r="5" />
                          <line x1="13" y1="13" x2="17" y2="17" />
                        </svg>
                      </button>
                    </div>
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
                  {showStagingOverlay && (
                    <div
                      className="absolute top-full left-0 right-0 mt-2 rounded-xl border border-stone-600/80 bg-stone-900 shadow-2xl overflow-hidden z-50"
                      onMouseEnter={() => { if (stagingOverlayTimerRef.current) clearTimeout(stagingOverlayTimerRef.current) }}
                      onMouseLeave={() => { stagingOverlayTimerRef.current = setTimeout(() => setShowStagingOverlay(false), 200) }}
                    >
                      <div className="px-4 pt-3 pb-2.5 border-b border-stone-800/80">
                        <p className="text-xs font-semibold text-stone-200">Preparing your preview</p>
                        <p className="text-xs text-stone-500 mt-0.5">Images are fetched and graded. No credit used yet</p>
                      </div>
                      <div className="px-4 py-3 space-y-2.5">
                        {[
                          { emoji: '🔍', label: 'Searching for photos',  sub: 'Querying your search terms' },
                          { emoji: '📷', label: 'Downloading images',    sub: 'Saving to your preview pool' },
                          { emoji: '🎨', label: 'Applying colour grade', sub: 'Styling images to match your theme' },
                        ].map((s, i) => (
                          <div key={i} className={`flex items-center gap-3 ${i > 0 ? 'opacity-50' : ''}`}>
                            <div className="w-7 h-7 rounded-full bg-brand-500/10 flex items-center justify-center flex-shrink-0 text-sm">
                              <span className="animate-pulse">{s.emoji}</span>
                            </div>
                            <div>
                              <p className="text-xs font-medium text-stone-200">{s.label}</p>
                              <p className="text-xs text-stone-500">{s.sub}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                      {(() => {
                        const STAGING_QUOTES = [
                          { text: 'The impediment to action advances action. What stands in the way becomes the way.', author: 'Marcus Aurelius' },
                          { text: 'Begin at once to live, and count each separate day as a separate life.', author: 'Seneca' },
                          { text: 'Some things are in our control and others not.', author: 'Epictetus' },
                          { text: 'While we are postponing, life speeds by.', author: 'Seneca' },
                          { text: 'The unexamined life is not worth living.', author: 'Socrates' },
                        ]
                        const q = STAGING_QUOTES[Math.floor(Date.now() / 10000) % STAGING_QUOTES.length]
                        return (
                          <div className="px-4 pb-3 border-t border-stone-800/60 pt-2.5">
                            <p className="text-[10px] text-stone-600 leading-relaxed italic">"{q.text}"</p>
                            <p className="text-[10px] text-stone-700 mt-1">— {q.author}</p>
                          </div>
                        )
                      })()}
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeJobs.length > 0 && (
              <div>
                <div className="flex items-baseline gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-stone-300">
                    {activeJobs.length > 1 ? `Current jobs (${activeJobs.length})` : 'Current job'}
                  </h2>
                  {activeJobs.length > 1 && (() => {
                    const doneCount = activeJobs.filter(j => completedJobIds.has(j.jobId)).length
                    const maxSecs = Math.max(...activeJobs.map(j => jobEstimates[j.jobId] ?? 0))
                    if (doneCount > 0) {
                      return <span className="text-xs text-stone-500">{doneCount} / {activeJobs.length} done</span>
                    }
                    if (maxSecs > 0) {
                      const label = maxSecs < 60 ? `~${maxSecs}s` : `~${Math.ceil(maxSecs / 60)}m`
                      return <span className="text-xs text-stone-600">{label} remaining</span>
                    }
                    return null
                  })()}
                </div>
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
                      onEstimate={secs => setJobEstimates(prev => ({ ...prev, [jobId]: secs }))}
                      onRetry={handleRetry}
                      onRegraded={handleRegrade}
                      onColourGrade={handleColourGrade}
                    />
                  ))}
                </div>
              </div>
            )}

            <div>
              <h2 className="mb-3 text-sm font-semibold text-stone-300">Recent jobs</h2>
              <RecentJobs onReuse={handleReuse} onEditImages={handleEditImages} onColourGrade={handleColourGrade} onRegrade={handleRegrade} />
              <p className="mt-3 text-xs text-stone-600">
                Videos are removed after 48 hours to save space — download any you want to keep.
              </p>
            </div>
          </div>
        </div>
      </div>

      {showAdvanced && (
        <AdvancedModal
          settings={settings}
          imageSource={imageSource}
          accentFolder={accentFolder}
          autoMaxPerQuery={autoMaxPerQueryRef.current}
          onSettingsChange={s => { setSettings(s); setAppliedPresetName(null) }}
          onImageSourceChange={v => setImageSource(v)}
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
          resolution={settings.resolution}
          colorTheme={settings.color_theme}
          imageSource={resolvedSource}
        />
      )}

      <OnboardingTour
        active={showTour}
        isFirstVisit={!localStorage.getItem(TOUR_STORAGE_KEY)}
        onClose={() => setShowTour(false)}
        onOpenPrompt={() => setShowPromptModal(true)}
        onOpenVariants={() => setShowVariants(true)}
      />
      <LayeredTour active={showLayeredTour} onClose={() => setShowLayeredTour(false)} />
      {showPromptModal && <PromptModal fromTour={showTour} onClose={() => setShowPromptModal(false)} />}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
