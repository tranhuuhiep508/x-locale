import { describe, expect, it } from 'vitest'
import { activityActionLabel, activityFieldLabel } from '@/features/activity/activity-copy'

describe('activityActionLabel', () => {
  it('names discard separately from restore', () => {
    expect(activityActionLabel('string.discarded')).toBe('Discarded unpublished changes')
    expect(activityActionLabel('string.restored')).toBe('Restored')
  })

  it('names common catalog actions', () => {
    expect(activityActionLabel('string.created')).toBe('Created a string')
    expect(activityActionLabel('translation.updated')).toBe('Updated a translation')
  })
})

describe('activityFieldLabel', () => {
  it('uses locale codes and human field names', () => {
    expect(activityFieldLabel({ field: 'translation', locale: 'en', before: 'Hi', after: 'Hello' })).toBe(
      'EN',
    )
    expect(
      activityFieldLabel({ field: 'source_text', locale: null, before: 'A', after: 'B' }),
    ).toBe('Source')
  })
})
