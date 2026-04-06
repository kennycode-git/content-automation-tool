import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import AppNavbar from '../components/AppNavbar'
import {
  cancelScheduledPost,
  disconnectTikTok,
  getRecentJobs,
  getScheduledPosts,
  getTikTokAccounts,
  getTikTokAuthUrl,
  postNow,
  schedulePost,
} from '../lib/api'
import type { JobStatus, ScheduledPost, TikTokAccount } from '../lib/api'

interface Props {
  session: Session
}

const PRIVACY_OPTIONS = [
  { value: 'PUBLIC_TO_EVERYONE', label: 'Public' },
  { value: 'MUTUAL_FOLLOW_FRIENDS', label: 'Friends' },
  { value: 'FOLLOWER_OF_CREATOR', label: 'Followers' },
  { value: 'SELF_ONLY', label: 'Private' },
]

function formatScheduledAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function Schedule({ session }: Props) {
  const [searchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scheduledAtRef = useRef<HTMLInputElement>(null)

  const [selectedJobId, setSelectedJobId] = useState('')
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [caption, setCaption] = useState('')
  const [hashtagInput, setHashtagInput] = useState('')
  const [hashtags, setHashtags] = useState<string[]>([])
  const [privacyLevel, setPrivacyLevel] = useState('PUBLIC_TO_EVERYONE')
  const [scheduledAt, setScheduledAt] = useState('')
  const [scheduleTab, setScheduleTab] = useState<'upcoming' | 'history'>('upcoming')
  const [showInboxInfo, setShowInboxInfo] = useState(false)
  const [showValidation, setShowValidation] = useState(false)

  function showToast(msg: string, type: 'success' | 'error' = 'success') {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ msg, type })
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => {
    if (searchParams.get('connected') === 'true') {
      showToast('TikTok connected!', 'success')
      queryClient.invalidateQueries({ queryKey: ['tiktok-accounts'] })
    } else if (searchParams.get('error')) {
      showToast(`Connection failed: ${searchParams.get('error')}`, 'error')
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: accounts = [] } = useQuery<TikTokAccount[]>({
    queryKey: ['tiktok-accounts'],
    queryFn: getTikTokAccounts,
  })

  const { data: scheduledPosts = [] } = useQuery<ScheduledPost[]>({
    queryKey: ['scheduled-posts'],
    queryFn: getScheduledPosts,
    refetchInterval: 30_000,
  })

  const { data: recentJobs = [] } = useQuery<JobStatus[]>({
    queryKey: ['jobs'],
    queryFn: getRecentJobs,
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  })

  const doneJobs = recentJobs.filter(j => j.status === 'done' && j.output_url)

  const connectMutation = useMutation({
    mutationFn: getTikTokAuthUrl,
    onSuccess: ({ url }) => { window.location.href = url },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const disconnectMutation = useMutation({
    mutationFn: disconnectTikTok,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tiktok-accounts'] })
      showToast('Account disconnected', 'success')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const scheduleMutation = useMutation({
    mutationFn: schedulePost,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-posts'] })
      showToast('Post scheduled!', 'success')
      setSelectedJobId('')
      setCaption('')
      setHashtags([])
      setHashtagInput('')
      setScheduledAt('')
      setShowValidation(false)
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const postNowMutation = useMutation({
    mutationFn: postNow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-posts'] })
      showToast('Post sent to TikTok now!', 'success')
      setSelectedJobId('')
      setCaption('')
      setHashtags([])
      setHashtagInput('')
      setScheduledAt('')
      setShowValidation(false)
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  const cancelMutation = useMutation({
    mutationFn: cancelScheduledPost,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-posts'] })
      showToast('Post cancelled', 'success')
    },
    onError: (e: Error) => showToast(e.message, 'error'),
  })

  function handleAddHashtag(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === ',' || e.key === 'Enter') {
      e.preventDefault()
      const tag = hashtagInput.trim().replace(/^#/, '')
      if (tag && !hashtags.includes(tag)) {
        setHashtags(prev => [...prev, tag])
      }
      setHashtagInput('')
    }
  }

  function buildHashtags() {
    const pendingTag = hashtagInput.trim().replace(/^#/, '')
    return pendingTag && !hashtags.includes(pendingTag)
      ? [...hashtags, pendingTag]
      : hashtags
  }

  function openSchedulePicker() {
    const input = scheduledAtRef.current
    if (!input) return
    input.focus()
    if ('showPicker' in input) {
      try {
        input.showPicker()
      } catch {
        // ignore browser restrictions
      }
    }
  }

  function handleSchedule(draftMode: boolean) {
    const missingVideo = !selectedJobId
    const missingAccount = !selectedAccountId
    const missingSchedule = !draftMode && !scheduledAt

    if (missingVideo || missingAccount || missingSchedule) {
      setShowValidation(true)
      if (missingSchedule) openSchedulePicker()
      return
    }

    scheduleMutation.mutate({
      job_id: selectedJobId,
      tiktok_account_id: selectedAccountId,
      caption,
      hashtags: buildHashtags(),
      privacy_level: privacyLevel,
      scheduled_at: draftMode
        ? new Date().toISOString()
        : new Date(scheduledAt).toISOString(),
      draft_mode: draftMode,
    })
  }

  function handlePostNow() {
    const missingVideo = !selectedJobId
    const missingAccount = !selectedAccountId
    if (missingVideo || missingAccount) {
      setShowValidation(true)
      return
    }
    postNowMutation.mutate({
      job_id: selectedJobId,
      tiktok_account_id: selectedAccountId,
      caption,
      hashtags: buildHashtags(),
      privacy_level: privacyLevel,
    })
  }

  const upcomingPosts = scheduledPosts.filter(p => p.status === 'pending' || p.status === 'posting')
  const historyPosts = scheduledPosts.filter(
    p => p.status === 'posted' || p.status === 'failed' || p.status === 'cancelled'
  )
  const minDatetime = new Date(Date.now() + 2 * 60 * 1000).toISOString().slice(0, 16)
  const actionDisabled = !selectedJobId || !selectedAccountId
  const missingVideo = showValidation && !selectedJobId
  const missingAccount = showValidation && !selectedAccountId
  const missingSchedule = showValidation && !scheduledAt

  return (
    <div className="min-h-screen bg-stone-950 text-stone-200">
      <AppNavbar session={session} activeTool="schedule" />

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <section className="bg-stone-900 border border-stone-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-stone-300 mb-4">Connected TikTok Accounts</h2>
          {accounts.length === 0 ? (
            <p className="text-sm text-stone-500 mb-4">No accounts connected.</p>
          ) : (
            <ul className="space-y-2 mb-4">
              {accounts.map(acct => (
                <li
                  key={acct.id}
                  className="flex items-center justify-between bg-stone-800/50 rounded-lg px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    {acct.avatar_url ? (
                      <img src={acct.avatar_url} alt="" className="w-8 h-8 rounded-full" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-stone-700 flex items-center justify-center text-xs font-bold text-stone-400">
                        {(acct.display_name ?? acct.tiktok_user_id)[0]?.toUpperCase()}
                      </div>
                    )}
                    <span className="text-sm text-stone-200">
                      {acct.display_name ?? `@${acct.tiktok_user_id}`}
                    </span>
                  </div>
                  <button
                    onClick={() => disconnectMutation.mutate(acct.id)}
                    disabled={disconnectMutation.isPending}
                    className="text-xs text-stone-500 hover:text-red-400 transition"
                  >
                    Disconnect
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            onClick={() => connectMutation.mutate()}
            disabled={connectMutation.isPending}
            className="px-4 py-2 text-sm font-medium bg-stone-800 hover:bg-stone-700 border border-stone-700 rounded-lg transition disabled:opacity-50"
          >
            {connectMutation.isPending ? 'Connecting...' : '+ Connect TikTok'}
          </button>
        </section>

        <section className="bg-stone-900 border border-stone-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-stone-300 mb-4">Schedule a Post</h2>
          <form onSubmit={e => e.preventDefault()} className="space-y-4">
            <div>
              <label className="block text-xs text-stone-400 mb-1">Video</label>
              <select
                value={selectedJobId}
                onChange={e => setSelectedJobId(e.target.value)}
                className={`w-full rounded-lg px-3 py-2 text-sm text-stone-200 focus:outline-none ${
                  missingVideo
                    ? 'bg-stone-800 border border-red-500 focus:border-red-400'
                    : 'bg-stone-800 border border-stone-700 focus:border-stone-500'
                }`}
              >
                <option value="">Select a completed video...</option>
                {doneJobs.map(j => (
                  <option key={j.job_id} value={j.job_id}>
                    {j.batch_title ?? j.job_id.slice(0, 8)}
                  </option>
                ))}
              </select>
              {doneJobs.length === 0 && (
                <p className="text-xs text-stone-500 mt-1">No completed videos yet. Generate one from the Dashboard.</p>
              )}
            </div>

            <div>
              <label className="block text-xs text-stone-400 mb-1">
                Caption
                <span className="ml-2 text-stone-600">{caption.length}/2200</span>
              </label>
              <textarea
                value={caption}
                onChange={e => setCaption(e.target.value.slice(0, 2200))}
                rows={3}
                placeholder="Write a caption..."
                className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder-stone-600 resize-none focus:outline-none focus:border-stone-500"
              />
            </div>

            <div>
              <label className="block text-xs text-stone-400 mb-1">
                Hashtags
                <span className="ml-2 text-stone-600">press comma or Enter to add</span>
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {hashtags.map(tag => (
                  <span
                    key={tag}
                    className="flex items-center gap-1 text-xs bg-stone-700 text-stone-300 px-2 py-0.5 rounded-full"
                  >
                    #{tag}
                    <button
                      type="button"
                      onClick={() => setHashtags(h => h.filter(t => t !== tag))}
                      className="text-stone-500 hover:text-stone-200 leading-none"
                    >
                      x
                    </button>
                  </span>
                ))}
              </div>
              <input
                value={hashtagInput}
                onChange={e => setHashtagInput(e.target.value)}
                onKeyDown={handleAddHashtag}
                placeholder="stoicism, philosophy..."
                className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder-stone-600 focus:outline-none focus:border-stone-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-stone-400 mb-1">TikTok Account</label>
                <select
                  value={selectedAccountId}
                  onChange={e => setSelectedAccountId(e.target.value)}
                  className={`w-full rounded-lg px-3 py-2 text-sm text-stone-200 focus:outline-none ${
                    missingAccount
                      ? 'bg-stone-800 border border-red-500 focus:border-red-400'
                      : 'bg-stone-800 border border-stone-700 focus:border-stone-500'
                  }`}
                >
                  <option value="">Select account...</option>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.display_name ?? a.tiktok_user_id}
                    </option>
                  ))}
                </select>
                {accounts.length === 0 && (
                  <p className="text-xs text-stone-500 mt-1">Connect an account above first.</p>
                )}
              </div>
              <div>
                <label className="block text-xs text-stone-400 mb-1">Privacy</label>
                <select
                  value={privacyLevel}
                  onChange={e => setPrivacyLevel(e.target.value)}
                  className="w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 focus:outline-none focus:border-stone-500"
                >
                  {PRIVACY_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-stone-400 mb-1">Post at</label>
              <input
                ref={scheduledAtRef}
                type="datetime-local"
                value={scheduledAt}
                min={minDatetime}
                onChange={e => setScheduledAt(e.target.value)}
                className={`w-full rounded-lg px-3 py-2 text-sm text-stone-200 [color-scheme:dark] focus:outline-none ${
                  missingSchedule
                    ? 'bg-stone-800 border border-red-500 focus:border-red-400'
                    : 'bg-stone-800 border border-stone-700 focus:border-stone-500'
                }`}
              />
              <p className={`mt-1 text-xs ${missingSchedule ? 'text-red-400' : 'text-stone-500'}`}>
                {missingSchedule ? 'Choose a date and time to schedule this post.' : 'Choose a future time for the delayed scheduler path.'}
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => handleSchedule(false)}
                disabled={scheduleMutation.isPending || postNowMutation.isPending || actionDisabled}
                className="py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-sm font-medium text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {scheduleMutation.isPending ? 'Scheduling...' : 'Schedule post'}
              </button>
              <button
                type="button"
                onClick={handlePostNow}
                disabled={scheduleMutation.isPending || postNowMutation.isPending || actionDisabled}
                className="py-2.5 rounded-lg bg-stone-200 hover:bg-white text-sm font-medium text-stone-950 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {postNowMutation.isPending ? 'Posting...' : 'Post now'}
              </button>
              <button
                type="button"
                onClick={() => handleSchedule(true)}
                disabled={scheduleMutation.isPending || postNowMutation.isPending || actionDisabled}
                className="py-2.5 rounded-lg bg-stone-700 hover:bg-stone-600 text-sm font-medium text-stone-100 transition disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {scheduleMutation.isPending ? 'Saving...' : 'Send to Inbox'}
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowInboxInfo(true)}
              className="w-full text-center text-xs text-stone-500 hover:text-stone-300 transition mt-1"
            >
              Where will I see my post? -&gt;
            </button>
          </form>
        </section>

        <section className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden">
          <div className="flex border-b border-stone-800">
            {(['upcoming', 'history'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setScheduleTab(tab)}
                className={`flex-1 py-3 text-sm font-medium transition capitalize ${
                  scheduleTab === tab
                    ? 'text-stone-100 bg-stone-800/40'
                    : 'text-stone-500 hover:text-stone-300'
                }`}
              >
                {tab}
                {tab === 'upcoming' && upcomingPosts.length > 0 && (
                  <span className="ml-1.5 text-xs bg-stone-700 text-stone-300 px-1.5 py-0.5 rounded-full">
                    {upcomingPosts.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="divide-y divide-stone-800">
            {scheduleTab === 'upcoming' && (
              upcomingPosts.length === 0 ? (
                <p className="text-sm text-stone-500 p-5">No upcoming posts.</p>
              ) : (
                upcomingPosts.map(post => (
                  <PostRow
                    key={post.id}
                    post={post}
                    onCancel={id => cancelMutation.mutate(id)}
                  />
                ))
              )
            )}
            {scheduleTab === 'history' && (
              historyPosts.length === 0 ? (
                <p className="text-sm text-stone-500 p-5">No post history.</p>
              ) : (
                historyPosts.map(post => <PostRow key={post.id} post={post} />)
              )
            )}
          </div>
        </section>
      </main>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-xl text-sm font-medium border ${
            toast.type === 'success'
              ? 'bg-stone-800 border-lime-600/40 text-lime-300'
              : 'bg-stone-800 border-red-600/40 text-red-300'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {showInboxInfo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowInboxInfo(false)}
        >
          <div
            className="relative bg-stone-900 border border-stone-700 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6"
            onClick={e => e.stopPropagation()}
          >
            <button
              onClick={() => setShowInboxInfo(false)}
              className="absolute top-4 right-4 text-stone-500 hover:text-stone-300 transition"
              aria-label="Close"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <h3 className="text-sm font-semibold text-stone-100 mb-1">Where will my post appear?</h3>
            <p className="text-xs text-stone-400 leading-relaxed mb-4">
              Open TikTok, tap the <span className="text-stone-200 font-medium">Inbox</span> icon, and look for a message from PassiveClip in <span className="text-stone-200 font-medium">System Notifications</span>.
              <br /><br />
              Simply click that notification to load up the video:
            </p>

            <img
              src="/inbox_passiveclip.jpeg"
              alt="TikTok System Notifications showing PassiveClip video ready"
              className="w-full rounded-xl border border-stone-700"
            />
          </div>
        </div>
      )}
    </div>
  )
}

interface PostRowProps {
  post: ScheduledPost
  onCancel?: (id: string) => void
}

function PostRow({ post, onCancel }: PostRowProps) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 py-4">
      <div className="min-w-0">
        <p className="text-sm text-stone-200 font-medium truncate">
          {post.batch_title ?? post.job_id.slice(0, 8)}
        </p>
        <p className="text-xs text-stone-500 mt-0.5">
          {post.tiktok_display_name && <span>@{post.tiktok_display_name} · </span>}
          {formatScheduledAt(post.scheduled_at)}
          {post.draft_mode && (
            <span className="ml-1.5 text-[10px] font-medium bg-stone-700 text-stone-400 px-1.5 py-0.5 rounded-full">Draft</span>
          )}
        </p>
        {post.caption && (
          <p className="text-xs text-stone-600 mt-1 truncate max-w-xs">{post.caption}</p>
        )}
        {post.status === 'failed' && post.error_message && (
          <p className="text-xs text-red-400/70 mt-1 truncate max-w-xs" title={post.error_message}>
            {post.error_message}
          </p>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <StatusBadge status={post.status} draftMode={post.draft_mode} />
        {onCancel && post.status === 'pending' && (
          <button
            onClick={() => onCancel(post.id)}
            className="text-xs text-stone-500 hover:text-red-400 transition"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ status, draftMode }: { status: ScheduledPost['status']; draftMode?: boolean }) {
  if (status === 'pending') {
    return <span className="text-xs text-stone-400 bg-stone-800 px-2 py-0.5 rounded-full">Pending</span>
  }
  if (status === 'posting') {
    return <span className="text-xs text-amber-300 bg-amber-900/30 px-2 py-0.5 rounded-full">Posting...</span>
  }
  if (status === 'posted') {
    return <span className="text-xs text-lime-300 bg-lime-900/30 px-2 py-0.5 rounded-full">{draftMode ? 'Saved' : 'Posted'}</span>
  }
  if (status === 'failed') {
    return <span className="text-xs text-red-300 bg-red-900/30 px-2 py-0.5 rounded-full">Failed</span>
  }
  if (status === 'cancelled') {
    return <span className="text-xs text-stone-500 bg-stone-800 px-2 py-0.5 rounded-full">Cancelled</span>
  }
  return null
}
