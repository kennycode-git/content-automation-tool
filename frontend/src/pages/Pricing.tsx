/**
 * Pricing.tsx
 *
 * Plan selection page. Stripe Checkout links are server-generated URLs.
 * We embed them as static hrefs (they redirect to Stripe's hosted page).
 *
 * Security note: Payment is handled entirely by Stripe's hosted checkout.
 * We never collect card details on our domain.
 */

import { useNavigate } from 'react-router-dom'

type Plan = {
  name: string
  price: string
  limit: string
  features: string[]
  highlight: boolean
} & ({ trial: true; checkoutUrl?: never } | { trial?: false; checkoutUrl: string })

const PLANS: Plan[] = [
  {
    name: 'Free Trial',
    price: '21 days free',
    limit: '25 renders',
    features: [
      'No credit card required',
      'Short-form TikTok & Reels videos',
      'Unsplash + Pexels image fetching',
      '9 colour grading themes',
      'Batch generation',
    ],
    trial: true,
    highlight: false,
  },
  {
    name: 'Creator',
    price: '£4.99 / month',
    limit: '100 renders / month',
    features: [
      'Short-form TikTok & Reels videos',
      'Unsplash + Pexels image fetching',
      '9 colour grading themes',
      'Batch generation',
      'Preview & curate images before rendering',
    ],
    checkoutUrl: import.meta.env.VITE_STRIPE_CREATOR_LINK as string,
    highlight: false,
  },
  {
    name: 'Pro',
    price: '£9.99 / month',
    limit: 'Unlimited renders',
    features: [
      'Everything in Creator',
      'Unlimited renders — no monthly cap',
      'Never run out mid-campaign',
      'Curated philosopher & thinker image library',
      'Priority support',
    ],
    checkoutUrl: import.meta.env.VITE_STRIPE_PRO_LINK as string,
    highlight: true,
  },
]

export default function Pricing() {
  const navigate = useNavigate()

  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center bg-stone-950 px-4 py-16 cursor-pointer"
      onClick={() => navigate('/dashboard')}
    >
      <div onClick={e => e.stopPropagation()} className="flex flex-col items-center cursor-default">
      <h1 className="mb-10 text-3xl font-bold text-brand-500">Choose your plan</h1>

      <div className="flex flex-col gap-6 sm:flex-row">
        {PLANS.map(plan => (
          <div
            key={plan.name}
            className={`w-72 rounded-2xl border p-8 shadow-xl ${
              plan.highlight
                ? 'border-brand-500 bg-stone-900'
                : 'border-stone-800 bg-stone-900'
            }`}
          >
            {plan.highlight && (
              <span className="mb-3 inline-block rounded-full bg-brand-500 px-3 py-0.5 text-xs font-semibold text-white">
                Most popular
              </span>
            )}
            <h2 className="text-xl font-bold text-stone-100">{plan.name}</h2>
            <p className="mt-1 text-2xl font-semibold text-brand-500">{plan.price}</p>
            <p className="mt-0.5 text-xs text-stone-500">{plan.limit}</p>
            <ul className="mt-5 space-y-2">
              {plan.features.map(f => (
                <li key={f} className="flex items-center gap-2 text-sm text-stone-300">
                  <span className="text-brand-500">✓</span> {f}
                </li>
              ))}
            </ul>
            {plan.trial ? (
              <button
                onClick={() => navigate('/dashboard')}
                className="mt-6 block w-full rounded-lg border border-brand-500 py-2 text-center text-sm font-semibold text-brand-500 hover:bg-brand-500 hover:text-white transition"
              >
                Start free trial
              </button>
            ) : (
              <a
                href={plan.checkoutUrl}
                className="mt-6 block w-full rounded-lg bg-brand-500 py-2 text-center text-sm font-semibold text-white hover:bg-brand-700"
              >
                Get started
              </a>
            )}
          </div>
        ))}
      </div>

      <p className="mt-8 text-xs text-stone-600">
        Already have an account?{' '}
        <a href="/login" className="text-brand-500 hover:underline">
          Sign in
        </a>
      </p>
      </div>
      <p className="absolute bottom-4 text-xs text-stone-700 pointer-events-none select-none">
        Click anywhere outside to go back
      </p>
    </div>
  )
}
