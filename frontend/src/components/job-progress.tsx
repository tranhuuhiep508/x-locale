import { Progress } from '@/components/ui/progress'
import { jobProgressPercent } from '@/lib/job-progress'
import type { TranslateJobProgress } from '@/lib/api/types'
import { cn } from '@/lib/utils'

export function JobProgress({
  progress,
  label,
  className,
  error,
  paused,
}: {
  progress: TranslateJobProgress | null | undefined
  label: string
  className?: string
  error?: unknown
  paused?: boolean
}) {
  if (error || paused) {
    return (
      <div className={cn('flex flex-col gap-2', className)} aria-live="polite">
        <p>{paused ? 'This operation may still be running. Check again for an update.'
          : 'Could not check progress. The operation may still finish.'}</p>
        <p>Use the job status banner to check again or stop tracking.</p>
      </div>
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
