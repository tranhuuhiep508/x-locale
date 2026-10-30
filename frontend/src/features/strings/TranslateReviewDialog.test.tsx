import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TranslateProposalItem } from '@/lib/api/types'
import { TooltipProvider } from '@/components/ui/tooltip'
import { TranslateReviewDialog } from './TranslateReviewDialog'
import { applyPayloadFromDrafts, type DescriptionConflict } from './translate-review'

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
        projectId="project"
        open loadingQueue={false} generating={false} applying={false} generated
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

it('shows structural findings, keeps Apply enabled, and rechecks a manual correction on blur', async () => {
  const { stringsApi } = await import('@/lib/api/strings')
  const qa = vi.spyOn(stringsApi, 'translationQA').mockResolvedValue({ qa: { en: { complete: true, issues: [] } } })
  const applied = vi.fn()
  const checked: TranslateProposalItem[] = [{
    ...items[0], source_text: 'Hello {name}', translations: { en: 'Hello' },
    qa: { en: { complete: true, issues: [{ code: 'placeholder_missing', severity: 'error', side: 'translation', message: 'Missing placeholder {name}' }] } },
  }]
  render(<TooltipProvider><TranslateReviewDialog
    projectId="project" open loadingQueue={false} generating={false} applying={false} generated
    error={null} items={checked} page={1} pageSize={50} total={1}
    onPageChange={vi.fn()} onClose={vi.fn()} onTranslate={vi.fn()} onApply={applied}
  /></TooltipProvider>)
  expect(screen.getByText('Error: Missing placeholder {name}')).toBeTruthy()
  expect(screen.getByText(/1 structural errors/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /^Apply/ }))
  expect(applied).toHaveBeenCalledTimes(1)
  fireEvent.change(screen.getByLabelText('en'), { target: { value: 'Hello {name}' } })
  expect(screen.queryByText('Error: Missing placeholder {name}')).toBeNull()
  await act(async () => { fireEvent.blur(screen.getByLabelText('en')) })
  await waitFor(() => expect(screen.getByText('No structural issues detected')).toBeTruthy())
  expect(qa).toHaveBeenCalledWith('project', { source_text: 'Hello {name}', translations: { en: 'Hello {name}' } })
  qa.mockRestore()
})


it('accepts memory before AI, blocks unsafe edits, and rechecks corrections', async () => {
  const { stringsApi } = await import('@/lib/api/strings')
  const errorQA = { complete: true, issues: [{ code: 'placeholder_missing', severity: 'error' as const, side: 'translation' as const, message: 'Missing placeholder {name}' }] }
  const qa = vi.spyOn(stringsApi, 'translationQA').mockImplementation(async (_pid, body) => ({
    qa: { en: body.translations.en.includes('{name}') ? { complete: true, issues: [] } : errorQA },
  }))
  const applied = vi.fn()
  const queued: TranslateProposalItem[] = [{
    ...items[0], source_text: 'Hello {name}', translations: { en: '' }, scores: {},
    memory_suggestions: { en: [{
      string_id: 'donor', key: 'published', source_text: 'Hello {name}', value: 'Hi {name}',
      module_id: null, module_slug: null, published_at: '2026-10-30T00:00:00Z',
      match_type: 'exact', similarity: 1, can_accept: true, qa: { complete: true, issues: [] },
    }] },
  }]
  render(<TooltipProvider><TranslateReviewDialog
    projectId="project" open loadingQueue={false} generating={false} applying={false} generated={false}
    error={null} items={queued} page={1} pageSize={50} total={1}
    onPageChange={vi.fn()} onClose={vi.fn()} onTranslate={vi.fn()} onApply={applied}
  /></TooltipProvider>)
  expect(screen.getByText('Previously published')).toBeTruthy()
  expect(screen.queryByRole('button', { name: /^Apply/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Use translation' }))
  await waitFor(() => expect((screen.getByRole('button', { name: /^Apply/ }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: /^Apply/ }))
  expect(applied.mock.calls[0][0][0]).toMatchObject({ translations: { en: 'Hi {name}' }, memory_locales: ['en'] })
  expect(qa).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('en'), { target: { value: 'Broken' } })
  await act(async () => { fireEvent.blur(screen.getByLabelText('en')) })
  await screen.findByText('Error: Missing placeholder {name}')
  expect((screen.getByRole('button', { name: /^Apply/ }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('en'), { target: { value: 'Fixed {name}' } })
  await act(async () => { fireEvent.blur(screen.getByLabelText('en')) })
  await waitFor(() => expect((screen.getByRole('button', { name: /^Apply/ }) as HTMLButtonElement).disabled).toBe(false))
  qa.mockRestore()
})

it('shows unsafe memory suggestions with acceptance disabled', () => {
  const unsafe: TranslateProposalItem[] = [{ ...items[0], translations: { en: '' }, memory_suggestions: { en: [{
    string_id: 'donor', key: 'published', source_text: 'Hello', value: 'Hi',
    module_id: null, module_slug: null, published_at: '2026-10-30T00:00:00Z',
    match_type: 'fuzzy', similarity: 0.9, can_accept: false, qa: { complete: false, issues: [] },
  }] } }]
  render(<TooltipProvider><TranslateReviewDialog
    projectId="project" open loadingQueue={false} generating={false} applying={false} generated={false}
    error={null} items={unsafe} page={1} pageSize={50} total={1}
    onPageChange={vi.fn()} onClose={vi.fn()} onTranslate={vi.fn()} onApply={vi.fn()}
  /></TooltipProvider>)
  expect((screen.getByRole('button', { name: 'Use translation' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText('Fuzzy match · 90% similarity')).toBeTruthy()
})
