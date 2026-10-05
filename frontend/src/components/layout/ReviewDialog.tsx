import type { ComponentProps } from 'react'
import { DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export function ReviewDialogContent({ className, ...props }: ComponentProps<typeof DialogContent>) {
  return (
    <DialogContent
      className={cn(
        'flex max-h-[min(90dvh,840px)] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl',
        className
      )}
      {...props}
    />
  )
}

export function ReviewDialogHeader({ className, ...props }: ComponentProps<typeof DialogHeader>) {
  return <DialogHeader className={cn('shrink-0 border-b px-5 py-4 pr-12', className)} {...props} />
}

export function ReviewDialogBody({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'relative min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4',
        className
      )}
      {...props}
    />
  )
}

export function ReviewDialogFooter({ className, ...props }: ComponentProps<typeof DialogFooter>) {
  return (
    <DialogFooter
      className={cn(
        'mx-0 mb-0 shrink-0 flex-row flex-wrap justify-end rounded-none px-5 py-3',
        className
      )}
      {...props}
    />
  )
}
