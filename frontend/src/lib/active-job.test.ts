import { beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('persists the deadline and restores legacy jobs as paused', async () => {
    rememberJob({ jobId: 'deadline', projectId: 'proj-1', kind: 'import', pollUntil: 12345 })
    vi.resetModules()
    const restored = await import('./active-job')
    expect(restored.getActiveJob()?.pollUntil).toBe(12345)
    sessionStorage.setItem('x-locale-active-job', JSON.stringify({
      jobId: 'legacy', projectId: 'proj-1', kind: 'import',
    }))
    vi.resetModules()
    const legacy = await import('./active-job')
    expect(legacy.getActiveJob()?.pollUntil).toBe(0)
  })
})
