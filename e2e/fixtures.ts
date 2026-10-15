import { test as base, expect } from '@playwright/test'
import { TOUR_IDS } from '../frontend/src/lib/tours/ids'

export { expect }
export type { Locator, Page } from '@playwright/test'

/**
 * Existing flows seed every tour as seen before the page scripts run.
 * Tag a test with `@show-tour` to leave seen-state empty.
 */
export const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    if (!testInfo.tags.includes('@show-tour')) {
      await context.addInitScript((tourIds: string[]) => {
        return (async () => {
          try {
            const response = await fetch('/api/auth/me', { credentials: 'same-origin' })
            if (!response.ok) return
            const user: unknown = await response.json()
            if (!user || typeof user !== 'object' || !('id' in user) || typeof user.id !== 'string' || !user.id) {
              return
            }
            const key = `xl:tours-seen:${user.id}`
            let seen: Record<string, unknown> = {}
            try {
              const parsed: unknown = JSON.parse(localStorage.getItem(key) || '{}')
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                seen = parsed as Record<string, unknown>
              }
            } catch {
              seen = {}
            }
            const now = new Date().toISOString()
            for (const tourId of tourIds) {
              if (seen[tourId] == null) seen[tourId] = now
            }
            localStorage.setItem(key, JSON.stringify(seen))
          } catch {
            // A document without the app origin cannot seed tours.
          }
        })()
      }, [...TOUR_IDS])
    }
    await use(context)
  },
})
