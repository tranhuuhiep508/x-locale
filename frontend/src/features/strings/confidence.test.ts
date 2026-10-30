import { describe, expect, it } from 'vitest'
import {
  confidenceLabel,
  dropScore,
  mergeScores,
} from './confidence'

describe('confidenceLabel', () => {
  it('labels every score as an unverified model estimate', () => {
    for (const score of [92, 70, 40]) {
      expect(confidenceLabel(score)).toContain(`AI estimate ${score}`)
      expect(confidenceLabel(score)).toContain('heuristic, not verified')
    }
  })
})

describe('dropScore', () => {
  it('removes only the edited locale', () => {
    expect(dropScore({ en: 90, ja: 61 }, 'ja')).toEqual({ en: 90 })
    expect(dropScore({ en: 90 }, 'ja')).toEqual({ en: 90 })
  })
})

describe('mergeScores', () => {
  it('keeps scores for locales that already have text unless overwrite', () => {
    const merged = mergeScores(
      { en: 90 },
      { en: 40, ja: 61 },
      { en: 'Hello', ja: '' },
      { en: 'Hello', ja: 'こんにちは' },
      false,
    )
    expect(merged).toEqual({ en: 90, ja: 61 })
  })

  it('overwrites scores when requested', () => {
    const merged = mergeScores({ en: 90 }, { en: 40 }, { en: 'Hello' }, { en: 'Hello' }, true)
    expect(merged).toEqual({ en: 40 })
  })
})
