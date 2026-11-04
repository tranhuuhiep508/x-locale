import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QaIssue, TranslateProposalItem } from '@/lib/api/types'
import { stringsApi } from '@/lib/api/strings'
import { TooltipProvider } from '@/components/ui/tooltip'
import { QA_DEBOUNCE_MS } from './qa-issues'
import { TranslateReviewDialog } from './TranslateReviewDialog'

vi.mock('@/lib/api/strings', () => ({
  stringsApi: {
    translateQa: vi.fn().mockResolvedValue({ locale: 'en', issues: [] }),
  },
}))

const items: TranslateProposalItem[] = [{
  string_id: 'a', key: 'greeting', source_text: 'Xin chào', status: 'draft',
  description: 'Original', translations: { en: 'Hello' }, scores: { en: 90 },
}]

afterEach(cleanup)
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
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
        generated
        error={null}
        items={items}
        page={1}
        pageSize={50}
        total={items.length}
        onPageChange={vi.fn()}
        onClose={vi.fn()}
        onTranslate={vi.fn()}
        onSaveDraft={vi.fn()}
        onReviewPublish={vi.fn()}
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

  it('shows one placeholder-changed item, hides clean QA badges, and still allows apply', () => {
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
    expect(within(popover).getByText('Advisory only. You can still save or publish.')).toBeTruthy()
    expect(screen.queryByText(/Missing placeholder/)).toBeNull()
    expect(screen.queryByText(/Extra placeholder/)).toBeNull()
    expect(screen.queryByText('No QA issues')).toBeNull()
    const apply = screen.getByRole('button', { name: 'Save as draft' }) as HTMLButtonElement
    expect(apply.disabled).toBe(false)
    const edited = screen.getByLabelText('en', { selector: '#proposal-a-en' }) as HTMLTextAreaElement
    expect(edited.getAttribute('aria-invalid')).toBeNull()
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
      expect(screen.queryByText('No QA issues')).toBeNull()
      fireEvent.change(screen.getByLabelText('en'), { target: { value: 'Hello' } })
      expect(screen.getAllByText('Checking…').length).toBeGreaterThan(0)
      expect((screen.getByRole('button', { name: 'Save as draft' }) as HTMLButtonElement).disabled).toBe(false)
      await act(async () => { await vi.advanceTimersByTimeAsync(QA_DEBOUNCE_MS) })
      fireEvent.click(screen.getByRole('button', { name: /QA for en/ }))
      const popover = document.querySelector('[data-slot="popover-content"]') as HTMLElement
      expect(within(popover).getByText('Missing placeholder {name} (source has 1, translation has 0).')).toBeTruthy()
      expect(within(popover).getByText('Advisory only. You can still save or publish.')).toBeTruthy()
      expect((screen.getByRole('button', { name: 'Save as draft' }) as HTMLButtonElement).disabled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not report a clean cell when a QA recheck fails', async () => {
    vi.useFakeTimers()
    vi.mocked(stringsApi.translateQa).mockRejectedValueOnce(new Error('offline'))
    try {
      review([{
        string_id: 'a', key: 'greeting', source_text: 'Hello {name}', status: 'draft',
        translations: { en: 'Hi {name}' }, issues: { en: [] },
      }])
      fireEvent.change(screen.getByLabelText('en'), { target: { value: 'Hi' } })
      await act(async () => { await vi.advanceTimersByTimeAsync(QA_DEBOUNCE_MS) })
      expect(screen.getByText('QA failed')).toBeTruthy()
      expect(screen.queryByText('No QA issues')).toBeNull()
      expect((screen.getByRole('button', { name: 'Save as draft' }) as HTMLButtonElement).disabled).toBe(false)
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
  render(<TooltipProvider><TranslateReviewDialog open projectId="p" loadingQueue={false} generating={false} generated error={null}
    items={items} page={1} pageSize={50} total={70} onPageChange={vi.fn()} onClose={vi.fn()} onTranslate={onTranslate} onSaveDraft={onApply} onReviewPublish={vi.fn()} /></TooltipProvider>)
  return { onTranslate, onApply }
}

it('fills the editor and hides the AI QA badge while a cell uses a match', () => {
  memoryReview([{ ...memoryItems[0], issues: { en: priceChange } }])
  const greeting = screen.getByRole('group', { name: 'Translations for greeting' })
  expect(within(greeting).getByRole('button', { name: /QA for en/ })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Use match for en in greeting' }))
  expect((within(greeting).getByRole('textbox', { name: 'en' }) as HTMLTextAreaElement).value).toBe('Published hello')
  expect(within(greeting).queryByRole('button', { name: /QA for en/ })).toBeNull()
  expect(within(greeting).getByRole('button', { name: 'Use match for en in greeting' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Use match for en in greeting' }))
  expect((within(greeting).getByRole('textbox', { name: 'en' }) as HTMLTextAreaElement).value).toBe('Hello')
  expect(within(greeting).getByRole('button', { name: /QA for en/ })).toBeTruthy()
})

it('bulk uses exact matches on the current page, excludes them from AI, and undoes only those cells', () => {
  const { onTranslate, onApply } = memoryReview()
  const useExact = screen.getByRole('button', { name: 'Use 1 exact match' })
  fireEvent.click(useExact)
  const unmatched = screen.getByRole('group', { name: 'Translations for unmatched' })
  fireEvent.change(within(unmatched).getByLabelText('en'), { target: { value: 'Manual text' } })
  // A manual cell edit dismisses Undo so it can never overwrite later work.
  expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Translate again' }))
  expect(onTranslate.mock.calls[0][0][0].memory_selected).toEqual(['en'])
  fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
  expect(onApply.mock.calls[0][0][1].translations.en).toBe('Manual text')
})

it('restores AI text and selection with Undo and the Use match toggle', () => {
  memoryReview()
  fireEvent.click(screen.getByRole('button', { name: 'Use 1 exact match' }))
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  const greeting = screen.getByRole('group', { name: 'Translations for greeting' })
  expect((within(greeting).getByLabelText('en') as HTMLTextAreaElement).value).toBe('Hello')
  expect(screen.getByText('Original')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Use match for en in greeting' }))
  expect((within(greeting).getByLabelText('en') as HTMLTextAreaElement).value).toBe('Published hello')
  fireEvent.click(screen.getByRole('button', { name: 'Use match for en in greeting' }))
  expect((within(greeting).getByLabelText('en') as HTMLTextAreaElement).value).toBe('Hello')
})

it.each(['source change', 'page change'])('discards restore history after a %s', (change) => {
  const props = {
    open: true, projectId: 'p', loadingQueue: false, generating: false, generated: true,
    error: null, page: 1, pageSize: 50, total: 1,
    onPageChange: vi.fn(), onClose: vi.fn(), onTranslate: vi.fn(), onSaveDraft: vi.fn(), onReviewPublish: vi.fn(),
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
})

function pagedReview(initial: { page?: number; total?: number; items?: TranslateProposalItem[]; reviewing?: boolean } = {}) {
  const onPageChange = vi.fn()
  const props = {
    open: true,
    projectId: 'p',
    loadingQueue: false,
    generating: false,
    generated: false,
    reviewing: false,
    error: null,
    items: memoryItems,
    page: 1,
    pageSize: 50,
    total: 70,
    onPageChange,
    onClose: vi.fn(),
    onTranslate: vi.fn(),
    onSaveDraft: vi.fn(),
    onReviewPublish: vi.fn(),
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

it('blocks paging while generated translations differ from the loaded page', async () => {
  const loaded: TranslateProposalItem[] = [
    { string_id: 'a', key: 'greeting', source_text: 'Xin chào', status: 'draft', description: 'Original', translations: { en: '' } },
    { string_id: 'b', key: 'unmatched', source_text: 'Other', status: 'draft', translations: { en: '' } },
  ]
  const proposals = loaded.map((item) => ({ ...item, translations: { en: `AI ${item.key}` }, scores: { en: 88 } }))
  const waiting = pagedReview({ items: loaded })
  expect(screen.getByRole('button', { name: 'Next page' }).getAttribute('aria-disabled')).toBeNull()

  waiting.rerender({ generated: true, items: proposals })
  const next = screen.getByRole('button', { name: 'Next page' })
  expect(next.getAttribute('aria-disabled')).toBe('true')
  expect((next as HTMLButtonElement).disabled).toBe(false)
  await act(async () => {
    next.focus()
  })
  expect((await screen.findByRole('tooltip')).textContent).toBe("Save or undo this page's changes first")
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
  fireEvent.click(screen.getByRole('button', { name: 'Use 1 exact match' }))
  const next = screen.getByRole('button', { name: 'Next page' })
  expect((screen.getByRole('button', { name: 'Previous page' }) as HTMLButtonElement).disabled).toBe(true)
  expect(next.getAttribute('aria-disabled')).toBe('true')
  expect((next as HTMLButtonElement).disabled).toBe(false)
  await act(async () => {
    next.focus()
  })
  expect(document.activeElement).toBe(next)
  expect((await screen.findByRole('tooltip')).textContent).toBe("Save or undo this page's changes first")
  fireEvent.click(next)
  expect(blocked.onPageChange).not.toHaveBeenCalled()

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
  const unlocked = screen.getByRole('button', { name: 'Next page' })
  expect(unlocked.getAttribute('aria-disabled')).toBeNull()
  fireEvent.click(unlocked)
  expect(reverted.onPageChange).toHaveBeenCalledWith(2)
})

it('marks the active step across Translate, Review, and Publish', () => {
  const emptyItem: TranslateProposalItem = {
    string_id: 'a',
    key: 'greeting',
    source_text: 'Xin chào',
    status: 'draft',
    module_name: 'Common',
    translations: { en: '' },
  }
  const { rerender } = pagedReview({ items: [emptyItem], total: 1 })
  expect(screen.getByText('Common')).toBeTruthy()
  const stepper = () => screen.getByRole('group', { name: 'Translation progress' })
  expect(within(stepper()).getByText('Translate').closest('[aria-current="step"]')).toBeTruthy()

  fireEvent.change(screen.getByLabelText('en'), { target: { value: 'Hello' } })
  expect(within(stepper()).getByText('Review').closest('[aria-current="step"]')).toBeTruthy()

  rerender({ items: [emptyItem], total: 1, generated: true, reviewing: true })
  expect(within(stepper()).getByText('Publish').closest('[aria-current="step"]')).toBeTruthy()
})

