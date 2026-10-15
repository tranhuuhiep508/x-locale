import { test as base, expect } from '@playwright/test'

declare global {
  interface Window {
    __XL_E2E_TOURS_OFF__?: boolean
  }
}

export { expect }
export type { Locator, Page } from '@playwright/test'

/**
 * Existing flows turn auto-start off before page scripts run.
 * Tag a test with `@show-tour` to leave tours on. Help replay ignores the flag.
 */
export const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    if (!testInfo.tags.includes('@show-tour')) {
      await context.addInitScript(() => {
        window.__XL_E2E_TOURS_OFF__ = true
      })
    }
    await use(context)
  },
})
