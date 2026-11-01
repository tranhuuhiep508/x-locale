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

it('debounces source edits, blocks AI while waiting, and ignores late responses', async () => {
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
  expect(stringsApi.translateMemory).toHaveBeenCalledTimes(1)
  vi.mocked(stringsApi.translateMemory).mockResolvedValueOnce({
    source_text: 'New',
    matches: { en: [] },
  })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(349)
  })
  expect(stringsApi.translateMemory).toHaveBeenCalledTimes(1)
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })
  expect(stringsApi.translateMemory).toHaveBeenCalledTimes(2)
  expect(result.current.loading).toBe(false)
})

it('invalidates lookups for locale changes and does not fetch empty sources', async () => {
  vi.mocked(stringsApi.translateMemory).mockResolvedValue({ source_text: 'Source', matches: {} })
  const { result, rerender } = renderHook(
    ({ source, locales }) => useTranslationMemory('p', source, locales),
    { initialProps: { source: 'Source', locales: ['en'] } }
  )
  await act(async () => {})
  rerender({ source: 'Source', locales: ['ja'] })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350)
  })
  expect(stringsApi.translateMemory).toHaveBeenLastCalledWith(
    'p',
    expect.objectContaining({ locales: ['ja'] })
  )
  rerender({ source: '', locales: ['ja'] })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(350)
  })
  expect(stringsApi.translateMemory).toHaveBeenCalledTimes(2)
  expect(result.current.loading).toBe(false)
})

it('keeps previous results throughout the debounce and a pending refresh', async () => {
  const previous = { en: [{ string_id: 'a', key: 'old', module_id: null, module_slug: null, matched_source_text: 'Old', translation: 'Hello', exact: true, similarity: 1, issues: [] }] }
  vi.mocked(stringsApi.translateMemory).mockResolvedValueOnce({ source_text: 'Old', matches: previous })
  const { result, rerender } = renderHook(({ source }) => useTranslationMemory('p', source, ['en']), { initialProps: { source: 'Old' } })
  await act(async () => {})
  let finish!: (value: TranslationMemoryResult) => void
  vi.mocked(stringsApi.translateMemory).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  rerender({ source: 'New' })
  expect(result.current.matches).toEqual(previous)
  expect(result.current.loading).toBe(false)
  await act(async () => { await vi.advanceTimersByTimeAsync(350) })
  expect(result.current.matches).toEqual(previous)
  expect(result.current.loading).toBe(false)
  await act(async () => { finish({ source_text: 'New', matches: {} }) })
  expect(result.current.matches).toEqual({})
})
