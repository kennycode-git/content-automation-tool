/**
 * Toast.tsx
 *
 * Fixed-position toast stack at bottom-right. Auto-dismisses after 5s.
 */

export interface ToastItem {
  id: string
  message: string
}

interface Props {
  toasts: ToastItem[]
  onDismiss: (id: string) => void
}

export default function ToastStack({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2">
      {toasts.map(t => (
        <div
          key={t.id}
          className="flex items-center gap-3 rounded-xl border border-stone-700 bg-stone-800 px-4 py-3 text-sm text-stone-200 shadow-xl animate-fade-in"
        >
          <span>{t.message}</span>
          <button
            onClick={() => onDismiss(t.id)}
            className="text-stone-500 hover:text-stone-300 text-xs leading-none"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
