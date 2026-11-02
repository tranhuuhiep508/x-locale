import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QaIssue, TranslateProposalItem } from '@/lib/api/types'
import { stringsApi } from '@/lib/api/strings'
import { TooltipProvider } from '@/components/ui/tooltip'
import { QA_DEBOUNCE_MS } from './qa-issues'
import { TranslateReviewDialog } from './TranslateReviewDialog'
import { applyPayloadFromDrafts, type DescriptionConflict } from './translate-review'

vi.mock('@/lib/api/strings', () => ({
  stringsApi: {
    translateQa: vi.fn().mockResolvedValue({ locale: 'en', issues: [] }),
  },
}))

const items: TranslateProposalItem[] = [{
  string_id: 'a', key: 'greeting', source_text: 'Xin chào', status: 'draft',
  description: 'Original', translations: { en: 'Hello' }, scores: { en: 90 },
}]
const conflict: DescriptionConflict = { string_id: 'a', key: 'greeting', description: 'New context' }

afterEach(cleanup)
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})

describe('translation description conflict recovery', () => {
  it.each(['Use latest', 'Keep mine'])('preserves translations and retries after %s', (choice) => {
    const applied = vi.fn()
    function Review() {
      const [conflicts, setConflicts] = useState<DescriptionConflict[]>([])
      const [originals, setOriginals] = useState<Record<string, string | null>>({ a: 'Original' })
      return <TranslateReviewDialog
        open projectId="proj-1" loadingQueue={false} generating={false} applying={false} generated
        error={null} items={items} page={1} pageSize={50} total={1}
        onPageChange={vi.fn()} onClose={vi.fn()} onTranslate={vi.fn()}
        conflicts={conflicts}
        onResolveConflict={(resolved) => {
          setOriginals({ a: resolved.description })
          setConflicts([])
        }}
        onApply={(drafts) => {
          applied(applyPayloadFromDrafts(drafts, originals))
          if (applied.mock.calls.length === 1) setConflicts([conflict])
        }}
      />
    }
    render(<TooltipProvider><Review /></TooltipProvider>)
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'My context' } })
    fireEvent.change(screen.getByLabelText('en'), { target: { value: 'My translation' } })
    fireEvent.click(screen.getByRole('button', { name: /^Apply/ }))
    expect(screen.getByText('Latest saved description: New context')).toBeTruthy()
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('My translation')
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('My context')
    expect((screen.getByRole('button', { name: /^Apply/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: choice }))
    expect(applied).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /^Apply/ }))
    const payload = applied.mock.calls[1][0][0]
    expect(payload.translations).toEqual({ en: 'My translation' })
    expect(payload.scores).toEqual({})
    if (choice === 'Keep mine') {
      expect(payload).toMatchObject({ description: 'My context', expected_description: 'New context' })
    } else {
      expect(payload).not.toHaveProperty('description')
      expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('New context')
    }
  })
})

const priceChange: QaIssue[] = [
  {
    code: 'placeholder_missing',
    severity: 'error',
    message: 'Missing placeholder {price, number} (source has 1, translation has 0).',
    start: null,
    end: null,
    detail: { token: '{price, number}', source_count: 1, translation_count: 0 },
  },
  {
    code: 'placeholder_extra',
    severity: 'error',
    message: 'Extra placeholder {price, number, percent} (source has 0, translation has 1).',
    start: null,
    end: null,
    detail: { token: '{price, number, percent}', source_count: 0, translation_count: 1 },
  },
]

function review(items: TranslateProposalItem[]) {
  render(
    <TooltipProvider>
      <TranslateReviewDialog
        open
        projectId="proj-1"
        loadingQueue={false}
        generating={false}
        applying={false}
        generated
        error={null}
        items={items}
        page={1}
        pageSize={50}
        total={items.length}
        onPageChange={vi.fn()}
        onClose={vi.fn()}
        onTranslate={vi.fn()}
        onApply={vi.fn()}
      />
    </TooltipProvider>,
  )
}

