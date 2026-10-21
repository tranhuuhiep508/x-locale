import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { claimFinish, clearActiveJob, getActiveJob, rememberJob } from '@/lib/active-job'

describe('active job', () => {
  beforeEach(() => {
    clearActiveJob()
  })

  afterEach(() => {
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

  it('preserves an expired deadline across reload and resets it only on check again', async () => {
    const started = Date.now() - 31 * 60 * 1000
    sessionStorage.setItem('x-locale-active-job', JSON.stringify({
      jobId: 'expired', projectId: 'proj-1', kind: 'import', pollingStartedAt: started,
    }))
    vi.resetModules()
    const reloaded = await import('./active-job')
    try {
      expect(reloaded.getActiveJob()?.pollingStartedAt).toBe(started)
      expect(reloaded.isJobPollingPaused('expired')).toBe(true)
      reloaded.resumeJobPolling('expired')
      expect(reloaded.isJobPollingPaused('expired')).toBe(false)
      expect(reloaded.getActiveJob()!.pollingStartedAt).toBeGreaterThan(started)
      const saved = reloaded.getActiveJob()!.pollingStartedAt
      vi.resetModules()
      const again = await import('./active-job')
      try {
        expect(again.getActiveJob()?.pollingStartedAt).toBe(saved)
      } finally {
        again.clearActiveJob()
      }
    } finally {
      reloaded.clearActiveJob()
    }
  })

  it('gives a legacy saved job one persisted polling window', async () => {
    sessionStorage.setItem('x-locale-active-job', JSON.stringify({
      jobId: 'legacy', projectId: 'proj-1', kind: 'revert',
    }))
    vi.resetModules()
    const reloaded = await import('./active-job')
    try {
      const started = reloaded.getActiveJob()?.pollingStartedAt
      expect(started).toBeTypeOf('number')
      expect(reloaded.isJobPollingPaused('legacy')).toBe(false)
      expect(JSON.parse(sessionStorage.getItem('x-locale-active-job')!).pollingStartedAt).toBe(started)
    } finally {
      reloaded.clearActiveJob()
    }
  })
})
