import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { stringsApi } from '@/lib/api/strings'
import type { TranslationMemoryResult } from '@/lib/api/types'
import { useTranslationMemory } from './use-translation-memory'

vi.mock('@/lib/api/strings', () => ({ stringsApi: { translateMemory: vi.fn() } }))
beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

it('debounces source edits, keeps the first lookup pending, and ignores late responses', async () => {
  let finish!: (result: TranslationMemoryResult) => void
  vi.mocked(stringsApi.translateMemory).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const { result, rerender } = renderHook(
    ({ source }) => useTranslationMemory('p', source, ['en']),
    { initialProps: { source: 'Old' } }
  )
  expect(result.current.loading).toBe(true)
  rerender({ source: 'N' })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200)
  })
  rerender({ source: 'New' })
  await act(async () => {
    finish({ source_text: 'Old', matches: { en: [] } })
  })
  expect(result.current.matches).toEqual({})
  expect(result.current.loading).toBe(true)
  expect(result.current.stale).toBe(false)
  expect(stringsApi.translateMemory).toHaveBeenCalledTimes(1)
  vi.mocked(stringsApi.translateMemory).mockResolvedValueOnce({
    source_text: 'New',
    matches: { en: [] },
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(799)
  })
  expect(stringsApi.translateMemory).toHaveBeenCalledTimes(1)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(stringsApi.translateMemory).toHaveBeenCalledTimes(2)
  expect(result.current.loading).toBe(false)
  expect(result.current.matches).toEqual({ en: [] })
})

it('keeps the current matches visible but stale until the edited source resolves', async () => {
  const published = { string_id: 'origin', key: 'greeting', module_id: null, module_slug: null, matched_source_text: 'Hello', translation: 'Bonjour', exact: true, similarity: 1, issues: [] }
  const next = { ...published, string_id: 'next', matched_source_text: 'Hello!' }
  vi.mocked(stringsApi.translateMemory).mockResolvedValueOnce({
    source_text: 'Hello',
    matches: { en: [published] },
  })
  let finish!: (result: TranslationMemoryResult) => void
  vi.mocked(stringsApi.translateMemory).mockImplementationOnce(
    () => new Promise((resolve) => { finish = resolve }),
  )
  const { result, rerender } = renderHook(
    ({ source }) => useTranslationMemory('p', source, ['en']),
    { initialProps: { source: 'Hello' } },
  )
  await act(async () => {})
  expect(result.current.loading).toBe(false)
  expect(result.current.stale).toBe(false)
  expect(result.current.matches.en?.[0]?.string_id).toBe('origin')
  rerender({ source: 'Hello!' })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200)
  })
  expect(stringsApi.translateMemory).toHaveBeenCalledTimes(1)
  expect(result.current.loading).toBe(false)
  expect(result.current.stale).toBe(true)
  expect(result.current.matches.en?.[0]?.string_id).toBe('origin')
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600)
  })
  expect(stringsApi.translateMemory).toHaveBeenCalledTimes(2)
  expect(result.current.stale).toBe(true)
  expect(result.current.loading).toBe(false)
  await act(async () => {
    finish({ source_text: 'Hello!', matches: { en: [next] } })
  })
  expect(result.current.stale).toBe(false)
  expect(result.current.loading).toBe(false)
  expect(result.current.matches.en?.[0]?.string_id).toBe('next')
  expect(result.current.error).toBeUndefined()
})

it('invalidates lookups for locale changes and does not fetch empty sources', async () => {
  vi.mocked(stringsApi.translateMemory).mockResolvedValue({ source_text: 'Source', matches: {} })
  const { result, rerender } = renderHook(
    ({ source, locales }) => useTranslationMemory('p', source, locales),
    { initialProps: { source: 'Source', locales: ['en'] } }
  )
  await act(async () => {})
  expect(result.current.stale).toBe(false)
  rerender({ source: 'Source', locales: ['ja'] })
  expect(result.current.stale).toBe(true)
  expect(result.current.loading).toBe(false)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800)
  })
  expect(result.current.stale).toBe(false)
  expect(stringsApi.translateMemory).toHaveBeenLastCalledWith(
    'p',
    expect.objectContaining({ locales: ['ja'] })
  )
  rerender({ source: '', locales: ['ja'] })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800)
  })
  expect(stringsApi.translateMemory).toHaveBeenCalledTimes(2)
  expect(result.current.loading).toBe(false)
})
