/**
 * Admin.tsx
 *
 * Private invite management page. Access requires the ADMIN_SECRET_KEY.
 * Not linked anywhere in the UI — navigate to /admin directly.
 * Key is stored in sessionStorage so you don't re-enter within the same tab session.
 */

import { useEffect, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL as string
const SESSION_KEY = 'pc_admin_key'

type Invite = { email: string; claimed: boolean; created_at: string }

export default function Admin() {
  const [key, setKey]           = useState(() => sessionStorage.getItem(SESSION_KEY) ?? '')
  const [keyInput, setKeyInput] = useState('')
  const [authed, setAuthed]     = useState(false)

  const [email, setEmail]       = useState('')
  const [result, setResult]     = useState<string | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)

  const [invites, setInvites]   = useState<Invite[]>([])
  const [loadingList, setLoadingList] = useState(false)

  // Auto-authenticate if key already in sessionStorage
  useEffect(() => {
    if (key) tryAuth(key)
  }, [])

  async function tryAuth(k: string) {
    setLoadingList(true)
    const res = await fetch(`${API_URL}/api/admin/invites`, {
      headers: { 'X-Admin-Key': k },
    })
    if (res.ok) {
      const data = await res.json()
      setKey(k)
      sessionStorage.setItem(SESSION_KEY, k)
      setAuthed(true)
      setInvites(data.invites)
    } else {
      setAuthed(false)
      setError('Wrong key.')
    }
    setLoadingList(false)
  }

  async function refreshList(k: string) {
    const res = await fetch(`${API_URL}/api/admin/invites`, { headers: { 'X-Admin-Key': k } })
    if (res.ok) setInvites((await res.json()).invites)
  }

  async function handleAddInvite(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setResult(null)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/admin/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Key': key },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Failed.')
      setResult(data.message)
      setEmail('')
      await refreshList(key)
    } catch (err: any) {
      setError(err.message)
    }
    setLoading(false)
  }

  const inputClass = 'w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-100 placeholder-stone-500 focus:border-brand-500 focus:outline-none'
  const btnClass   = 'rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 transition'

  if (!authed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-950 px-4">
        <div className="w-full max-w-xs rounded-2xl border border-stone-800 bg-stone-900 p-8 shadow-xl">
          <p className="mb-4 text-sm font-semibold text-stone-300">Admin access</p>
          <form onSubmit={e => { e.preventDefault(); tryAuth(keyInput) }} className="space-y-3">
            <input
              type="password"
              autoFocus
              placeholder="Admin key"
              value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              className={inputClass}
            />
            <button type="submit" disabled={loadingList} className={`${btnClass} w-full`}>
              {loadingList ? 'Checking…' : 'Enter'}
            </button>
          </form>
          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        </div>
      </div>
    )
  }

  const claimed   = invites.filter(i => i.claimed)
  const unclaimed = invites.filter(i => !i.claimed)

  return (
    <div className="min-h-screen bg-stone-950 px-4 py-12 text-stone-100">
      <div className="mx-auto max-w-lg space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-brand-500">PassiveClip Admin</h1>
          <button
            onClick={() => { sessionStorage.removeItem(SESSION_KEY); setAuthed(false); setKey('') }}
            className="text-xs text-stone-600 hover:text-stone-400 transition"
          >
            Sign out
          </button>
        </div>

        {/* Add invite */}
        <div className="rounded-2xl border border-stone-800 bg-stone-900 p-6 space-y-4">
          <h2 className="text-sm font-semibold text-stone-300">Add trial invite</h2>
          <form onSubmit={handleAddInvite} className="flex gap-2">
            <input
              type="email"
              required
              placeholder="email@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className={inputClass}
            />
            <button type="submit" disabled={loading} className={btnClass}>
              {loading ? '…' : 'Add'}
            </button>
          </form>
          {result && <p className="text-xs text-green-400">{result}</p>}
          {error  && <p className="text-xs text-red-400">{error}</p>}
        </div>

        {/* Invite list */}
        <div className="rounded-2xl border border-stone-800 bg-stone-900 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-stone-300">
              All invites ({invites.length})
            </h2>
            <span className="text-xs text-stone-500">
              {claimed.length} signed up · {unclaimed.length} pending
            </span>
          </div>

          {invites.length === 0 ? (
            <p className="text-xs text-stone-600">No invites yet.</p>
          ) : (
            <div className="space-y-1.5">
              {invites.map(inv => (
                <div key={inv.email} className="flex items-center justify-between rounded-lg bg-stone-800 px-3 py-2">
                  <span className="text-sm text-stone-200 truncate">{inv.email}</span>
                  <span className={`ml-3 shrink-0 text-xs font-medium ${inv.claimed ? 'text-green-400' : 'text-stone-500'}`}>
                    {inv.claimed ? 'Signed up' : 'Pending'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
