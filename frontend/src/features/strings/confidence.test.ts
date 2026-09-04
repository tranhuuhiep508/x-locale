import { describe, expect, it } from 'vitest'
import {
  CONFIDENCE_LOW_MAX,
  CONFIDENCE_REVIEW_MAX,
  confidenceLabel,
  confidenceTone,
  dropScore,
  mergeScores,
} from './confidence'

describe('confidenceTone', () => {
  it('treats 80+ as high, 50–79 as medium, below as low', () => {
    expect(confidenceTone(CONFIDENCE_REVIEW_MAX + 1)).toBe('high')
    expect(confidenceTone(CONFIDENCE_REVIEW_MAX)).toBe('medium')
    expect(confidenceTone(CONFIDENCE_LOW_MAX + 1)).toBe('medium')
    expect(confidenceTone(CONFIDENCE_LOW_MAX)).toBe('low')
  })
})

describe('confidenceLabel', () => {
  it('tells the user when to review or re-translate', () => {
    expect(confidenceLabel(92)).toContain('looks solid')
    expect(confidenceLabel(70)).toContain('review recommended')
    expect(confidenceLabel(40)).toContain('re-translate')
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
