import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
    expect(screen.getByText('Placeholder price changed from {price, number} to {price, number, percent}.')).toBeTruthy()
    expect(screen.queryByText(/Missing placeholder/)).toBeNull()
    expect(screen.queryByText(/Extra placeholder/)).toBeNull()
    expect(screen.getAllByText('No QA issues').length).toBeGreaterThan(0)
    expect(screen.getByText('1 QA error. You can still apply.')).toBeTruthy()
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
      expect(screen.getByText('Missing placeholder {name} (source has 1, translation has 0).')).toBeTruthy()
      expect((screen.getByRole('button', { name: /^Apply/ }) as HTMLButtonElement).disabled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
