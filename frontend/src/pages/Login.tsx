/**
 * Login.tsx
 *
 * Supabase Auth UI: email/password sign-in, sign-up, magic link, and password reset.
 *
 * Flow:
 * - Default view: sign in with email + password
 * - New users: "Don't have an account? Sign up" → email/password sign-up → /pricing
 * - Existing users: "Sign in without a password" → magic link (shouldCreateUser: false)
 *
 * Security notes:
 * - Supabase handles password hashing, token issuance, and session management.
 * - We never touch raw credentials — they go directly to the Supabase API.
 * - Magic link uses shouldCreateUser: false — only works for existing accounts.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Mode = 'signin' | 'signup' | 'magic' | 'reset'

export default function Login() {
  const navigate = useNavigate()
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
      // Email confirmation disabled — session active immediately.
      // Navigate to pricing so new user picks a plan (including trial).
      navigate('/pricing')
      return
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
      options: {
        emailRedirectTo: window.location.origin,
        shouldCreateUser: false, // only works for existing accounts
      },
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

  const inputClass =
    'w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-100 placeholder-stone-500 focus:border-brand-500 focus:outline-none'
  const btnPrimary =
    'w-full rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50'

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-950 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-stone-800 bg-stone-900 p-8 shadow-xl">
        <img src="/logo%20w%20text.png" alt="PassiveClip" className="mx-auto mb-4 h-20 w-auto" />

        <p className="mb-6 text-sm text-stone-400">
          {mode === 'signup' ? 'Create your account' :
           mode === 'reset'  ? 'Reset your password' :
           mode === 'magic'  ? 'Sign in without a password' :
                               'Sign in to your account'}
        </p>

        {/* Sign in */}
        {mode === 'signin' && (
          <form onSubmit={handleSignIn} className="space-y-3">
            <input type="email" required placeholder="Email" value={email}
              onChange={e => setEmail(e.target.value)} className={inputClass} />
            <input type="password" required placeholder="Password" value={password}
              onChange={e => setPassword(e.target.value)} className={inputClass} />
            <button type="submit" disabled={loading} className={btnPrimary}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
            <div className="flex justify-between text-xs text-stone-500 pt-1">
              <button type="button" onClick={() => switchMode('reset')} className="hover:text-brand-500 transition">
                Forgot password?
              </button>
              <button type="button" onClick={() => switchMode('magic')} className="hover:text-brand-500 transition">
                Sign in without a password →
              </button>
            </div>
          </form>
        )}

        {/* Sign up */}
        {mode === 'signup' && (
          <form onSubmit={handleSignUp} className="space-y-3">
            <input type="email" required placeholder="Email" value={email}
              onChange={e => setEmail(e.target.value)} className={inputClass} />
            <input type="password" required minLength={6} placeholder="Password (min 6 chars)" value={password}
              onChange={e => setPassword(e.target.value)} className={inputClass} />
            <button type="submit" disabled={loading} className={btnPrimary}>
              {loading ? 'Creating account…' : 'Create account'}
            </button>
            <p className="text-center text-xs text-stone-500 pt-1">
              Already have an account?{' '}
              <button type="button" onClick={() => switchMode('signin')} className="text-brand-500 hover:underline">
                Sign in
              </button>
            </p>
          </form>
        )}

        {/* Magic link */}
        {mode === 'magic' && (
          <form onSubmit={handleMagicLink} className="space-y-3">
            <input type="email" required placeholder="Email" value={email}
              onChange={e => setEmail(e.target.value)} className={inputClass} />
            <button type="submit" disabled={loading} className={btnPrimary}>
              {loading ? 'Sending…' : 'Send magic link'}
            </button>
            <p className="text-center text-xs text-stone-500 pt-1">
              <button type="button" onClick={() => switchMode('signin')} className="text-brand-500 hover:underline">
                ← Back to sign in
              </button>
            </p>
          </form>
        )}

        {/* Password reset */}
        {mode === 'reset' && (
          <form onSubmit={handlePasswordReset} className="space-y-3">
            <input type="email" required placeholder="Email" value={email}
              onChange={e => setEmail(e.target.value)} className={inputClass} />
            <button type="submit" disabled={loading} className={btnPrimary}>
              {loading ? 'Sending…' : 'Send reset email'}
            </button>
            <p className="text-center text-xs text-stone-500 pt-1">
              <button type="button" onClick={() => switchMode('signin')} className="text-brand-500 hover:underline">
                ← Back to sign in
              </button>
            </p>
          </form>
        )}

        {message && <p className="mt-4 text-sm text-green-400">{message}</p>}
        {error   && <p className="mt-4 text-sm text-red-400">{error}</p>}

        {/* Sign up prompt — only shown on signin/magic/reset views */}
        {mode !== 'signup' && (
          <p className="mt-8 border-t border-stone-800 pt-4 text-center text-xs text-stone-500">
            Don't have an account?{' '}
            <button type="button" onClick={() => switchMode('signup')} className="text-brand-500 hover:underline">
              Sign up
            </button>
          </p>
        )}
      </div>
    </div>
  )
}
