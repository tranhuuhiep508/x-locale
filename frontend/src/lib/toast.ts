import { toast as sonnerToast, type ExternalToast } from 'sonner'

export function useToast() {
  return {
    success: (message: string, options?: ExternalToast) => sonnerToast.success(message, options),
    error: (message: string) => sonnerToast.error(message),
    info: (message: string) => sonnerToast.info(message),
    warning: (message: string) => sonnerToast.warning(message),
  }
}
