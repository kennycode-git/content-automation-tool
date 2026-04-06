/**
 * AppNavbar.tsx
 *
 * Shared navbar used across all tool pages.
 * Contains: logo, tool tabs (Video / Photos / AI Prompting), profile dropdown.
 */

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { getUsage } from '../lib/api'
import type { UsageInfo } from '../lib/api'

interface Props {
  session: Session
  activeTool: 'video' | 'photos' | 'schedule'
  onShowTour?: () => void
}

export default function AppNavbar({ session, activeTool, onShowTour }: Props) {
  const [showProfile, setShowProfile] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)

  const { data: usageInfo } = useQuery<UsageInfo>({
    queryKey: ['usage'],
    queryFn: getUsage,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  useEffect(() => {
    if (!showProfile) return
    function handleClick(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node))
        setShowProfile(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showProfile])

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  const displayName = session.user.user_metadata?.full_name as string | undefined
  const userName = displayName ?? session.user.email ?? 'User'
  const initials = displayName
    ? displayName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : (session.user.email?.[0] ?? '?').toUpperCase()

  return (
    <nav className="border-b border-stone-800 bg-stone-900 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-2 min-w-0">
          <img src="/logo%20w%20text.png" alt="PassiveClip" className="h-8 w-auto object-contain sm:hidden" />
          <div className="hidden sm:flex items-center gap-2">
            <img src="/logo.png" alt="" className="h-[40px] w-auto object-contain" />
            <img src="/just%20text.png" alt="PassiveClip" className="h-9 w-auto object-contain" />
          </div>
        </div>

        {/* Tool tabs */}
        <div className="flex items-center gap-0.5">
          <Link
            to="/dashboard"
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
              activeTool === 'video'
                ? 'text-stone-100 bg-stone-700/60'
                : 'text-stone-500 hover:text-stone-300 hover:bg-stone-800'
            }`}
          >
            Video
          </Link>
          <Link
            to="/photos"
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
              activeTool === 'photos'
                ? 'text-stone-100 bg-stone-700/60'
                : 'text-stone-500 hover:text-stone-300 hover:bg-stone-800'
            }`}
          >
            Image
          </Link>
          <Link
            to="/schedule"
            className={`hidden sm:block px-3 py-1.5 text-sm font-medium rounded-md transition ${
              activeTool === 'schedule'
                ? 'text-stone-100 bg-stone-700/60'
                : 'text-stone-500 hover:text-stone-300 hover:bg-stone-800'
            }`}
          >
            Scheduling
          </Link>
          <div className="hidden lg:flex items-center gap-0.5">
            <div className="group relative">
              <span className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-stone-600 cursor-default select-none">
                AI Prompting
                <span className="text-[9px] font-semibold tracking-wide bg-stone-800 text-stone-600 border border-stone-700/60 px-1.5 py-0.5 rounded-full">
                  Soon
                </span>
              </span>
              <div className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 w-52 rounded-lg border border-stone-600 bg-stone-800 px-3 py-2.5 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-50">
                <p className="text-xs font-semibold text-white mb-1">AI-Powered Search Terms</p>
                <p className="text-xs text-stone-300 leading-relaxed">Automatically generate optimised search term batches using AI. Just describe your niche or topic.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {onShowTour && (
          <button
            onClick={onShowTour}
            className="text-xs font-medium px-2.5 py-1 rounded-md border border-stone-700 text-stone-400 hover:text-stone-200 hover:border-stone-500 transition"
            title="Show tutorial"
          >
            Tutorial
          </button>
        )}

        <div ref={profileRef} className="relative">
          <button
            onClick={() => setShowProfile(v => !v)}
            className="w-8 h-8 rounded-full bg-brand-500/20 border border-brand-500/40 flex items-center justify-center text-xs font-bold text-brand-400 hover:bg-brand-500/30 transition"
            title="Account"
          >
            {initials}
          </button>

          {showProfile && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowProfile(false)} />
              <div className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-stone-700 bg-stone-900 shadow-2xl z-20 overflow-hidden">
                {/* Credits / usage */}
                {usageInfo && (
                  (usageInfo.plan === 'pro' || (usageInfo.plan === 'trial' && usageInfo.limit === null)) ? (
                    <div className="px-4 py-3 border-b border-stone-800">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-stone-100">
                          {usageInfo.plan === 'trial' ? 'Unlimited for now' : 'Unlimited'}
                        </span>
                        <span className="text-xs text-stone-500">{usageInfo.render_count} used</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-stone-800 overflow-hidden">
                        <div className="h-2 w-full rounded-full bg-lime-400" />
                      </div>
                    </div>
                  ) : usageInfo.limit !== null ? (
                    <Link
                      to="/pricing"
                      onClick={() => setShowProfile(false)}
                      className="block px-4 py-3 border-b border-stone-800 hover:bg-stone-800/50 transition group"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-semibold text-stone-100">
                          {Math.round(Math.max(0, (1 - usageInfo.render_count / usageInfo.limit) * 100))}% credits left
                        </span>
                        <svg className="w-4 h-4 text-stone-500 group-hover:text-stone-300 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                      <div className="h-2 w-full rounded-full bg-stone-800 overflow-hidden">
                        <div
                          className="h-2 rounded-full bg-lime-400 transition-all"
                          style={{ width: `${Math.max(0, 100 - (usageInfo.render_count / usageInfo.limit) * 100)}%` }}
                        />
                      </div>
                    </Link>
                  ) : null
                )}

                {/* User + plan */}
                <div className="px-4 py-3 border-b border-stone-800 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-stone-100 truncate">{userName}</p>
                      <span className="text-stone-600 text-xs">·</span>
                      <span className="text-xs text-stone-500 capitalize shrink-0">{usageInfo?.plan ?? 'trial'} Plan</span>
                    </div>
                  </div>
                  <Link
                    to="/pricing"
                    onClick={() => setShowProfile(false)}
                    className="p-1.5 text-stone-500 hover:text-stone-300 transition rounded-lg hover:bg-stone-800 flex-shrink-0"
                    title="Change plan"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                  </Link>
                </div>

                {/* Actions */}
                <div className="py-1">
                  <Link
                    to="/account"
                    onClick={() => setShowProfile(false)}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-stone-300 hover:bg-stone-800 transition"
                  >
                    <svg className="w-4 h-4 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    View account
                  </Link>
                  <button
                    onClick={() => { setShowProfile(false); handleSignOut() }}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm text-stone-300 hover:bg-stone-800 transition w-full text-left"
                  >
                    <svg className="w-4 h-4 text-stone-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Sign out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
