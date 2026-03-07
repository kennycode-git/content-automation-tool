/**
 * Pricing.tsx
 *
 * Plan selection page. Stripe Checkout links are server-generated URLs.
 * We embed them as static hrefs (they redirect to Stripe's hosted page).
 *
 * Security note: Payment is handled entirely by Stripe's hosted checkout.
 * We never collect card details on our domain.
 */

const PLANS = [
  {
    name: 'Creator',
    price: '£5 / month',
    limit: '30 renders / month',
    features: ['Short-form TikTok videos', 'Unsplash image fetching', 'Brown & BW grading'],
    checkoutUrl: import.meta.env.VITE_STRIPE_CREATOR_LINK as string,
    highlight: false,
  },
  {
    name: 'Pro',
    price: '£12 / month',
    limit: 'Unlimited renders',
    features: ['Everything in Creator', 'Unlimited renders', 'Priority processing'],
    checkoutUrl: import.meta.env.VITE_STRIPE_PRO_LINK as string,
    highlight: true,
  },
]

export default function Pricing() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-stone-950 px-4 py-16">
      <h1 className="mb-2 text-3xl font-bold text-brand-500">Cogito Content Studio</h1>
      <p className="mb-10 text-stone-400">Choose your plan</p>

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
            <a
              href={plan.checkoutUrl}
              className="mt-6 block w-full rounded-lg bg-brand-500 py-2 text-center text-sm font-semibold text-white hover:bg-brand-700"
            >
              Get started
            </a>
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
  )
}
