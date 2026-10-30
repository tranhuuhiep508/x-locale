import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { stringsApi } from '@/lib/api/strings'
import type { TranslationQAMap } from '@/lib/api/types'
import { type QASeed, useTranslationQA } from './use-translation-qa'

vi.mock('@/lib/api/strings', () => ({ stringsApi: { translationQA: vi.fn() } }))
const clean = { issues: [], complete: true }
const bad = { issues: [{ code: 'placeholder_missing', severity: 'error' as const, side: 'translation' as const, message: 'Missing placeholder {name}' }], complete: true }
const mockQA = vi.mocked(stringsApi.translationQA)

beforeEach(() => { vi.useFakeTimers(); mockQA.mockReset(); mockQA.mockResolvedValue({ qa: { en: clean } }) })
afterEach(() => { cleanup(); vi.useRealTimers() })

async function advance(ms = 400) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

function pending() {
  let resolve!: (value: { qa: TranslationQAMap }) => void
  const promise = new Promise<{ qa: TranslationQAMap }>((done) => { resolve = done })
  return { promise, resolve }
}

describe('draft QA', () => {
  it('reuses matching server results and checks only after a debounced edit', async () => {
    const seed = { source: 'Hi {name}', translations: { en: 'Hi' }, qa: { en: bad } }
    const { result, rerender } = renderHook(({ text }) => useTranslationQA('p', seed.source, { en: text }, seed), { initialProps: { text: 'Hi' } })
    expect(result.current.qa.en).toEqual(bad)
    await advance()
    expect(mockQA).not.toHaveBeenCalled()
    rerender({ text: 'Hi {name}' })
    expect(result.current.qa.en).toBeUndefined()
    expect(result.current.status).toBe('checking')
    await advance(399)
    expect(mockQA).not.toHaveBeenCalled()
    await advance(1)
    expect(mockQA).toHaveBeenCalledTimes(1)
    expect(result.current.qa.en).toEqual(clean)
  })

  it('flushes on blur without duplicating the debounced request', async () => {
    const { result } = renderHook(() => useTranslationQA('p', 'Hi', { en: 'Hello' }))
    await act(async () => result.current.flush())
    await advance()
    expect(mockQA).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('checked')
  })

  it('rejects late responses, including A → B → A', async () => {
    const first = pending()
    mockQA.mockReturnValueOnce(first.promise)
    const { result, rerender } = renderHook(({ text }) => useTranslationQA('p', 'Hi {name}', { en: text }), { initialProps: { text: 'A' } })
    await advance()
    rerender({ text: 'B' })
    rerender({ text: 'A' })
    await act(async () => first.resolve({ qa: { en: bad } }))
    expect(result.current.qa.en).toBeUndefined()
    await advance()
    expect(result.current.qa.en).toEqual(clean)
  })

  it('invalidates every locale after a source edit and ignores post-close results', async () => {
    const request = pending()
    mockQA.mockReturnValue(request.promise)
    const seed = { source: 'Hi', translations: { en: 'Hello', fr: 'Bonjour' }, qa: { en: clean, fr: clean } }
    const { result, rerender } = renderHook(({ source, enabled }) => useTranslationQA('p', source, seed.translations, seed, enabled), { initialProps: { source: 'Hi', enabled: true } })
    rerender({ source: 'Hi {name}', enabled: true })
    expect(result.current.qa).toEqual({})
    await advance()
    expect(mockQA).toHaveBeenCalledWith('p', { source_text: 'Hi {name}', translations: seed.translations })
    rerender({ source: 'Hi {name}', enabled: false })
    await act(async () => request.resolve({ qa: { en: bad, fr: bad } }))
    expect(result.current.qa).toEqual({})
  })

  it('marks failures unavailable and retries on blur', async () => {
    mockQA.mockRejectedValueOnce(new Error('offline'))
    const { result } = renderHook(() => useTranslationQA('p', 'Hi', { en: 'Hello' }))
    await advance()
    expect(result.current.status).toBe('unavailable')
    await act(async () => result.current.flush())
    expect(result.current.status).toBe('checked')
    expect(result.current.qa.en).toEqual(clean)
  })

  it('preserves matching server findings when another locale check fails', async () => {
    mockQA.mockRejectedValueOnce(new Error('offline'))
    const seed = { source: 'Hi {name}', translations: { en: 'Hi', fr: '' }, qa: { en: bad } }
    const { result, rerender } = renderHook(({ fr }) =>
      useTranslationQA('p', seed.source, { en: 'Hi', fr }, seed),
    { initialProps: { fr: '' } })
    rerender({ fr: 'Bonjour {name}' })
    expect(result.current.qa.en).toEqual(bad)
    await advance()
    expect(result.current.status).toBe('unavailable')
    expect(result.current.qa.en).toEqual(bad)
    expect(result.current.qa.fr).toBeUndefined()
    await act(async () => result.current.flush())
    expect(result.current.status).toBe('checked')
    expect(result.current.qa.en).toEqual(clean)
  })

  it.each(['pending', 'unavailable'] as const)('uses regenerated server QA over a %s response for the same text', async (state) => {
    const request = pending()
    if (state === 'pending') mockQA.mockReturnValueOnce(request.promise)
    else mockQA.mockRejectedValueOnce(new Error('offline'))
    const initial: QASeed = { source: 'Hi {name}', translations: { en: 'Hi' } }
    const generated: QASeed = { ...initial, qa: { en: bad } }
    const { result, rerender } = renderHook(({ seed }) =>
      useTranslationQA('p', initial.source, initial.translations, seed),
    { initialProps: { seed: initial } })
    await advance()
    expect(result.current.status).toBe(state === 'pending' ? 'checking' : 'unavailable')
    rerender({ seed: generated })
    expect(result.current.status).toBe('checked')
    expect(result.current.qa.en).toEqual(bad)
    await act(async () => request.resolve({ qa: { en: clean } }))
    await advance()
    expect(result.current.qa.en).toEqual(bad)
    await act(async () => result.current.flush())
    expect(mockQA).toHaveBeenCalledTimes(1)
  })

  it('skips empty sources and translations, and cancels pending work on unmount', async () => {
    const { rerender, unmount } = renderHook(({ source, text }) => useTranslationQA('p', source, { en: text }), { initialProps: { source: '', text: 'Hello' } })
    await advance()
    rerender({ source: 'Hi', text: '  ' })
    await advance()
    expect(mockQA).not.toHaveBeenCalled()
    rerender({ source: 'Hi', text: 'Hello' })
    unmount()
    await advance()
    expect(mockQA).not.toHaveBeenCalled()
  })
})
