/**
 * Login.tsx — Invite-only trial login
 *
 * Flow:
 * 1. Email step: enter email → POST /api/auth/check-invite
 *    - not_found  → error message
 *    - unclaimed  → set-password step (first login)
 *    - claimed    → signin step (returning user)
 * 2a. Set-password: enter + confirm password → POST /api/auth/claim-invite
 *     → auto sign-in via supabase.auth.signInWithPassword
 *     → App.tsx onAuthStateChange redirects to /dashboard
 * 2b. Sign-in: enter password → supabase.auth.signInWithPassword
 * 3.  Reset: password reset email (for forgotten passwords)
 *
 * Security:
 * - Credentials go directly to Supabase — we never handle raw passwords server-side.
 * - claim-invite uses service_role admin API on the backend to create the user.
 */

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

type Step = 'email' | 'set-password' | 'signin' | 'reset' | 'new-password'

function PasswordField({ value, onChange, placeholder, autoFocus, minLength, id }: {
  value: string
  onChange: (v: string) => void
  placeholder: string
  autoFocus?: boolean
  minLength?: number
  id?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        required
        autoFocus={autoFocus}
        minLength={minLength}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 pr-9 text-sm text-stone-100 placeholder-stone-500 focus:border-brand-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="absolute inset-y-0 right-2.5 flex items-center text-stone-500 hover:text-stone-300 transition-colors"
        tabIndex={-1}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M17.94 10A9.54 9.54 0 0 1 10 17a9.54 9.54 0 0 1-7.94-7 9.54 9.54 0 0 1 7.94-7 9.54 9.54 0 0 1 7.94 7z"/>
            <circle cx="10" cy="10" r="3"/>
            <line x1="3" y1="3" x2="17" y2="17"/>
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
            <path d="M17.94 10A9.54 9.54 0 0 1 10 17a9.54 9.54 0 0 1-7.94-7 9.54 9.54 0 0 1 7.94-7 9.54 9.54 0 0 1 7.94 7z"/>
            <circle cx="10" cy="10" r="3"/>
          </svg>
        )}
      </button>
    </div>
  )
}

const API_URL = import.meta.env.VITE_API_URL as string

