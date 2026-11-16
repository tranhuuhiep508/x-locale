import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCopiedToken } from './CatalogFilterBar'

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

afterEach(() => {
  cleanup()
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
  else Reflect.deleteProperty(navigator, 'clipboard')
})

describe('copy token feedback', () => {
  it('shows success after the clipboard write completes', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { result } = renderHook(() => useCopiedToken())

    await act(async () => { await result.current.copyToken('module', 'auth') })

    expect(writeText).toHaveBeenCalledWith('auth')
    expect(result.current.copiedId).toBe('module')
  })

  it('does not show success when clipboard access is denied', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const { result } = renderHook(() => useCopiedToken())

    await act(async () => { await result.current.copyToken('module', 'auth') })

    expect(result.current.copiedId).toBeNull()
  })

  it('does not show success when the clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
    const { result } = renderHook(() => useCopiedToken())

    await act(async () => { await result.current.copyToken('module', 'auth') })

    expect(result.current.copiedId).toBeNull()
  })
})
