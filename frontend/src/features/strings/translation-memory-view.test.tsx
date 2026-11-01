import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { MatchBar } from './translation-memory-view'
import type { TranslationMemoryMatch } from '@/lib/api/types'

afterEach(cleanup)
const match: TranslationMemoryMatch = {
  string_id: 'a',
  key: 'greeting',
  module_id: null,
  module_slug: null,
  matched_source_text: 'Hello',
  translation: 'Bonjour',
  exact: false,
  similarity: 0.996,
  issues: [],
}

it('truncates a near-exact match and reserves 100 for exact matches', () => {
  const { rerender } = render(<MatchBar match={match} />)
  expect(screen.getByText('99% similar')).toBeTruthy()
  expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('99')
  expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toBe(
    '99% similar source, previously published'
  )
  rerender(<MatchBar match={{ ...match, similarity: 1 }} />)
  expect(screen.getByText('99% similar')).toBeTruthy()
  rerender(<MatchBar match={{ ...match, exact: true, similarity: 1 }} />)
  expect(screen.getByText('Exact match')).toBeTruthy()
  expect(screen.getByRole('meter').getAttribute('aria-valuenow')).toBe('100')
})

it('shows the minimum visible fill for an 80% match', () => {
  render(<MatchBar match={{ ...match, similarity: 0.8 }} />)
  expect(screen.getByRole('meter').firstElementChild?.getAttribute('style')).toContain('width: 10%')
})
