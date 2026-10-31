import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { stringsApi } from '@/lib/api/strings'
import type { TranslationMemoryResult } from '@/lib/api/types'
import { useTranslationMemory } from './use-translation-memory'

vi.mock('@/lib/api/strings', () => ({ stringsApi: { translateMemory: vi.fn() } }))
beforeEach(() => vi.resetAllMocks())

it('ignores a late response after source changes and only searches again explicitly', async () => {
  let finish!: (result: TranslationMemoryResult) => void
  vi.mocked(stringsApi.translateMemory).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const { result, rerender } = renderHook(
    ({ source }) => useTranslationMemory('p', source, ['en']),
    { initialProps: { source: 'Old' } },
  )
  expect(result.current.loading).toBe(true)
  rerender({ source: 'New' })
  await act(async () => {
    finish({ source_text: 'Old', matches: { en: [] } })
  })
  expect(result.current.checked).toBe(false)
  expect(result.current.matches).toEqual({})
  expect(stringsApi.translateMemory).toHaveBeenCalledTimes(1)
  vi.mocked(stringsApi.translateMemory).mockResolvedValueOnce({
    source_text: 'New',
    matches: { en: [] },
  })
  await act(async () => {
    await result.current.load()
  })
  await waitFor(() => expect(result.current.checked).toBe(true))
  expect(stringsApi.translateMemory).toHaveBeenCalledTimes(2)
})

it('discards an older retry response even when the source is unchanged', async () => {
  let finish!: (result: TranslationMemoryResult) => void
  vi.mocked(stringsApi.translateMemory).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const { result } = renderHook(() => useTranslationMemory('p', 'Source', ['en']))
  vi.mocked(stringsApi.translateMemory).mockRejectedValueOnce(new Error('Latest lookup failed'))
  await act(async () => {
    await result.current.load()
  })
  await act(async () => {
    finish({ source_text: 'Source', matches: { en: [] } })
  })
  expect(result.current.error).toBe('Latest lookup failed')
  expect(result.current.checked).toBe(true)
})
