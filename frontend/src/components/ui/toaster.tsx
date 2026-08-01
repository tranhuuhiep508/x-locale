import { createPortal } from 'react-dom'
import { CheckCircle, AlertCircle, Info, AlertTriangle, X } from 'lucide-react'
import { useUIStore } from '../../store'
import { cn } from '../../lib/utils'

const icons = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
  warning: AlertTriangle,
}

const styles = {
  success: 'bg-white border-emerald-400 text-slate-800',
  error: 'bg-white border-red-400 text-slate-800',
  info: 'bg-white border-brand-400 text-slate-800',
  warning: 'bg-white border-amber-400 text-slate-800',
}

const iconStyles = {
  success: 'text-emerald-500',
  error: 'text-red-500',
  info: 'text-brand-500',
  warning: 'text-amber-500',
}

export function Toaster() {
  const toasts = useUIStore((s) => s.toasts)
  const remove = useUIStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return createPortal(
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full">
      {toasts.map((toast) => {
        const Icon = icons[toast.type]
        return (
          <div
            key={toast.id}
            className={cn(
              'flex items-start gap-3 rounded-lg border-l-4 p-4 shadow-lg animate-fadeIn',
              styles[toast.type],
            )}
          >
            <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', iconStyles[toast.type])} />
            <p className="flex-1 text-sm">{toast.message}</p>
            <button
              onClick={() => remove(toast.id)}
              className="shrink-0 text-slate-400 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
