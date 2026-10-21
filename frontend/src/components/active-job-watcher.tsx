import { useQueryClient } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useJob } from '@/hooks/use-job'
import {
  claimFinish, getActiveJob, jobSuccessMessage, refreshProjectContent,
  stopTrackingJob, subscribeActiveJob,
} from '@/lib/active-job'
import { useToast } from '@/lib/toast'

/** Keeps job outcomes and recovery controls available across project navigation. */
export function ActiveJobWatcher() {
  const active = useSyncExternalStore(subscribeActiveJob, getActiveJob)
  const qc = useQueryClient()
  const toast = useToast()
  const query = useJob(active?.jobId ?? null, {
    onCompleted: (job) => {
      if (!active || !claimFinish(job.id)) return
      if (active.dryRun || job.result?.dry_run === true) return
      refreshProjectContent(qc, active.projectId)
      toast.success(jobSuccessMessage(active.kind, job.result))
    },
    onFailed: (error) => {
      if (!active || !claimFinish(active.jobId)) return
      toast.error(error.message)
    },
  })
  if (!active || (!query.isPaused && !query.isError)) return null
  return (
    <Alert className="m-4 w-auto" variant={query.isError ? 'destructive' : 'default'}>
      <AlertDescription className="flex flex-col items-start gap-2">
        <p>{query.isPaused
          ? 'This operation may still be running. Check again for an update.'
          : 'Could not check progress. The operation may still finish.'}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={query.isFetching}
            onClick={() => { void query.refetch() }}>
            {query.isPaused ? 'Check status' : 'Retry status'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => stopTrackingJob(active.jobId)}>
            Stop tracking
          </Button>
        </div>
        <p>This does not cancel the operation on the server.</p>
      </AlertDescription>
    </Alert>
  )
}
