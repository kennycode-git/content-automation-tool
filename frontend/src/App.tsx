import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { supabase } from './lib/supabase'
import type { Session } from '@supabase/supabase-js'

import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Photos from './pages/Photos'
import Pricing from './pages/Pricing'
import Account from './pages/Account'

const DEV_BYPASS = import.meta.env.VITE_DEV_BYPASS === 'true'

// Minimal fake session used only when VITE_DEV_BYPASS=true.
// Never ships to production (env var is not set there).
const DEV_SESSION = DEV_BYPASS
  ? ({
      access_token: 'dev-bypass-token',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'dev-refresh',
      user: {
        id: 'dev-user-id',
        email: 'dev@local',
        app_metadata: {},
        user_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
      },
    } as unknown as Session)
  : null

function ProtectedRoute({
  session,
  children,
}: {
  session: Session | null
  children: React.ReactElement
}) {
  if (!session) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  const [session, setSession] = useState<Session | null>(DEV_SESSION)
  const [loading, setLoading] = useState(!DEV_BYPASS)

  useEffect(() => {
    if (DEV_BYPASS) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center text-stone-400">
        Loading…
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={session ? <Navigate to="/dashboard" replace /> : <Login />}
        />
        <Route path="/pricing" element={<Pricing />} />
        <Route
          path="/photos"
          element={
            <ProtectedRoute session={session}>
              <Photos session={session!} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute session={session}>
              <Dashboard session={session!} />
            </ProtectedRoute>
          }
        />
        <Route
          path="/account"
          element={
            <ProtectedRoute session={session}>
              <Account session={session!} />
            </ProtectedRoute>
          }
        />
        <Route
          path="*"
          element={<Navigate to={session ? '/dashboard' : '/login'} replace />}
        />
      </Routes>
    </BrowserRouter>
  )
}
