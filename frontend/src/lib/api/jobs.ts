import { api, ApiError, errorMessage } from '@/lib/api/client'
import type { Job, JobAccepted } from '@/lib/api/types'

/** Large imports and undos answer 202 + job id instead of running past the gateway timeout. */
export const RESPOND_ASYNC = { Prefer: 'respond-async' }

export const jobsApi = {
  get: (jobId: string) => api.get<Job>(`/jobs/${jobId}`),
}

export function isJobAccepted(value: unknown): value is JobAccepted {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { job_id?: unknown }).job_id === 'string' &&
    !('created' in value) &&
    !('reverted' in value)
  )
}

export function isJobFinished(job: Job | undefined): job is Job {
  return job?.status === 'completed' || job?.status === 'failed'
}

/** The failed job's rejection as an ApiError, so callers handle it like the sync response. */
export function jobError(job: Job): ApiError {
  const error = (job.result?.error ?? null) as { status_code?: number; detail?: unknown } | null
  const body = { detail: error?.detail }
  return new ApiError(
    error?.status_code ?? 500,
    errorMessage(body, job.error ?? 'Job failed'),
    body,
  )
}
