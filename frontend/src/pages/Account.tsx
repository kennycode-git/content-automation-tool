/**
 * Account.tsx
 *
 * Shows current plan, renders used this month, and cancel option.
 * Data is fetched from Supabase directly (subscriptions + usage tables with RLS).
 */

import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface Props {
  session: Session
}

interface Sub {
  plan: string
  status: string
}

interface Usage {
  render_count: number
}

const PLAN_LIMITS: Record<string, number | null> = {
  creator: 30,
  pro: null,
}

export default function Account({ session }: Props) {
  const [sub, setSub] = useState<Sub | null>(null)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [loading, setLoading] = useState(true)

  const currentMonth = new Date().toISOString().slice(0, 7)

  useEffect(() => {
    async function load() {
      const [subRes, usageRes] = await Promise.all([
        supabase.from('subscriptions').select('plan, status').eq('user_id', session.user.id).maybeSingle(),
        supabase.from('usage').select('render_count').eq('user_id', session.user.id).eq('month', currentMonth).maybeSingle(),
      ])
      setSub(subRes.data ?? null)
      setUsage(usageRes.data ?? null)
      setLoading(false)
    }
    load()
  }, [session.user.id, currentMonth])

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  const limit = sub ? PLAN_LIMITS[sub.plan] : null
  const used = usage?.render_count ?? 0

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-stone-950 px-4">
      <div className="w-full max-w-md rounded-2xl border border-stone-800 bg-stone-900 p-8 shadow-xl">
        <h1 className="mb-1 text-xl font-bold text-brand-500">Account</h1>
        <p className="mb-6 text-sm text-stone-400">{session.user.email}</p>

        {loading ? (
          <p className="text-sm text-stone-500">Loading…</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-stone-700 bg-stone-800 p-4">
              <p className="text-xs text-stone-500 uppercase tracking-wide">Plan</p>
              <p className="mt-1 text-lg font-semibold capitalize text-stone-100">{sub?.plan ?? 'None'}</p>
              <p className={`mt-0.5 text-xs font-medium ${sub?.status === 'active' ? 'text-green-400' : 'text-red-400'}`}>
                {sub?.status ?? 'No active subscription'}
              </p>
            </div>

            <div className="rounded-xl border border-stone-700 bg-stone-800 p-4">
              <p className="text-xs text-stone-500 uppercase tracking-wide">Renders this month</p>
              <p className="mt-1 text-lg font-semibold text-stone-100">
                {used}
                {limit !== null && <span className="text-stone-500"> / {limit}</span>}
                {limit === null && <span className="text-stone-500"> / unlimited</span>}
              </p>
              {limit !== null && (
                <div className="mt-2 h-1.5 w-full rounded-full bg-stone-700">
                  <div
                    className="h-1.5 rounded-full bg-brand-500 transition-all"
                    style={{ width: `${Math.min(100, (used / limit) * 100)}%` }}
                  />
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <a
                href="/pricing"
                className="flex-1 rounded-lg border border-brand-500 py-2 text-center text-sm font-medium text-brand-500 hover:bg-brand-500 hover:text-white transition"
              >
                Change plan
              </a>
              <button
                onClick={handleSignOut}
                className="flex-1 rounded-lg border border-stone-700 py-2 text-sm font-medium text-stone-400 hover:border-stone-500 hover:text-stone-200 transition"
              >
                Sign out
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
