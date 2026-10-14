import { beforeEach, describe, expect, it } from 'vitest'
import { claimFinish, clearActiveJob, getActiveJob, rememberJob } from '@/lib/active-job'

describe('active job', () => {
  beforeEach(() => {
    clearActiveJob()
  })

  it('lets the first caller announce a finished job', () => {
    rememberJob({ jobId: 'job-1', projectId: 'proj-1', kind: 'import' })
    expect(getActiveJob()?.jobId).toBe('job-1')
    expect(claimFinish('job-1')).toBe(true)
    expect(claimFinish('job-1')).toBe(false)
    expect(getActiveJob()).toBeNull()
    expect(sessionStorage.getItem('x-locale-active-job')).toBeNull()
  })
})
