import { describe, expect, it } from 'vitest'
import { importReviewBatchId } from './import-continuation'

const base = { batch_id: 'b1', dry_run: false, created: 1, updated: 0, total: 1 }

describe('importReviewBatchId', () => {
  it('returns the batch of a real import that wrote strings', () => {
    expect(importReviewBatchId(base)).toBe('b1')
    expect(importReviewBatchId({ ...base, created: 0, updated: 2 })).toBe('b1')
  })

  it('offers nothing for dry runs, no-op imports, or missing ids', () => {
    expect(importReviewBatchId({ ...base, dry_run: true })).toBeNull()
    expect(importReviewBatchId({ ...base, created: 0, updated: 0 })).toBeNull()
    expect(importReviewBatchId({ ...base, batch_id: null })).toBeNull()
    expect(importReviewBatchId(null)).toBeNull()
  })
})
