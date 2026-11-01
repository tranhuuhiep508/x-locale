import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MatchBar, TranslationMemoryPanel } from './translation-memory-view'
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

it.each([undefined, 'Lookup failed'])('renders one quiet line without counts when empty or failed (%s)', (error) => {
  render(<TranslationMemoryPanel locales={['en', 'ja']} matches={{}} loading={false} error={error} selected={{}} onUse={vi.fn()} onUseExact={vi.fn()} />)
  expect(screen.getAllByRole('status')).toHaveLength(1)
  expect(screen.getByRole('status').textContent).toContain(error ? 'Could not load published translations.' : 'No previously published match for this source text.')
  expect(screen.queryByText('0/2')).toBeNull()
  expect(screen.queryByText('No match · AI will translate')).toBeNull()
})
