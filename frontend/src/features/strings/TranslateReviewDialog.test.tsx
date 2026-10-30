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
