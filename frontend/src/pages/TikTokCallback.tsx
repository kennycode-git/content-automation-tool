import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { exchangeTikTokCode } from '../lib/api'

export default function TikTokCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    const code = searchParams.get('code') ?? ''
    const state = searchParams.get('state') ?? ''
    const error = searchParams.get('error') ?? ''

    if (error) {
      navigate(`/schedule?error=${encodeURIComponent(error)}`, { replace: true })
      return
    }
    if (!code || !state) {
      navigate('/schedule?error=missing_params', { replace: true })
      return
    }

    exchangeTikTokCode(code, state)
      .then(() => navigate('/schedule?connected=true', { replace: true }))
      .catch(() => navigate('/schedule?error=exchange_failed', { replace: true }))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-screen items-center justify-center bg-stone-950 text-stone-400 text-sm">
      Connecting TikTok…
    </div>
  )
}
