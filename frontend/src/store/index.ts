import { create } from 'zustand'

export interface Toast {
  id: string
  type: 'success' | 'error' | 'info' | 'warning'
  message: string
}

interface UIStore {
  toasts: Toast[]
  addToast: (toast: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

export const useUIStore = create<UIStore>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = Math.random().toString(36).slice(2)
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 4000)
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export function useToast() {
  const addToast = useUIStore((s) => s.addToast)
  return {
    success: (message: string) => addToast({ type: 'success', message }),
    error: (message: string) => addToast({ type: 'error', message }),
    info: (message: string) => addToast({ type: 'info', message }),
    warning: (message: string) => addToast({ type: 'warning', message }),
  }
}
