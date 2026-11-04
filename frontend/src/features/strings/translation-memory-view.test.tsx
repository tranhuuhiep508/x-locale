import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

it('truncates a near-exact match and reserves Exact for exact matches', () => {
  const { rerender } = render(<MatchBar match={match} />)
  expect(screen.getByText('99% similar')).toBeTruthy()
  rerender(<MatchBar match={{ ...match, similarity: 1 }} />)
  expect(screen.getByText('99% similar')).toBeTruthy()
  rerender(<MatchBar match={{ ...match, exact: true, similarity: 1 }} />)
  expect(screen.getByText('Exact match')).toBeTruthy()
})

it('uses theme tokens for exact, high, and low similarity', () => {
  const { rerender } = render(<MatchBar match={{ ...match, exact: true, similarity: 1 }} />)
  const exact = screen.getByText('Exact match')
  expect(exact.className).toContain('text-azure-800')
  expect(exact.className).toContain('dark:text-azure-200')

  rerender(<MatchBar match={{ ...match, similarity: 0.91 }} />)
  const high = screen.getByText('91% similar')
  expect(high.className).toContain('text-azure-700')
  expect(high.className).toContain('dark:text-azure-300')

  rerender(<MatchBar match={{ ...match, similarity: 0.82 }} />)
  const low = screen.getByText('82% similar')
  expect(low.className).toContain('text-haze-600')
  expect(low.className).toContain('dark:text-haze-400')
})

const panel = {
  locales: ['en', 'fr'],
  selected: {},
  onUse: () => {},
  onUseExact: () => {},
  onRetry: () => {},
}

it('offers a retry when published translations fail to load', () => {
  const onRetry = vi.fn()
  render(<TranslationMemoryPanel {...panel} onRetry={onRetry} matches={{}} loading={false} error="offline" />)
  expect(screen.getByRole('status').textContent).toBe('Could not load published translations.')
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
  expect(onRetry).toHaveBeenCalledOnce()
  expect(screen.queryByText('0/2')).toBeNull()
  expect(screen.queryByText(/No match/)).toBeNull()
})

it('uses one line when nothing was previously published', () => {
  render(<TranslationMemoryPanel {...panel} matches={{ en: [], fr: [] }} loading={false} />)
  expect(screen.getByText(/No previously published match for this source text/)).toBeTruthy()
  expect(screen.queryByText('0/2')).toBeNull()
  expect(screen.queryByText(/No match/)).toBeNull()
})

it('puts extra matches inline and marks only the chosen match used', () => {
  const other: TranslationMemoryMatch = { ...match, string_id: 'b', key: 'other.greeting', translation: 'Bonjour' }
  render(
    <TranslationMemoryPanel
      {...panel}
      locales={['en']}
      matches={{ en: [match, other] }}
      loading={false}
      selected={{ en: 'b' }}
    />,
  )
  const more = screen.getByRole('button', { name: 'More matches for en' })
  expect(more.textContent).toContain('+1')
  expect(more.parentElement?.contains(screen.getAllByText('99% similar')[0])).toBe(true)
  expect(screen.queryByRole('button', { name: /Show less/ })).toBeNull()
  fireEvent.click(more)
  expect(screen.getByRole('button', { name: 'Use en match from greeting' }).textContent).toBe('Use')
  expect(screen.getByRole('button', { name: 'Use en match from other.greeting' }).textContent).toBe('Used')
  expect(screen.getByRole('button', { name: 'Use en match from greeting' }).getAttribute('data-variant')).toBe('outline')
})

it('keeps stale matches on screen and refuses Use until they refresh', () => {
  const onUse = vi.fn()
  const onUseExact = vi.fn()
  const { container } = render(
    <TranslationMemoryPanel
      {...panel}
      locales={['en']}
      matches={{ en: [{ ...match, exact: true }] }}
      loading={false}
      stale
      onUse={onUse}
      onUseExact={onUseExact}
    />,
  )
  const use = screen.getByRole('button', { name: 'Use en match from greeting' }) as HTMLButtonElement
  const exact = screen.getByRole('button', { name: 'Use 1 exact' }) as HTMLButtonElement
  expect(use.disabled).toBe(true)
  expect(exact.disabled).toBe(true)
  expect(container.querySelector('.opacity-60')).toBeTruthy()
  expect(screen.getByText('Bonjour')).toBeTruthy()
  expect(screen.queryByRole('status', { name: 'Finding published translations…' })).toBeNull()
  fireEvent.click(use)
  fireEvent.click(exact)
  expect(onUse).not.toHaveBeenCalled()
  expect(onUseExact).not.toHaveBeenCalled()
})
