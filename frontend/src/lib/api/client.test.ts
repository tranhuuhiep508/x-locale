import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './client'

afterEach(() => vi.unstubAllGlobals())

describe('API conflict messages', () => {
  it('shows the structured key conflict message and retains the code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            detail: {
              code: 'key_conflict',
              message: "Key 'a' is already used by another string.",
              key: 'a',
            },
          }),
          { status: 409 }
        )
      )
    )
    const error = await api.post('/restore').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 409,
      message: "Key 'a' is already used by another string.",
      body: { detail: { code: 'key_conflict' } },
    })
  })
})