describe('translation QA in review', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
      configurable: true,
      value: () => false,
    })
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
      configurable: true,
      value: () => {},
    })
    Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
      configurable: true,
      value: () => {},
    })
    class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  })

  it('shows one placeholder-changed item and still allows apply', () => {
    review([
      {
        string_id: 'a',
        key: 'price',
        source_text: 'Save {price, number}',
        status: 'draft',
        translations: { en: 'Save {price, number, percent}', de: 'Spare {price, number}' },
        scores: { en: 90, de: 80 },
        issues: {
          en: priceChange,
          de: [],
        },
      },
      {
        string_id: 'b',
        key: 'clean',
        source_text: 'Hello',
        status: 'draft',
        translations: { en: 'Hello' },
        issues: { en: [] },
      },
    ])
    fireEvent.click(screen.getByRole('button', { name: /QA for en/ }))
    const popover = document.querySelector('[data-slot="popover-content"]') as HTMLElement
    expect(within(popover).getByText('Placeholder price changed from {price, number} to {price, number, percent}.')).toBeTruthy()
    expect(within(popover).getByText('Advisory only. You can still apply.')).toBeTruthy()
    expect(screen.queryByText(/Missing placeholder/)).toBeNull()
    expect(screen.queryByText(/Extra placeholder/)).toBeNull()
    expect(screen.getAllByText('No QA issues').length).toBeGreaterThan(0)
    expect(screen.queryByText('1 QA error. You can still apply.')).toBeNull()
    const apply = screen.getByRole('button', { name: /^Apply/ }) as HTMLButtonElement
    expect(apply.disabled).toBe(false)
    const edited = screen.getByLabelText('en', { selector: '#proposal-a-en' }) as HTMLTextAreaElement
    expect(edited.getAttribute('aria-invalid')).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Errors 1' }))
    expect(screen.queryByText('clean')).toBeNull()
    expect(screen.getByText('price')).toBeTruthy()
  })

  it('rechecks an edited translation without disabling apply', async () => {
    vi.useFakeTimers()
    vi.mocked(stringsApi.translateQa).mockResolvedValue({
      locale: 'en',
      issues: [{
        code: 'placeholder_missing',
        severity: 'error',
        message: 'Missing placeholder {name} (source has 1, translation has 0).',
        start: null,
        end: null,
        detail: { token: '{name}', source_count: 1, translation_count: 0 },
      }],
    })
    try {
      review([{
        string_id: 'a',
        key: 'greeting',
        source_text: 'Hello {name}',
        status: 'draft',
        translations: { en: 'Hello {name}' },
        issues: { en: [] },
      }])
      expect(screen.getAllByText('No QA issues').length).toBeGreaterThan(0)
      fireEvent.change(screen.getByLabelText('en'), { target: { value: 'Hello' } })
      expect(screen.getAllByText('Checking…').length).toBeGreaterThan(0)
      expect((screen.getByRole('button', { name: /^Apply/ }) as HTMLButtonElement).disabled).toBe(false)
      await act(async () => { await vi.advanceTimersByTimeAsync(QA_DEBOUNCE_MS) })
      fireEvent.click(screen.getByRole('button', { name: /QA for en/ }))
      const popover = document.querySelector('[data-slot="popover-content"]') as HTMLElement
      expect(within(popover).getByText('Missing placeholder {name} (source has 1, translation has 0).')).toBeTruthy()
      expect(within(popover).getByText('Advisory only. You can still apply.')).toBeTruthy()
      expect((screen.getByRole('button', { name: /^Apply/ }) as HTMLButtonElement).disabled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('summarizes a review card as one badge', () => {
    review([{
      string_id: 'a',
      key: 'promo',
      source_text: 'Hello {name}',
      status: 'draft',
      translations: { en: 'Hi', de: 'Hallo' },
      issues: {
        en: [{
          code: 'placeholder_missing',
          severity: 'error',
          message: 'Missing placeholder {name}.',
          start: null,
          end: null,
          detail: null,
        }],
        de: [{
          code: 'length',
          severity: 'warning',
          message: 'Translation is long.',
          start: null,
          end: null,
          detail: null,
        }],
      },
    }])
    expect(screen.getByText('2 issues').textContent).toContain('2 issues')
    expect(screen.getAllByRole('button', { name: /QA for promo/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /QA for promo/ }))
    const popover = document.querySelector('[data-slot="popover-content"]') as HTMLElement
    expect(within(popover).getByText('Missing placeholder {name}.')).toBeTruthy()
    expect(within(popover).getByText('Translation is long.')).toBeTruthy()
    expect(within(popover).getByText('placeholder_missing')).toBeTruthy()
    expect(within(popover).getByText('Advisory only. You can still apply.')).toBeTruthy()
    expect(screen.getByText('en', { selector: 'li span' })).toBeTruthy()
    expect(screen.getByText('de', { selector: 'li span' })).toBeTruthy()
  })

  it('dims the review-card summary badge while its QA result is stale', async () => {
    vi.useFakeTimers()
    vi.mocked(stringsApi.translateQa).mockResolvedValue({
      locale: 'en',
      issues: [{
        code: 'length',
        severity: 'warning',
        message: 'Translation is long.',
        start: null,
        end: null,
        detail: null,
      }],
    })
    try {
      review([{
        string_id: 'a',
        key: 'promo',
        source_text: 'Hello {name}',
        status: 'draft',
        translations: { en: 'Hi' },
        issues: {
          en: [{
            code: 'placeholder_missing',
            severity: 'error',
            message: 'Missing placeholder {name}.',
            start: null,
            end: null,
            detail: null,
          }],
        },
      }])
      const card = () => screen.getByRole('button', { name: /QA for promo/ })
      expect(card().className).not.toContain('opacity-50')
      fireEvent.change(screen.getByLabelText('en'), { target: { value: 'Hello there' } })
      expect(card().className).toContain('opacity-50')
      await act(async () => { await vi.advanceTimersByTimeAsync(QA_DEBOUNCE_MS) })
      expect(card().className).not.toContain('opacity-50')
    } finally {
      vi.useRealTimers()
    }
  })
})

const publishedMatch = { string_id: 'origin', key: 'published.greeting', module_id: null, module_slug: 'account', matched_source_text: 'Xin chào', translation: 'Published hello', exact: true, similarity: 1, issues: [] }
const memoryItems: TranslateProposalItem[] = [
  { ...items[0], memory: { en: [publishedMatch, { ...publishedMatch, string_id: 'other', key: 'other.greeting', exact: false, similarity: 0.996, translation: 'Another hello' }] } },
  { string_id: 'b', key: 'unmatched', source_text: 'Other', status: 'draft', translations: { en: '' } },
]
function memoryReview(items = memoryItems) {
  const onTranslate = vi.fn()
  const onApply = vi.fn()
  render(<TooltipProvider><TranslateReviewDialog open projectId="p" loadingQueue={false} generating={false} applying={false} generated error={null}
    items={items} page={1} pageSize={50} total={70} onPageChange={vi.fn()} onClose={vi.fn()} onTranslate={onTranslate} onApply={onApply} /></TooltipProvider>)
  return { onTranslate, onApply }
}

it('does not open the published-count tooltip when the dialog opens', () => {
  memoryReview()
  const count = screen.getByLabelText('Previously published: 1 of 2 cells have a match')
  expect(document.activeElement).not.toBe(count)
  expect(screen.queryByRole('tooltip')).toBeNull()
})

it('focuses the filter when the dialog opens instead of Use exact matches', () => {
  memoryReview()
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: /^All / }))
  expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Use 1 exact matches on this page' }))
  expect(screen.getAllByText('Description')[0].className).not.toContain('sr-only')
})

