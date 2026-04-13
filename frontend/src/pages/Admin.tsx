/**
 * Admin.tsx — Private invite management page.
 * Navigate to /admin directly. Key stored in sessionStorage.
 */

import { useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL as string
const SESSION_KEY = 'pc_admin_key'

type Invite = {
  email: string
  claimed: boolean
  created_at: string
  user_id: string | null
  plan: string | null
  render_count: number | null
  render_limit: number | null
  trial_expires_at: string | null
  last_job_at: string | null
  total_jobs: number | null
}

type AdminPanel = 'users' | 'emails'

type ReleasePreview = {
  release_id: string
  version: string
  status: string
  subject: string
  summary_text: string
  email_html: string
  email_text: string
}

type ReleaseStatus = {
  release: {
    id: string
    version: string
    status: string
    email_subject: string | null
    created_at: string
    approved_at: string | null
  }
  broadcast_jobs: Array<{
    id: string
    status: string
    preview_recipient_email: string | null
    total_recipients: number
    sent_count: number
    failed_count: number
    created_at: string
    completed_at: string | null
  }>
  recipient_counts: Record<string, number>
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

function RenderBar({ count, limit }: { count: number; limit: number | null }) {
  if (limit === null) return <span className="text-xs text-lime-400">Unlimited</span>
  const pct = Math.min(100, Math.round((count / limit) * 100))
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-lime-400'
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="h-1.5 w-20 rounded-full bg-stone-700 overflow-hidden shrink-0">
        <div className={`h-1.5 rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-stone-400 whitespace-nowrap">{count}/{limit}</span>
    </div>
  )
}

export default function Admin() {
  const [key, setKey]           = useState(() => sessionStorage.getItem(SESSION_KEY) ?? '')
  const [keyInput, setKeyInput] = useState('')
  const [authed, setAuthed]     = useState(false)
  const [activePanel, setActivePanel] = useState<AdminPanel>('users')
  const [invites, setInvites]   = useState<Invite[]>([])

  const [email, setEmail]       = useState('')
  const [adding, setAdding]     = useState(false)

  // Per-row action states keyed by email
  const [sending, setSending]       = useState<string | null>(null)
  const [deleting, setDeleting]     = useState<string | null>(null)
  const [adjusting, setAdjusting]   = useState<string | null>(null)
  const [toast, setToast]           = useState<{ msg: string; ok: boolean } | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError]   = useState<string | null>(null)
  const [releaseVersion, setReleaseVersion] = useState('v0.3.3')
  const [releaseTitle, setReleaseTitle] = useState('Passive Clip')
  const [releaseMarkdownPath, setReleaseMarkdownPath] = useState('/releases/v0.3.3.md')
  const [releaseChangelogUrl, setReleaseChangelogUrl] = useState('https://passiveclip.com')
  const [releasePreviewEmail, setReleasePreviewEmail] = useState('')
  const [releaseUseLlm, setReleaseUseLlm] = useState(false)
  const [releaseBatchSize, setReleaseBatchSize] = useState(50)
  const [releaseBusy, setReleaseBusy] = useState<string | null>(null)
  const [releasePreview, setReleasePreview] = useState<ReleasePreview | null>(null)
  const [releaseStatus, setReleaseStatus] = useState<ReleaseStatus | null>(null)

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  async function fetchUsers(k: string): Promise<boolean> {
    try {
      const res = await fetch(`${API_URL}/api/admin/users`, { headers: { 'X-Admin-Key': k } })
      if (!res.ok) return false
      const data = await res.json()
      setInvites(data.invites)
      return true
    } catch { return false }
  }

  async function tryAuth(k: string) {
    setAuthLoading(true)
    setAuthError(null)
    const ok = await fetchUsers(k)
    if (ok) {
      setKey(k)
      sessionStorage.setItem(SESSION_KEY, k)
      setAuthed(true)
    } else {
      setAuthError('Wrong key or server unreachable.')
    }
    setAuthLoading(false)
  }

  async function handleAddInvite(e: React.FormEvent) {
    e.preventDefault()
    setAdding(true)
    try {
      const res = await fetch(`${API_URL}/api/admin/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json()
      showToast(data.message, res.ok)
      if (res.ok) { setEmail(''); await fetchUsers(key) }
    } catch { showToast('Request failed.', false) }
    setAdding(false)
  }

  async function handleSendInvite(inv: Invite) {
    setSending(inv.email)
    try {
      const res = await fetch(`${API_URL}/api/admin/send-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
        body: JSON.stringify({ email: inv.email }),
      })
      const data = await res.json()
      showToast(data.message ?? (res.ok ? 'Sent!' : 'Failed.'), res.ok)
    } catch { showToast('Request failed.', false) }
    setSending(null)
  }

  async function handleDelete(inv: Invite) {
    if (!confirm(`Remove ${inv.email} from trial invites?`)) return
    setDeleting(inv.email)
    try {
      await fetch(`${API_URL}/api/admin/invite`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
        body: JSON.stringify({ email: inv.email }),
      })
      showToast(`${inv.email} removed.`)
      await fetchUsers(key)
    } catch { showToast('Request failed.', false) }
    setDeleting(null)
  }

  async function handleAdjust(inv: Invite, action: 'reset' | 'add', amount?: number) {
    if (!inv.user_id) return
    setAdjusting(inv.email)
    try {
      const res = await fetch(`${API_URL}/api/admin/adjust-renders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
        body: JSON.stringify({ user_id: inv.user_id, action, amount }),
      })
      const data = await res.json()
      if (res.ok) {
        showToast(`Renders updated → ${data.render_count} used`)
        await fetchUsers(key)
      } else {
        showToast(data.detail || 'Failed.', false)
      }
    } catch { showToast('Request failed.', false) }
    setAdjusting(null)
  }

  async function fetchReleaseStatus(releaseId = releasePreview?.release_id) {
    if (!releaseId) return
    setReleaseBusy('status')
    try {
      const res = await fetch(`${API_URL}/api/admin/releases/${releaseId}`, {
        headers: { 'X-Admin-Key': key },
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.detail || 'Could not fetch release status.', false)
        return
      }
      setReleaseStatus(data)
    } catch {
      showToast('Release status request failed.', false)
    } finally {
      setReleaseBusy(null)
    }
  }

  async function handleGenerateReleasePreview(e: React.FormEvent) {
    e.preventDefault()
    setReleaseBusy('generate')
    setReleaseStatus(null)
    try {
      const res = await fetch(`${API_URL}/api/admin/releases/generate-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
        body: JSON.stringify({
          version: releaseVersion.trim(),
          title: releaseTitle.trim() || undefined,
          markdown_path: releaseMarkdownPath.trim(),
          changelog_url: releaseChangelogUrl.trim() || undefined,
          use_llm_summary: releaseUseLlm,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        showToast(data.detail || 'Preview generation failed.', false)
        return
      }
      setReleasePreview(data)
      showToast('Email preview generated.')
      await fetchReleaseStatus(data.release_id)
    } catch {
      showToast('Preview generation request failed.', false)
    } finally {
      setReleaseBusy(null)
    }
  }

  async function handleSendReleasePreview() {
    if (!releasePreview) return
    setReleaseBusy('preview')
    try {
      const res = await fetch(`${API_URL}/api/admin/releases/send-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
        body: JSON.stringify({
          release_id: releasePreview.release_id,
          preview_email: releasePreviewEmail.trim(),
        }),
      })
      const data = await res.json()
      showToast(
        res.ok ? `Preview sent to ${data.preview_email}.` : data.detail || 'Preview send failed.',
        res.ok,
      )
      if (res.ok) await fetchReleaseStatus(releasePreview.release_id)
    } catch {
      showToast('Preview send request failed.', false)
    } finally {
      setReleaseBusy(null)
    }
  }

  async function handleApproveAndSendRelease() {
    if (!releasePreview) return
    const ok = confirm(
      `Send ${releasePreview.version} to all subscribed users?\n\nThis queues the broadcast and skips anyone already sent this release.`,
    )
    if (!ok) return
    setReleaseBusy('send')
    try {
      const res = await fetch(`${API_URL}/api/admin/releases/approve-and-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
        body: JSON.stringify({
          release_id: releasePreview.release_id,
          batch_size: releaseBatchSize,
        }),
      })
      const data = await res.json()
      showToast(res.ok ? 'Broadcast queued.' : data.detail || 'Broadcast approval failed.', res.ok)
      if (res.ok) await fetchReleaseStatus(releasePreview.release_id)
    } catch {
      showToast('Broadcast approval request failed.', false)
    } finally {
      setReleaseBusy(null)
    }
  }

  const inputClass = 'w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-100 placeholder-stone-500 focus:border-brand-500 focus:outline-none'
  const btnClass   = 'rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 transition'
  const mutedBtnClass = 'rounded-lg border border-stone-700 bg-stone-900 px-4 py-2 text-sm font-semibold text-stone-300 hover:border-brand-500 hover:text-brand-400 disabled:opacity-50 transition'

  // ── Auth gate ──────────────────────────────────────────────────────────────
  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-950 px-4">
        <div className="w-full max-w-xs rounded-2xl border border-stone-800 bg-stone-900 p-8 shadow-xl">
          <p className="mb-4 text-sm font-semibold text-stone-300">Admin access</p>
          <form onSubmit={e => { e.preventDefault(); tryAuth(keyInput) }} className="space-y-3">
            <input type="password" autoFocus placeholder="Admin key" value={keyInput}
              onChange={e => setKeyInput(e.target.value)} className={inputClass} />
            <button type="submit" disabled={authLoading} className={`${btnClass} w-full`}>
              {authLoading ? 'Checking…' : 'Enter'}
            </button>
          </form>
          {authError && <p className="mt-3 text-xs text-red-400">{authError}</p>}
        </div>
      </div>
    )
  }

  // ── Main page ──────────────────────────────────────────────────────────────
  const claimed   = invites.filter(i => i.claimed)
  const unclaimed = invites.filter(i => !i.claimed)

  return (
    <div className="min-h-screen bg-stone-950 px-4 py-12 text-stone-100">
      {toast && (
        <div className={`fixed top-5 right-5 z-50 rounded-xl border px-4 py-3 text-sm shadow-xl transition ${
          toast.ok ? 'border-green-700 bg-green-900/80 text-green-300' : 'border-red-700 bg-red-900/80 text-red-300'
        }`}>
          {toast.msg}
        </div>
      )}

      <div className="mx-auto max-w-5xl space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-brand-500">PassiveClip Admin</h1>
            <p className="text-xs text-stone-600 mt-0.5">
              {claimed.length} signed up · {unclaimed.length} pending · {invites.length} total
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={activePanel}
              onChange={e => setActivePanel(e.target.value as AdminPanel)}
              className="rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 focus:border-brand-500 focus:outline-none"
            >
              <option value="users">Users / invites</option>
              <option value="emails">Email broadcasts</option>
            </select>
            <button
              onClick={() => { sessionStorage.removeItem(SESSION_KEY); setAuthed(false); setKey('') }}
              className="text-xs text-stone-600 hover:text-stone-400 transition"
            >Sign out</button>
          </div>
        </div>

        {activePanel === 'emails' && (
          <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
            <div className="rounded-2xl border border-stone-800 bg-stone-900 p-6 space-y-5">
              <div>
                <h2 className="text-sm font-semibold text-stone-200">Email broadcast</h2>
                <p className="mt-1 text-xs text-stone-500">
                  Generate from markdown, send yourself a preview, then explicitly approve the broadcast.
                </p>
              </div>

              <form onSubmit={handleGenerateReleasePreview} className="space-y-4">
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-stone-400">Version</span>
                  <input value={releaseVersion} onChange={e => setReleaseVersion(e.target.value)} className={inputClass} />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-stone-400">Title</span>
                  <input value={releaseTitle} onChange={e => setReleaseTitle(e.target.value)} className={inputClass} />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-stone-400">Markdown path</span>
                  <input value={releaseMarkdownPath} onChange={e => setReleaseMarkdownPath(e.target.value)} className={inputClass} />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-stone-400">CTA / changelog URL</span>
                  <input value={releaseChangelogUrl} onChange={e => setReleaseChangelogUrl(e.target.value)} className={inputClass} />
                </label>
                <label className="flex items-center gap-2 text-xs text-stone-400">
                  <input
                    type="checkbox"
                    checked={releaseUseLlm}
                    onChange={e => setReleaseUseLlm(e.target.checked)}
                    className="accent-brand-500"
                  />
                  Use LLM polish if enabled on the server
                </label>
                <button type="submit" disabled={!!releaseBusy} className={`${btnClass} w-full`}>
                  {releaseBusy === 'generate' ? 'Generating...' : 'Generate preview'}
                </button>
              </form>

              <div className="border-t border-stone-800 pt-5 space-y-3">
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-stone-400">Preview recipient</span>
                  <input
                    type="email"
                    placeholder="you@example.com"
                    value={releasePreviewEmail}
                    onChange={e => setReleasePreviewEmail(e.target.value)}
                    className={inputClass}
                  />
                </label>
                <button
                  type="button"
                  disabled={!releasePreview || !releasePreviewEmail.trim() || !!releaseBusy}
                  onClick={handleSendReleasePreview}
                  className={`${mutedBtnClass} w-full`}
                >
                  {releaseBusy === 'preview' ? 'Sending preview...' : 'Send preview email'}
                </button>
              </div>

              <div className="border-t border-stone-800 pt-5 space-y-3">
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-stone-400">Batch size</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={releaseBatchSize}
                    onChange={e => setReleaseBatchSize(Number(e.target.value))}
                    className={inputClass}
                  />
                </label>
                <button
                  type="button"
                  disabled={!releasePreview || !!releaseBusy}
                  onClick={handleApproveAndSendRelease}
                  className="w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
                >
                  {releaseBusy === 'send' ? 'Queueing...' : 'Approve and send broadcast'}
                </button>
                <p className="text-[11px] leading-5 text-stone-600">
                  Retry-safe: the backend skips recipients already logged for this release.
                </p>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-2xl border border-stone-800 bg-stone-900 p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-stone-200">Preview</h2>
                    <p className="mt-1 text-xs text-stone-500">
                      {releasePreview ? releasePreview.subject : 'Generate a preview to see the email HTML here.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!releasePreview || !!releaseBusy}
                    onClick={() => fetchReleaseStatus()}
                    className="text-xs text-stone-500 hover:text-brand-400 disabled:opacity-40"
                  >
                    Refresh status
                  </button>
                </div>
                {releasePreview ? (
                  <div className="space-y-4">
                    <div className="rounded-xl border border-stone-800 bg-stone-950 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-stone-600">Summary text</p>
                      <pre className="mt-2 whitespace-pre-wrap text-xs leading-5 text-stone-300">{releasePreview.summary_text}</pre>
                    </div>
                    <iframe
                      title="Release email preview"
                      srcDoc={releasePreview.email_html}
                      sandbox=""
                      className="h-[620px] w-full rounded-xl border border-stone-800 bg-white"
                    />
                  </div>
                ) : (
                  <div className="flex h-80 items-center justify-center rounded-xl border border-dashed border-stone-800 text-sm text-stone-600">
                    No email preview generated yet.
                  </div>
                )}
              </div>

              {releaseStatus && (
                <div className="rounded-2xl border border-stone-800 bg-stone-900 p-6 space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-stone-200">Broadcast status</h2>
                      <p className="mt-1 text-xs text-stone-500">
                        {releaseStatus.release.version} is {releaseStatus.release.status}
                      </p>
                    </div>
                    <div className="text-right text-xs text-stone-500">
                      {Object.entries(releaseStatus.recipient_counts).map(([status, count]) => (
                        <div key={status}>{status}: {count}</div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2">
                    {releaseStatus.broadcast_jobs.map(job => (
                      <div key={job.id} className="rounded-xl bg-stone-800 px-4 py-3 text-xs text-stone-400">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-semibold text-stone-200">{job.status}</span>
                          <span>{new Date(job.created_at).toLocaleString()}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-3">
                          {job.preview_recipient_email && <span>Preview: {job.preview_recipient_email}</span>}
                          <span>Total: {job.total_recipients}</span>
                          <span>Sent: {job.sent_count}</span>
                          <span>Failed: {job.failed_count}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activePanel === 'users' && (
        <>
        {/* Add invite */}
        <div className="rounded-2xl border border-stone-800 bg-stone-900 p-6 space-y-4">
          <h2 className="text-sm font-semibold text-stone-300">Add trial invite</h2>
          <form onSubmit={handleAddInvite} className="flex gap-2">
            <input type="email" required placeholder="email@example.com" value={email}
              onChange={e => setEmail(e.target.value)} className={inputClass} />
            <button type="submit" disabled={adding} className={btnClass}>
              {adding ? '…' : 'Add'}
            </button>
          </form>
          <p className="text-xs text-stone-600">Adding does not send an email. Use the send button on each row.</p>
        </div>

        {/* Signed-up users */}
        {claimed.length > 0 && (
          <div className="rounded-2xl border border-stone-800 bg-stone-900 p-6 space-y-3">
            <h2 className="text-sm font-semibold text-stone-300">Signed up ({claimed.length})</h2>
            <div className="space-y-2">
              {claimed.map(inv => (
                <div key={inv.email} className="rounded-xl bg-stone-800 px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-stone-100 truncate">{inv.email}</span>
                      {inv.plan && (
                        <span className="text-[10px] font-semibold bg-stone-700 text-stone-400 px-1.5 py-0.5 rounded-full capitalize shrink-0">
                          {inv.plan}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {inv.last_job_at && (
                        <span className="text-xs text-stone-600">{timeAgo(inv.last_job_at)}</span>
                      )}
                      {inv.total_jobs !== null && (
                        <span className="text-xs text-stone-600">{inv.total_jobs} jobs</span>
                      )}
                      <button
                        onClick={() => handleDelete(inv)}
                        disabled={deleting === inv.email}
                        className="text-xs text-stone-700 hover:text-red-400 transition"
                        title="Remove invite"
                      >✕</button>
                    </div>
                  </div>

                  {/* Render usage + adjust */}
                  {inv.render_count !== null && (
                    <div className="flex items-center gap-3 flex-wrap">
                      <RenderBar count={inv.render_count} limit={inv.render_limit} />
                      <div className="flex items-center gap-1.5 ml-auto">
                        <span className="text-xs text-stone-600">Add renders:</span>
                        {[25, 50].map(n => (
                          <button
                            key={n}
                            onClick={() => handleAdjust(inv, 'add', n)}
                            disabled={adjusting === inv.email}
                            className="rounded-md border border-stone-700 bg-stone-900 px-2 py-0.5 text-xs text-stone-400 hover:border-brand-500 hover:text-brand-400 transition disabled:opacity-40"
                          >+{n}</button>
                        ))}
                        <button
                          onClick={() => handleAdjust(inv, 'reset')}
                          disabled={adjusting === inv.email}
                          className="rounded-md border border-stone-700 bg-stone-900 px-2 py-0.5 text-xs text-stone-400 hover:border-green-600 hover:text-green-400 transition disabled:opacity-40"
                        >Reset</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pending users */}
        {unclaimed.length > 0 && (
          <div className="rounded-2xl border border-stone-800 bg-stone-900 p-6 space-y-3">
            <h2 className="text-sm font-semibold text-stone-300">Pending ({unclaimed.length})</h2>
            <div className="space-y-2">
              {unclaimed.map(inv => (
                <div key={inv.email} className="flex items-center justify-between rounded-xl bg-stone-800 px-4 py-3 gap-3">
                  <span className="text-sm text-stone-300 truncate">{inv.email}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleSendInvite(inv)}
                      disabled={sending === inv.email}
                      className="rounded-lg border border-stone-600 px-3 py-1 text-xs text-stone-400 hover:border-brand-500 hover:text-brand-400 transition disabled:opacity-40"
                    >
                      {sending === inv.email ? 'Sending…' : '✉ Send invite'}
                    </button>
                    <button
                      onClick={() => handleDelete(inv)}
                      disabled={deleting === inv.email}
                      className="text-xs text-stone-700 hover:text-red-400 transition"
                      title="Remove"
                    >✕</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  )
}
