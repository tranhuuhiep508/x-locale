import { describe, expect, it } from 'vitest'
import { isJobAccepted, isJobFinished, jobError, RESPOND_ASYNC } from '@/lib/api/jobs'
import type { Job } from '@/lib/api/types'

function job(overrides: Partial<Job>): Job {
  return {
    id: 'job-1',
    kind: 'import',
    status: 'running',
    result: null,
    error: null,
    created_at: null,
    completed_at: null,
    progress: null,
    ...overrides,
  }
}

describe('job helpers', () => {
  it('opts in with the Prefer header', () => {
    expect(RESPOND_ASYNC).toEqual({ Prefer: 'respond-async' })
  })

  it('tells a 202 job body apart from sync results', () => {
    expect(isJobAccepted({ job_id: 'job-1', status: 'running', kind: 'import' })).toBe(true)
    expect(isJobAccepted({ created: 1, updated: 0, total: 1, dry_run: false })).toBe(false)
    expect(isJobAccepted({ reverted: 2, batch_id: 'b' })).toBe(false)
    expect(isJobAccepted(null)).toBe(false)
    expect(isJobAccepted('job-1')).toBe(false)
  })

  it('treats only completed and failed as finished', () => {
    expect(isJobFinished(undefined)).toBe(false)
    expect(isJobFinished(job({ status: 'pending' }))).toBe(false)
    expect(isJobFinished(job({ status: 'running' }))).toBe(false)
    expect(isJobFinished(job({ status: 'completed' }))).toBe(true)
    expect(isJobFinished(job({ status: 'failed' }))).toBe(true)
  })

  it('maps a failed job to the ApiError the sync request would have thrown', () => {
    const conflict = jobError(
      job({
        status: 'failed',
        error: 'An import is already running',
        result: {
          error: {
            status_code: 409,
            detail: { code: 'import_in_progress', message: 'An import is already running' },
          },
        },
      }),
    )
    expect(conflict.status).toBe(409)
    expect(conflict.message).toBe('An import is already running')

    const plain = jobError(
      job({
        status: 'failed',
        error: 'Invalid JSON file',
        result: { error: { status_code: 400, detail: 'Invalid JSON file' } },
      }),
    )
    expect([plain.status, plain.message]).toEqual([400, 'Invalid JSON file'])

    const unknown = jobError(job({ status: 'failed', error: null, result: null }))
    expect([unknown.status, unknown.message]).toEqual([500, 'Job failed'])
  })
})
