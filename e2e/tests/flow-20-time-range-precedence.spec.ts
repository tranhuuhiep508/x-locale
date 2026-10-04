import { test, expect } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'
import { openDemoStrings } from '../helpers/strings'
import { activityFilterBar, timeRangePopover } from '../helpers/time-range'

test.beforeAll(() => resetDemoDatabase())

for (const surface of ['strings', 'activity'] as const) {
  for (const period of ['7d', 'bogus']) {
    test(`${surface} uses ${period} consistently with conflicting date params`, async ({ page }) => {
      await openDemoStrings(page)
      if (surface === 'activity') {
        await page.getByRole('link', { name: 'Activity' }).click()
        await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
      }

      const url = new URL(page.url())
      url.searchParams.set('period', period)
      url.searchParams.set('since', '2026-01-10')
      url.searchParams.set('until', '2026-01-12')
      if (surface === 'strings') url.searchParams.set('updated_within_days', '7')
      const otherFilter = surface === 'strings' ? 'q' : 'event_type'
      const otherValue = surface === 'strings' ? 'welcome' : 'import'
      url.searchParams.set(otherFilter, otherValue)

      const endpoint = surface === 'strings' ? '/strings' : '/activities/feed'
      const responsePromise = page.waitForResponse((response) => {
        const requestUrl = new URL(response.url())
        return requestUrl.pathname.startsWith('/api/projects/') &&
          requestUrl.pathname.endsWith(endpoint) &&
          requestUrl.searchParams.get(otherFilter) === otherValue
      })
      await page.goto(url.toString())
      const response = await responsePromise
      expect(response.ok()).toBeTruthy()
      const apiParams = new URL(response.url()).searchParams
      expect(apiParams.has('period')).toBe(false)
      expect(apiParams.has('until')).toBe(false)
      expect(apiParams.has('updated_within_days')).toBe(false)
      expect(apiParams.has('since')).toBe(period === '7d')

      await expect.poll(() => new URL(page.url()).searchParams.get('period'))
        .toBe(period === '7d' ? '7d' : null)
      for (const name of ['since', 'until', 'updated_within_days']) {
        await expect.poll(() => new URL(page.url()).searchParams.has(name)).toBe(false)
      }
      expect(new URL(page.url()).searchParams.get(otherFilter)).toBe(otherValue)

      const scope = surface === 'strings' ? page.locator('main') : activityFilterBar(page)
      const trigger = scope.getByRole('button', {
        name: period === '7d' ? 'Last 7 days' : 'All time', exact: true,
      })
      await expect(trigger).toBeVisible()
      await trigger.click()
      const popover = timeRangePopover(page)
      await expect(popover).toBeVisible()
      await popover.getByRole('button', { name: 'Apply range', exact: true }).click()
      await expect(popover.getByText('Choose a start and end date.')).toBeVisible()
    })
  }
}
