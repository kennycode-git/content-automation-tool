/**
 * Login.tsx
 *
 * Supabase Auth UI: email/password sign-in, sign-up, magic link, and password reset.
 *
 * Security notes:
 * - Supabase handles password hashing, token issuance, and session management.
 * - We never touch raw credentials — they go directly to the Supabase API.
 */

import { useState } from 'react'
import { supabase } from '../lib/supabase'

type Mode = 'signin' | 'signup' | 'magic' | 'reset'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<Mode>('signin')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setMessage(null)
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) {
      setError(error.message)
    } else if (data.session) {
      // Email confirmation is disabled — user is signed in immediately.
      // App.tsx onAuthStateChange will redirect to /dashboard automatically.
    } else {
      setMessage('Account created — check your email to confirm, then sign in.')
    }
    setLoading(false)
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) setError(error.message)
    else setMessage('Magic link sent — check your email and click the link to sign in.')
    setLoading(false)
  }

  async function handlePasswordReset(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`,
    })
    if (error) setError(error.message)
    else setMessage('Password reset email sent — check your inbox.')
    setLoading(false)
  }

  const tabClass = (m: Mode) =>
    `flex-1 rounded-lg py-1.5 text-sm font-medium transition ${
      mode === m
        ? 'bg-brand-500 text-white'
        : 'bg-stone-800 text-stone-400 hover:text-stone-200'
    }`

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-950 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-stone-800 bg-stone-900 p-8 shadow-xl">
        <img src="/logo%20w%20text.png" alt="PassiveClip" className="mx-auto mb-4 h-20 w-auto" />
        <p className="mb-6 text-sm text-stone-400">
          {mode === 'signup' ? 'Create your account' :
           mode === 'reset'  ? 'Reset your password' :
                               'Sign in to your account'}
        </p>

        {/* Tabs — only shown for sign-in / sign-up / magic modes */}
        {mode !== 'reset' && (
          <div className="mb-4 flex gap-2">
            <button onClick={() => switchMode('signin')} className={tabClass('signin')}>Sign in</button>
            <button onClick={() => switchMode('signup')} className={tabClass('signup')}>Sign up</button>
            <button onClick={() => switchMode('magic')}  className={tabClass('magic')}>Magic link</button>
          </div>
        )}

        {/* Sign in */}
        {mode === 'signin' && (
          <form onSubmit={handleSignIn} className="space-y-3">
            <input type="email" required placeholder="Email" value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-100 placeholder-stone-500 focus:border-brand-500 focus:outline-none" />
            <input type="password" required placeholder="Password" value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-100 placeholder-stone-500 focus:border-brand-500 focus:outline-none" />
            <button type="submit" disabled={loading}
              className="w-full rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
            <p className="text-center text-xs text-stone-500">
              Forgot your password?{' '}
              <button type="button" onClick={() => switchMode('reset')} className="text-brand-500 hover:underline">
                Reset it
              </button>
            </p>
          </form>
        )}

        {/* Sign up */}
        {mode === 'signup' && (
          <form onSubmit={handleSignUp} className="space-y-3">
            <input type="email" required placeholder="Email" value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-100 placeholder-stone-500 focus:border-brand-500 focus:outline-none" />
            <input type="password" required minLength={6} placeholder="Password (min 6 chars)" value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-100 placeholder-stone-500 focus:border-brand-500 focus:outline-none" />
            <button type="submit" disabled={loading}
              className="w-full rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>
        )}

        {/* Magic link */}
        {mode === 'magic' && (
          <form onSubmit={handleMagicLink} className="space-y-3">
            <input type="email" required placeholder="Email" value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-100 placeholder-stone-500 focus:border-brand-500 focus:outline-none" />
            <button type="submit" disabled={loading}
              className="w-full rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              {loading ? 'Sending…' : 'Send magic link'}
            </button>
          </form>
        )}

        {/* Password reset */}
        {mode === 'reset' && (
          <form onSubmit={handlePasswordReset} className="space-y-3">
            <input type="email" required placeholder="Email" value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-100 placeholder-stone-500 focus:border-brand-500 focus:outline-none" />
            <button type="submit" disabled={loading}
              className="w-full rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              {loading ? 'Sending…' : 'Send reset email'}
            </button>
            <p className="text-center text-xs text-stone-500">
              <button type="button" onClick={() => switchMode('signin')} className="text-brand-500 hover:underline">
                Back to sign in
              </button>
            </p>
          </form>
        )}

        {message && <p className="mt-4 text-sm text-green-400">{message}</p>}
        {error   && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <p className="mt-6 text-center text-xs text-stone-500">
          Exploring?{' '}
          <a href="/pricing" className="text-brand-500 hover:underline">
            View pricing
          </a>
        </p>
      </div>
    </div>
  )
}
