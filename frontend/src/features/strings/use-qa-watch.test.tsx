import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QaIssue } from '@/lib/api/types'
import { stringsApi } from '@/lib/api/strings'
import { QA_DEBOUNCE_MS } from './qa-issues'
import { useQaWatch, type QaWatchRow } from './use-qa-watch'

vi.mock('@/lib/api/strings', () => ({
  stringsApi: { translateQa: vi.fn() },
}))

const missing: QaIssue = {
  code: 'placeholder_missing',
  severity: 'error',
  message: 'Missing placeholder {name} (source has 1, translation has 0).',
  start: null,
  end: null,
  detail: { token: '{name}', source_count: 1, translation_count: 0 },
}

function row(text: string, baselineText = '', issues?: QaIssue[]): QaWatchRow {
  const baseline = { source: 'Hello {name}', text: baselineText }
  return {
    id: 'en',
    locale: 'en',
    source: 'Hello {name}',
    text,
    baseline: issues === undefined ? baseline : { ...baseline, issues },
  }
}

function Harness({ text, issues }: { text: string; issues?: QaIssue[] }) {
  const [value, setValue] = useState(text)
  const views = useQaWatch('proj-1', [row(value, text === 'Hello {name}' ? 'Hello {name}' : '', issues)])
  const view = views.en
  return (
    <div>
      <button type="button" onClick={() => setValue('Hi')}>edit</button>
      <button type="button" onClick={() => setValue('Hello {name}')}>revert</button>
      <button type="button" onClick={() => setValue('')}>clear</button>
      <div data-testid="status">{view.status}</div>
      <div data-testid="codes">{view.issues.map((issue) => issue.code).join(',')}</div>
      <div data-testid="stale">{view.stale ? 'stale' : 'fresh'}</div>
    </div>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.mocked(stringsApi.translateQa).mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useQaWatch', () => {
  it('waits until typing pauses, then ignores an older response', async () => {
    let resolveFirst: (value: { locale: string; issues: QaIssue[] }) => void = () => {}
    let resolveSecond: (value: { locale: string; issues: QaIssue[] }) => void = () => {}
    vi.mocked(stringsApi.translateQa)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve }))
    render(<Harness text="" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(QA_DEBOUNCE_MS) })
    expect(stringsApi.translateQa).not.toHaveBeenCalled()

    await act(async () => { screen.getByRole('button', { name: 'edit' }).click() })
    expect(screen.getByTestId('status').textContent).toBe('checking')
    await act(async () => { await vi.advanceTimersByTimeAsync(QA_DEBOUNCE_MS - 1) })
    expect(stringsApi.translateQa).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(stringsApi.translateQa).toHaveBeenCalledTimes(1)
    expect(vi.mocked(stringsApi.translateQa).mock.calls[0][1]).toEqual({
      source_text: 'Hello {name}',
      translation: 'Hi',
      locale: 'en',
    })

    await act(async () => { screen.getByRole('button', { name: 'revert' }).click() })
    await act(async () => { await vi.advanceTimersByTimeAsync(QA_DEBOUNCE_MS) })
    expect(stringsApi.translateQa).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveFirst({ locale: 'en', issues: [missing] })
      await Promise.resolve()
    })
    expect(screen.getByTestId('codes').textContent).not.toContain('placeholder_missing')

    await act(async () => {
      resolveSecond({ locale: 'en', issues: [] })
      await Promise.resolve()
    })
    expect(screen.getByTestId('status').textContent).toBe('ready')
    expect(screen.getByTestId('codes').textContent).toBe('')
  })

  it('keeps the previous issues dimmed when a recheck fails and does not block on an empty result', async () => {
    vi.mocked(stringsApi.translateQa).mockRejectedValue(new Error('offline'))
    render(<Harness text="Hello {name}" issues={[missing]} />)
    expect(screen.getByTestId('status').textContent).toBe('ready')
    expect(stringsApi.translateQa).not.toHaveBeenCalled()

    await act(async () => { screen.getByRole('button', { name: 'edit' }).click() })
    expect(screen.getByTestId('stale').textContent).toBe('stale')
    expect(screen.getByTestId('codes').textContent).toBe('placeholder_missing')
    await act(async () => { await vi.advanceTimersByTimeAsync(QA_DEBOUNCE_MS) })
    await act(async () => { await Promise.resolve() })
    expect(screen.getByTestId('status').textContent).toBe('failed')
    expect(screen.getByTestId('codes').textContent).toBe('placeholder_missing')
  })

  it('drops a check when the translation is cleared before the delay', async () => {
    render(<Harness text="" />)
    await act(async () => { screen.getByRole('button', { name: 'edit' }).click() })
    await act(async () => { screen.getByRole('button', { name: 'clear' }).click() })
    await act(async () => { await vi.advanceTimersByTimeAsync(QA_DEBOUNCE_MS) })
    expect(stringsApi.translateQa).not.toHaveBeenCalled()
    expect(screen.getByTestId('status').textContent).toBe('unchecked')
  })
})
