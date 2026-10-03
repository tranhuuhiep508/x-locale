import { test, expect, type Page } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'
import { openDemoStrings } from '../helpers/strings'

// Calendar day buttons format data-day with the browser default locale.
// Pin both so the selector and the URL dates do not follow the host environment.
test.use({ locale: 'en-US', timezoneId: 'UTC' })

test.beforeAll(() => {
  resetDemoDatabase()
})

function pad(value: number) {
  return String(value).padStart(2, '0')
}

/** Previous calendar month in UTC, matching the timezone pinned on this file. */
function previousUtcMonth(now = new Date()) {
  const monthIndex = now.getUTCMonth() - 1
  if (monthIndex >= 0) {
    return { year: now.getUTCFullYear(), monthIndex }
  }
  return { year: now.getUTCFullYear() - 1, monthIndex: 11 }
}

function dateParam(year: number, monthIndex: number, day: number, endOfDay = false) {
  const stamp = `${year}-${pad(monthIndex + 1)}-${pad(day)}`
  return endOfDay ? `${stamp}T23:59:59` : `${stamp}T00:00:00`
}

async function browserDayLabel(page: Page, year: number, monthIndex: number, day: number) {
  return page.evaluate(
    ({ year, monthIndex, day }) => new Date(year, monthIndex, day).toLocaleDateString(),
    { year, monthIndex, day },
  )
}

async function expectDateParams(page: Page, since: string | null, until: string | null) {
  await expect.poll(() => new URL(page.url()).searchParams.get('since')).toBe(since)
  await expect.poll(() => new URL(page.url()).searchParams.get('until')).toBe(until)
}

test('activity date range works after navigation and a direct reload', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  const { year, monthIndex } = previousUtcMonth()
  const since = dateParam(year, monthIndex, 10)
  const until = dateParam(year, monthIndex, 12, true)

  await openDemoStrings(page)
  await page.getByRole('link', { name: 'Activity' }).click()
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
  await page.getByRole('button', { name: 'Date range', exact: true }).click()

  const calendar = page.locator('[data-slot="calendar"]')
  await expect(calendar.getByRole('grid')).toHaveCount(2)
  await calendar.getByRole('button', { name: 'Go to the Previous Month' }).click()

  const fromLabel = await browserDayLabel(page, year, monthIndex, 10)
  const toLabel = await browserDayLabel(page, year, monthIndex, 12)
  await calendar.locator(`button[data-day="${fromLabel}"]`).click()
  await calendar.locator(`button[data-day="${toLabel}"]`).click()

  await expectDateParams(page, since, until)
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
  await expectDateParams(page, since, until)
  await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expectDateParams(page, null, null)
  await expect(page.getByRole('button', { name: 'Date range', exact: true })).toBeEnabled()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
  await expectDateParams(page, null, null)
  await expect(page.getByRole('button', { name: 'Clear', exact: true })).toHaveCount(0)

  // Smoke check only. A clean pageerror list does not reproduce the original dynamic-import failure.
  expect(pageErrors).toEqual([])
})
