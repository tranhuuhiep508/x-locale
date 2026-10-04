import { expect, test } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'
import { openDemoStrings } from '../helpers/strings'
import { timeRangePopover } from '../helpers/time-range'

test.beforeAll(() => resetDemoDatabase())

for (const timezoneId of ['UTC', 'America/Los_Angeles', 'Asia/Bangkok']) {
  test.describe(timezoneId, () => {
    test.use({ locale: 'en-US', timezoneId })

    for (const surface of ['strings', 'activity']) {
      for (const dates of [
        { since: '2026-01-10', until: '2026-01-12', month: 'January 2026' },
        { since: '2026-03-08', until: '2026-03-08', month: 'March 2026' },
      ]) {
        test(`${surface} preserves local days for ${dates.since} through ${dates.until}`, async ({ page }) => {
          await openDemoStrings(page)
          if (surface === 'activity') {
            await page.getByRole('link', { name: 'Activity' }).click()
            await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
          }
          const url = new URL(page.url())
          url.searchParams.set('since', dates.since)
          url.searchParams.set('until', dates.until)
          await page.goto(url.toString())

          const trigger = page.locator('button:has(svg.lucide-calendar)').first()
          await trigger.click()
          await expect(page.getByTestId('time-range-calendar')).toContainText(dates.month)

          const expected = await page.evaluate(({ since, until }) => {
            const localDate = (value: string) => {
              const [year, month, day] = value.split('-').map(Number)
              return new Date(year, month - 1, day)
            }
            const start = localDate(since)
            const end = localDate(until)
            end.setHours(23, 59, 59, 999)
            const fmt = (date: Date) => date.toLocaleString(undefined, {
              month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
            })
            return {
              since: start.toISOString(),
              until: end.toISOString().replace('.999Z', '.999999Z'),
              label: `${fmt(start)} – ${fmt(end)}`,
            }
          }, dates)

          const endpoint = surface === 'strings' ? '/strings' : '/activities/feed'
          const responsePromise = page.waitForResponse((response) => {
            const request = new URL(response.url())
            return request.pathname.startsWith('/api/projects/') &&
              request.pathname.endsWith(endpoint) &&
              request.searchParams.get('since') === expected.since &&
              request.searchParams.get('until') === expected.until
          })
          await timeRangePopover(page).getByRole('button', { name: 'Apply range', exact: true }).click()
          expect((await responsePromise).ok()).toBeTruthy()
          await expect.poll(() => new URL(page.url()).searchParams.get('since')).toBe(expected.since)
          await expect.poll(() => new URL(page.url()).searchParams.get('until')).toBe(expected.until)
          await expect(trigger).toHaveText(expected.label)

          await page.reload()
          await expect(trigger).toHaveText(expected.label)
          await trigger.click()
          await expect(page.getByTestId('time-range-calendar')).toContainText(dates.month)
          await timeRangePopover(page).getByRole('button', { name: 'Apply range', exact: true }).click()
          await expect.poll(() => new URL(page.url()).searchParams.get('since')).toBe(expected.since)
          await expect.poll(() => new URL(page.url()).searchParams.get('until')).toBe(expected.until)
        })
      }
    }
  })
}
