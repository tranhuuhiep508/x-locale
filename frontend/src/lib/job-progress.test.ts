import { describe, expect, it } from 'vitest'
import { importProgressLabel, jobProgressPercent, undoProgressLabel } from '@/lib/job-progress'

describe('job progress', () => {
  it('reports a percent only while writing steps', () => {
    expect(jobProgressPercent(null)).toBeUndefined()
    expect(jobProgressPercent({ phase: 'queued', chunks_done: 0, chunks_total: 0 })).toBeUndefined()
    expect(jobProgressPercent({ phase: 'planning', chunks_done: 0, chunks_total: 40 })).toBeUndefined()
    expect(jobProgressPercent({ phase: 'writing', chunks_done: 1, chunks_total: 3 })).toBe(33)
    expect(jobProgressPercent({ phase: 'writing', chunks_done: 9, chunks_total: 3 })).toBe(100)
  })

  it('labels import phases', () => {
    expect(importProgressLabel(undefined)).toBe('Importing…')
    expect(importProgressLabel({ phase: 'queued' })).toBe('Waiting to start…')
    expect(importProgressLabel({ phase: 'parsing' })).toBe('Reading file…')
    expect(importProgressLabel({ phase: 'validating' })).toBe('Checking keys…')
    expect(importProgressLabel({ phase: 'writing', chunks_done: 1, chunks_total: 3 })).toBe(
      'Saving changes…',
    )
  })

  it('labels undo phases', () => {
    expect(undoProgressLabel({ phase: 'planning', chunks_total: 12 })).toBe('Checking 12 changes…')
    expect(undoProgressLabel({ phase: 'writing' })).toBe('Restoring strings…')
    expect(undoProgressLabel(null)).toBe('Undoing…')
  })
})