it('hides the AI QA badge and editor while a cell uses a match', () => {
  memoryReview([{ ...memoryItems[0], issues: { en: [] } }])
  const greeting = screen.getByRole('group', { name: 'Translations for greeting' })
  expect(within(greeting).getAllByText('No QA issues').length).toBeGreaterThan(0)
  fireEvent.click(screen.getByRole('button', { name: 'Use match for en in greeting' }))
  expect(within(greeting).queryByRole('textbox', { name: 'en' })).toBeNull()
  expect(within(greeting).queryByText('No QA issues')).toBeNull()
  expect(within(greeting).getByText('Skipped · using match')).toBeTruthy()
  expect(within(greeting).getByText('Skipped · using match').closest('tr')?.className).toContain('bg-public')
  expect(within(greeting).getAllByText('Published hello').length).toBeGreaterThan(1)
  fireEvent.click(screen.getByRole('button', { name: 'Use match for en in greeting' }))
  expect(within(greeting).getByRole('textbox', { name: 'en' })).toBeTruthy()
  expect(within(greeting).getAllByText('No QA issues').length).toBeGreaterThan(0)
})

it('folds clean locales on a page of nine strings until one is opened', () => {
  review(Array.from({ length: 9 }, (_, index) => ({
    string_id: `s${index}`,
    key: `key.${index}`,
    source_text: 'Hello',
    status: 'draft' as const,
    translations: { en: `Hello ${index}` },
    issues: { en: [] },
  })))
  expect(screen.queryByRole('textbox', { name: 'en' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Hello 0' }))
  expect((screen.getByRole('textbox', { name: 'en' }) as HTMLTextAreaElement).value).toBe('Hello 0')
})

it('bulk uses exact matches on the current page, excludes them from AI, and undoes only those cells', () => {
  const { onTranslate, onApply } = memoryReview()
  expect(screen.getByLabelText('Previously published: 1 of 2 cells have a match')).toBeTruthy()
  expect(screen.getByRole('radio', { name: 'With matches 1' })).toBeTruthy()
  expect(screen.getByRole('radio', { name: 'Exact 1' })).toBeTruthy()
  const useExact = screen.getByRole('button', { name: 'Use 1 exact matches on this page' })
  expect(useExact.getAttribute('data-variant')).toBe('outline')
  fireEvent.click(useExact)
  expect(screen.getByLabelText('1 cells use a match')).toBeTruthy()
  const unmatched = screen.getByRole('group', { name: 'Translations for unmatched' })
  fireEvent.change(within(unmatched).getByLabelText('en'), { target: { value: 'Manual text' } })
  // A manual cell edit dismisses Undo so it can never overwrite later work.
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Translate again · 1 cells' }))
  expect(onTranslate.mock.calls[0][0][0].memory_selected).toEqual(['en'])
  fireEvent.click(screen.getByRole('button', { name: 'Apply 2 translations' }))
  expect(onApply.mock.calls[0][0][1].translations.en).toBe('Manual text')
})

it('restores AI text, confidence and selection with Undo and the Use match toggle', () => {
  memoryReview()
  fireEvent.click(screen.getByRole('button', { name: 'Use 1 exact matches on this page' }))
  fireEvent.change(screen.getAllByLabelText('Description')[0], { target: { value: 'Keep new context' } })
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  const greeting = screen.getByRole('group', { name: 'Translations for greeting' })
  expect((within(greeting).getByLabelText('en') as HTMLTextAreaElement).value).toBe('Hello')
  expect(within(greeting).getByLabelText(/Model estimate 90\/100/)).toBeTruthy()
  expect((screen.getAllByLabelText('Description')[0] as HTMLTextAreaElement).value).toBe('Keep new context')
  fireEvent.click(screen.getByRole('button', { name: 'Use match for en in greeting' }))
  expect(within(greeting).queryByRole('textbox', { name: 'en' })).toBeNull()
  expect(within(greeting).getAllByText('Published hello').length).toBeGreaterThan(1)
  expect(within(greeting).getByText('Skipped · using match')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Use match for en in greeting' }))
  expect((within(greeting).getByLabelText('en') as HTMLTextAreaElement).value).toBe('Hello')
})

it('filters strings with matches and opens the AI comparison with individually selectable alternatives', () => {
  memoryReview()
  fireEvent.click(screen.getByRole('radio', { name: /With matches/ }))
  expect(screen.queryByText('unmatched')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Compare en matches for greeting' }))
  expect(screen.getByText('99% similar')).toBeTruthy()
  expect(screen.getByText('Source: Xin chào')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Use en match from other.greeting' }))
  expect(screen.queryByRole('textbox', { name: 'en' })).toBeNull()
  expect(screen.getAllByText('Another hello').length).toBeGreaterThan(1)
  expect(screen.getByText('Skipped · using match')).toBeTruthy()
  fireEvent.click(screen.getByRole('radio', { name: 'All 2' }))
  expect(screen.getByText('unmatched')).toBeTruthy()
})

it('switches off an incoming selection even after choosing another match without restore history', () => {
  memoryReview([{ ...memoryItems[0], translations: { en: 'Published hello' }, memory_selected: ['en'], scores: {} }])
  fireEvent.click(screen.getByRole('button', { name: 'Compare en matches for greeting' }))
  fireEvent.click(screen.getByRole('button', { name: 'Use en match from other.greeting' }))
  fireEvent.click(screen.getByRole('button', { name: 'Use match for en in greeting' }))
  expect(screen.getByRole('button', { name: 'Use match for en in greeting' }).getAttribute('aria-pressed')).toBe('false')
})

it.each(['source change', 'page change'])('discards restore history after a %s', (change) => {
  const props = {
    open: true, projectId: 'p', loadingQueue: false, generating: false, applying: false, generated: true,
    error: null, page: 1, pageSize: 50, total: 1,
    onPageChange: vi.fn(), onClose: vi.fn(), onTranslate: vi.fn(), onApply: vi.fn(),
  }
  const view = (items: TranslateProposalItem[]) => <TooltipProvider><TranslateReviewDialog {...props} items={items} /></TooltipProvider>
  const { rerender } = render(view([memoryItems[0]]))
  fireEvent.click(screen.getByRole('button', { name: 'Use match for en in greeting' }))
  if (change === 'page change') rerender(view([]))
  rerender(view([{
    ...memoryItems[0],
    source_text: change === 'source change' ? 'New source' : memoryItems[0].source_text,
    translations: { en: 'New AI text' }, scores: { en: 81 },
  }]))
  fireEvent.click(screen.getByRole('button', { name: 'Use match for en in greeting' }))
  fireEvent.click(screen.getByRole('button', { name: 'Use match for en in greeting' }))
  expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('New AI text')
  expect(screen.getByLabelText(/Model estimate 81\/100/)).toBeTruthy()
})

it('marks only the chosen match when two published translations are identical', () => {
  memoryReview([{
    ...memoryItems[0],
    memory: {
      en: [
        publishedMatch,
        { ...publishedMatch, string_id: 'other', key: 'other.greeting', translation: publishedMatch.translation },
      ],
    },
  }])
  fireEvent.click(screen.getByRole('button', { name: 'Compare en matches for greeting' }))
  fireEvent.click(screen.getByRole('button', { name: 'Use en match from other.greeting' }))
  expect(screen.getByRole('button', { name: 'Use en match from other.greeting' }).textContent).toBe('Used')
  expect(screen.getByRole('button', { name: 'Use en match from published.greeting' }).textContent).toBe('Use')
})

it('summarizes a page with no published matches in one line', () => {
  memoryReview([{ string_id: 'b', key: 'unmatched', source_text: 'Other', status: 'draft', translations: { en: '', ja: '' } }])
  expect(screen.getByText('No previously published matches on this page. Translate fills all 2 cells with AI.')).toBeTruthy()
  expect(screen.queryByText('0/2')).toBeNull()
  expect(screen.queryByLabelText(/cells have a match/)).toBeNull()
})

function pagedReview(initial: { page?: number; total?: number; items?: TranslateProposalItem[] } = {}) {
  const onPageChange = vi.fn()
  const props = {
    open: true,
    projectId: 'p',
    loadingQueue: false,
    generating: false,
    applying: false,
    generated: false,
    error: null,
    items: memoryItems,
    page: 1,
    pageSize: 50,
    total: 70,
    onPageChange,
    onClose: vi.fn(),
    onTranslate: vi.fn(),
    onApply: vi.fn(),
    ...initial,
  }
  const view = (next: Partial<typeof props> = {}) => (
    <TooltipProvider>
      <TranslateReviewDialog {...props} {...next} />
    </TooltipProvider>
  )
  const rendered = render(view())
  return {
    onPageChange,
    rerender: (next: Partial<typeof props>) => rendered.rerender(view(next)),
  }
}

it('names paged match actions and filter counts as this page only', () => {
  pagedReview()
  expect(screen.getByText('on this page')).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Use 1 exact matches on this page' })).toBeTruthy()
  expect(screen.getByText(/1–50 of 70/)).toBeTruthy()
  fireEvent.click(screen.getByRole('radio', { name: 'With matches 1' }))
  expect(screen.getByText('Showing 1 of 2 on this page')).toBeTruthy()
  expect(screen.queryByText('unmatched')).toBeNull()
})

it('keeps the short exact-match label when the queue fits on one page', () => {
  pagedReview({ total: 2 })
  expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Use 1 exact matches' }).textContent).toBe('Use 1 exact matches')
  expect(screen.queryByText('on this page')).toBeNull()
})

it('resets the filter when the page changes and keeps it when proposals refresh', () => {
  const { rerender } = pagedReview()
  fireEvent.click(screen.getByRole('radio', { name: 'Exact 1' }))
  expect(screen.queryByText('unmatched')).toBeNull()
  rerender({
    items: memoryItems.map((item) => ({ ...item, source_text: `${item.source_text} refreshed` })),
  })
  expect(screen.getByRole('radio', { name: 'Exact 1' }).getAttribute('aria-checked')).toBe('true')
  expect(screen.queryByText('unmatched')).toBeNull()
  rerender({
    page: 2,
    items: [{
      string_id: 'c',
      key: 'later.key',
      source_text: 'Later',
      status: 'draft',
      translations: { en: '' },
      memory: { en: [publishedMatch] },
    }],
  })
  expect(screen.getByRole('radio', { name: 'All 1' }).getAttribute('aria-checked')).toBe('true')
  expect(screen.getByText('later.key')).toBeTruthy()
  expect(screen.queryByText('No exact matches on this page')).toBeNull()
})

it('falls back to all when matches disappear and explains an already empty filter', () => {
  const withoutMemory = memoryItems.map((item) => ({ ...item, memory: undefined }))
  const { rerender } = pagedReview()
  fireEvent.click(screen.getByRole('radio', { name: 'Exact 1' }))
  rerender({ items: withoutMemory })
  expect(screen.getByRole('radio', { name: 'All 2' }).getAttribute('aria-checked')).toBe('true')
  expect(screen.getByText('unmatched')).toBeTruthy()
  expect(screen.queryByText('No exact matches on this page')).toBeNull()

  cleanup()
  pagedReview({ items: withoutMemory })
  fireEvent.click(screen.getByRole('radio', { name: 'Exact 0' }))
  expect(screen.getByText('No exact matches on this page')).toBeTruthy()
  expect(screen.getByRole('radio', { name: 'Exact 0' }).getAttribute('aria-checked')).toBe('true')
  fireEvent.click(screen.getByRole('radio', { name: 'With matches 0' }))
  expect(screen.getByText('No matches on this page')).toBeTruthy()
  expect(screen.getByRole('radio', { name: 'With matches 0' }).getAttribute('aria-checked')).toBe('true')
})

it('blocks paging while generated translations differ from the loaded page', async () => {
  const loaded: TranslateProposalItem[] = [
    { string_id: 'a', key: 'greeting', source_text: 'Xin chào', status: 'draft', description: 'Original', translations: { en: '' } },
    { string_id: 'b', key: 'unmatched', source_text: 'Other', status: 'draft', translations: { en: '' } },
  ]
  const proposals = loaded.map((item) => ({ ...item, translations: { en: `AI ${item.key}` }, scores: { en: 88 } }))
  const waiting = pagedReview({ items: loaded })
  const description = screen.getAllByLabelText('Description')[0].closest('[data-slot="field"]')
  expect(description?.className).toContain('w-full')
  expect(description?.className).toContain('sm:w-72')
  expect(description?.parentElement?.className).toContain('flex-col')
  expect(description?.parentElement?.className).toContain('sm:flex-row')
  expect(screen.getByRole('button', { name: 'Next page' }).getAttribute('aria-disabled')).toBeNull()

  waiting.rerender({ generated: true, items: proposals })
  const next = screen.getByRole('button', { name: 'Next page' })
  expect(next.getAttribute('aria-disabled')).toBe('true')
  expect((next as HTMLButtonElement).disabled).toBe(false)
  await act(async () => {
    next.focus()
  })
  expect((await screen.findByRole('tooltip')).textContent).toBe("Apply or undo this page's changes first")
  fireEvent.click(next)
  expect(waiting.onPageChange).not.toHaveBeenCalled()

  for (const key of ['greeting', 'unmatched']) {
    fireEvent.change(within(screen.getByRole('group', { name: `Translations for ${key}` })).getByLabelText('en'), {
      target: { value: '' },
    })
  }
  expect(screen.getByRole('button', { name: 'Next page' }).getAttribute('aria-disabled')).toBeNull()

  waiting.rerender({ generated: true, items: proposals.map((item) => ({ ...item })) })
  expect(screen.getByRole('button', { name: 'Next page' }).getAttribute('aria-disabled')).toBe('true')
  waiting.rerender({ generated: false, items: loaded })
  const unlocked = screen.getByRole('button', { name: 'Next page' })
  expect(unlocked.getAttribute('aria-disabled')).toBeNull()
  fireEvent.click(unlocked)
  expect(waiting.onPageChange).toHaveBeenCalledWith(2)
})

it('blocks next and previous while this page has unapplied work', async () => {
  const blocked = pagedReview()
  fireEvent.click(screen.getByRole('button', { name: 'Use 1 exact matches on this page' }))
  const next = screen.getByRole('button', { name: 'Next page' })
  expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true)
  expect(next.getAttribute('aria-disabled')).toBe('true')
  expect((next as HTMLButtonElement).disabled).toBe(false)
  await act(async () => {
    next.focus()
  })
  expect(document.activeElement).toBe(next)
  expect((await screen.findByRole('tooltip')).textContent).toBe("Apply or undo this page's changes first")
  fireEvent.click(next)
  expect(blocked.onPageChange).not.toHaveBeenCalled()
  expect(screen.getByText('Skipped · using match')).toBeTruthy()

  cleanup()
  const middle = pagedReview({ page: 2, total: 150 })
  fireEvent.click(screen.getByRole('button', { name: 'Use match for en in greeting' }))
  for (const name of ['Previous page', 'Next page']) {
    const control = screen.getByRole('button', { name })
    expect(control.getAttribute('aria-disabled')).toBe('true')
    expect((control as HTMLButtonElement).disabled).toBe(false)
  }
  fireEvent.click(screen.getByRole('button', { name: 'Previous page' }))
  expect(middle.onPageChange).not.toHaveBeenCalled()

  cleanup()
  const reverted = pagedReview()
  const unmatched = screen.getByRole('group', { name: 'Translations for unmatched' })
  fireEvent.change(within(unmatched).getByLabelText('en'), { target: { value: 'Manual text' } })
  expect(screen.getByRole('button', { name: 'Next page' }).getAttribute('aria-disabled')).toBe('true')
  fireEvent.change(within(unmatched).getByLabelText('en'), { target: { value: '' } })
  fireEvent.change(screen.getAllByLabelText('Description')[0], { target: { value: 'Changed context' } })
  expect(screen.getByRole('button', { name: 'Next page' }).getAttribute('aria-disabled')).toBe('true')
  fireEvent.change(screen.getAllByLabelText('Description')[0], { target: { value: 'Original' } })
  const unlocked = screen.getByRole('button', { name: 'Next page' })
  expect(unlocked.getAttribute('aria-disabled')).toBeNull()
  fireEvent.click(unlocked)
  expect(reverted.onPageChange).toHaveBeenCalledWith(2)
})
