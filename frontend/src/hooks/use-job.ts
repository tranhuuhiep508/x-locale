import { useQuery } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useRef } from 'react'
import type { ApiError } from '@/lib/api/client'
import { isJobFinished, jobError, jobsApi } from '@/lib/api/jobs'
import type { Job } from '@/lib/api/types'
import { queryKeys } from '@/lib/query-keys'

const POLL_MS = 1000

type JobHandlers = {
  onCompleted: (job: Job) => void
  onFailed: (error: ApiError, job: Job) => void
}

/** Poll a background job every second and call one handler once when it ends. */
export function useJob(jobId: string | null, handlers: JobHandlers) {
  const query = useQuery({
    queryKey: queryKeys.jobs.detail(jobId ?? ''),
    queryFn: () => jobsApi.get(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (current) => (isJobFinished(current.state.data) ? false : POLL_MS),
  })
  const handled = useRef<string | null>(null)

  const finish = useEffectEvent((job: Job) => {
    if (job.status === 'completed') handlers.onCompleted(job)
    else handlers.onFailed(jobError(job), job)
  })

  const job = query.data
  useEffect(() => {
    if (!jobId || !job || job.id !== jobId || !isJobFinished(job)) return
    if (handled.current === jobId) return
    handled.current = jobId
    finish(job)
  }, [jobId, job])

  return query
}
