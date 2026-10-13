import { Progress } from '@/components/ui/progress'
import { jobProgressPercent } from '@/lib/job-progress'
import type { TranslateJobProgress } from '@/lib/api/types'
import { cn } from '@/lib/utils'

export function JobProgress({
  progress,
  label,
  className,
}: {
  progress: TranslateJobProgress | null | undefined
  label: string
  className?: string
}) {
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
