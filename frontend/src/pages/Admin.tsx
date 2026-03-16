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

  const inputClass = 'w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-100 placeholder-stone-500 focus:border-brand-500 focus:outline-none'
  const btnClass   = 'rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 transition'

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

      <div className="mx-auto max-w-2xl space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-brand-500">PassiveClip Admin</h1>
            <p className="text-xs text-stone-600 mt-0.5">
              {claimed.length} signed up · {unclaimed.length} pending · {invites.length} total
            </p>
          </div>
          <button
            onClick={() => { sessionStorage.removeItem(SESSION_KEY); setAuthed(false); setKey('') }}
            className="text-xs text-stone-600 hover:text-stone-400 transition"
          >Sign out</button>
        </div>

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
      </div>
    </div>
  )
}