export default function Login({ recovering = false }: { recovering?: boolean }) {
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [step, setStep]         = useState<Step>(() => recovering ? 'new-password' : 'email')
  const [loading, setLoading]   = useState(false)
  const [message, setMessage]   = useState<string | null>(null)
  const [error, setError]       = useState<string | null>(null)

  // Sync to new-password step if App.tsx detects PASSWORD_RECOVERY event
  useEffect(() => {
    if (recovering) setStep('new-password')
  }, [recovering])

  async function handleEmailContinue(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/auth/check-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Something went wrong.')
      if (data.status === 'not_found') {
        setError("This email isn't registered for the trial. Contact us to get access.")
      } else if (data.status === 'unclaimed') {
        setStep('set-password')
      } else {
        setStep('signin')
      }
    } catch (err: any) {
      setError(err.message)
    }
    setLoading(false)
  }

  async function handleClaimInvite(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      setError("Passwords don't match.")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/auth/claim-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 409) {
          // Account already exists — redirect to sign-in
          setStep('signin')
          setPassword('')
          setConfirm('')
          setMessage(data.detail)
          setLoading(false)
          return
        }
        throw new Error(data.detail || 'Failed to activate account.')
      }
      // Account created — sign in automatically
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (signInErr) throw new Error(signInErr.message)
      // App.tsx onAuthStateChange handles redirect to /dashboard
    } catch (err: any) {
      setError(err.message)
    }
    setLoading(false)
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError(error.message)
    setLoading(false)
  }

  async function handleSetNewPassword(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError("Passwords don't match."); return }
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
    } else {
      setMessage('Password updated. Signing you in…')
      // onAuthStateChange in App.tsx will redirect to /dashboard
    }
    setLoading(false)
  }

  async function handlePasswordReset(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/login`,
    })
    if (error) setError(error.message)
    else setMessage('Password reset email sent. Check your inbox.')
    setLoading(false)
  }

  function back() {
    setStep('email')
    setPassword('')
    setConfirm('')
    setError(null)
    setMessage(null)
  }

  const inputClass =
    'w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 text-sm text-stone-100 placeholder-stone-500 focus:border-brand-500 focus:outline-none'
  const btnPrimary =
    'w-full rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50'
  const btnBack = 'text-xs text-stone-500 hover:text-brand-500 transition'

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-950 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-stone-800 bg-stone-900 p-8 shadow-xl">
        <img src="/logo%20w%20text.png" alt="PassiveClip" className="mx-auto mb-6 h-20 w-auto" />

        {/* Step 1: email */}
        {step === 'email' && (
          <>
            <p className="mb-6 text-sm text-stone-400">Enter your email to continue</p>
            <form onSubmit={handleEmailContinue} className="space-y-3">
              <input type="email" required autoFocus placeholder="Email" value={email}
                onChange={e => setEmail(e.target.value)} className={inputClass} />
              <button type="submit" disabled={loading} className={btnPrimary}>
                {loading ? 'Checking…' : 'Continue →'}
              </button>
            </form>
          </>
        )}

        {/* Step 2a: set password (first login) */}
        {step === 'set-password' && (
          <>
            <p className="mb-1 text-sm text-stone-400">Welcome! Set a password for</p>
            <p className="mb-5 truncate text-sm font-medium text-stone-200">{email}</p>
            <form onSubmit={handleClaimInvite} className="space-y-3">
              <PasswordField autoFocus minLength={6} placeholder="Password (min 6 characters)" value={password} onChange={setPassword} />
              <PasswordField placeholder="Confirm password" value={confirm} onChange={setConfirm} />
              <button type="submit" disabled={loading} className={btnPrimary}>
                {loading ? 'Activating…' : 'Activate account'}
              </button>
              <div className="pt-1 text-center">
                <button type="button" onClick={back} className={btnBack}>← Back</button>
              </div>
            </form>
          </>
        )}

        {/* Step 2b: sign in (returning user) */}
        {step === 'signin' && (
          <>
            <p className="mb-1 text-sm text-stone-400">Welcome back</p>
            <p className="mb-5 truncate text-sm font-medium text-stone-200">{email}</p>
            <form onSubmit={handleSignIn} className="space-y-3">
              <PasswordField autoFocus placeholder="Password" value={password} onChange={setPassword} />
              <button type="submit" disabled={loading} className={btnPrimary}>
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
              <div className="flex justify-between pt-1">
                <button type="button" onClick={back} className={btnBack}>← Back</button>
                <button type="button" onClick={() => { setStep('reset'); setError(null); setMessage(null) }} className={btnBack}>
                  Forgot password?
                </button>
              </div>
            </form>
          </>
        )}

        {/* Step: password reset */}
        {step === 'reset' && (
          <>
            <p className="mb-6 text-sm text-stone-400">Reset your password</p>
            <form onSubmit={handlePasswordReset} className="space-y-3">
              <input type="email" required placeholder="Email" value={email}
                onChange={e => setEmail(e.target.value)} className={inputClass} />
              <button type="submit" disabled={loading} className={btnPrimary}>
                {loading ? 'Sending…' : 'Send reset email'}
              </button>
              <div className="pt-1 text-center">
                <button type="button" onClick={() => { setStep('email'); setError(null); setMessage(null) }} className={btnBack}>
                  ← Back to sign in
                </button>
              </div>
            </form>
          </>
        )}

        {/* Step: set new password (recovery flow) */}
        {step === 'new-password' && (
          <>
            <p className="mb-6 text-sm text-stone-400">Choose a new password</p>
            <form onSubmit={handleSetNewPassword} className="space-y-3">
              <PasswordField autoFocus minLength={6} placeholder="New password (min 6 characters)" value={password} onChange={setPassword} />
              <PasswordField placeholder="Confirm new password" value={confirm} onChange={setConfirm} />
              <button type="submit" disabled={loading} className={btnPrimary}>
                {loading ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          </>
        )}

        {message && <p className="mt-4 text-sm text-green-400">{message}</p>}
        {error   && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  )
}
