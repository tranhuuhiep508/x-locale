import { toast as sonnerToast } from 'sonner'

export function useToast() {
  return {
    success: (message: string, action?: { label: string; onClick: () => void }) =>
      sonnerToast.success(message, action ? { action } : undefined),
    error: (message: string) => sonnerToast.error(message),
    info: (message: string) => sonnerToast.info(message),
    warning: (message: string) => sonnerToast.warning(message),
  }
}
