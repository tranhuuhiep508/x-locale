import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { jobProgressPercent } from '@/lib/job-progress'
import type { TranslateJobProgress } from '@/lib/api/types'
import { cn } from '@/lib/utils'

export function JobProgress({
  progress,
  label,
  className,
  error,
  onRetry,
}: {
  progress: TranslateJobProgress | null | undefined
  label: string
  className?: string
  error?: unknown
  onRetry?: () => void
}) {
  if (error) {
    return (
      <Alert variant="destructive" className={className}>
        <AlertDescription className="flex flex-col items-start gap-2">
          <p>Could not check progress. The operation may still finish.</p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry status
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  const percent = jobProgressPercent(progress)
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-live="polite">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Progress
        value={percent}
        aria-label={label}
        aria-valuetext={label}
        className={percent == null ? 'animate-pulse' : undefined}
      />
    </div>
  )
}
