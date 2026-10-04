import { test, expect, type Page } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'
import { openDemoStrings } from '../helpers/strings'
import {
  activityFilterBar,
  openTimeRangePicker,
  pickTimeRangePreset,
  timeRangePopover,
} from '../helpers/time-range'

test.use({ locale: 'en-US', timezoneId: 'UTC' })

test.beforeAll(() => {
  resetDemoDatabase()
})

async function expectParam(page: Page, name: string, value: string | null) {
  await expect.poll(() => new URL(page.url()).searchParams.get(name)).toBe(value)
}

async function openActivity(page: Page) {
  await openDemoStrings(page)
  await page.getByRole('link', { name: 'Activity' }).click()
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

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

async function pickCalendarRange(
  page: Page,
  year: number,
  monthIndex: number,
  fromDay: number,
  toDay: number,
) {
  const popover = timeRangePopover(page)
  const calendar = popover.getByTestId('time-range-calendar')
  await calendar.getByRole('button', { name: 'Go to the Previous Month' }).click()
  const fromLabel = await browserDayLabel(page, year, monthIndex, fromDay)
  const toLabel = await browserDayLabel(page, year, monthIndex, toDay)
  await calendar.locator(`button[data-day="${fromLabel}"]`).click()
  await calendar.locator(`button[data-day="${toLabel}"]`).click()
}

test('activity time presets and custom ranges persist in the URL', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  const activityFilters = activityFilterBar(page)
  const { year, monthIndex } = previousUtcMonth()
  const since = dateParam(year, monthIndex, 10)
  const until = dateParam(year, monthIndex, 12, true)

  await openActivity(page)
  await pickTimeRangePreset(page, 'Last 7 days', activityFilters)
  await expectParam(page, 'period', '7d')
  await expectParam(page, 'since', null)
  await expectParam(page, 'until', null)

  await openTimeRangePicker(page, activityFilters)
  await pickCalendarRange(page, year, monthIndex, 10, 12)
  await timeRangePopover(page).getByRole('button', { name: 'Apply range', exact: true }).click()
  await expectParam(page, 'period', null)
  await expectParam(page, 'since', since)
  await expectParam(page, 'until', until)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
  await expectParam(page, 'period', null)
  await expectParam(page, 'since', since)
  await expectParam(page, 'until', until)

  await openTimeRangePicker(page, activityFilters)
  await timeRangePopover(page).getByRole('button', { name: 'Clear time', exact: true }).click()
  await expectParam(page, 'period', null)
  await expectParam(page, 'since', null)
  await expectParam(page, 'until', null)

  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Import' }).click()
  await pickTimeRangePreset(page, 'Last 24 hours', activityFilters)
  await expectParam(page, 'event_type', 'import')
  await expectParam(page, 'period', '24h')
  await openTimeRangePicker(page, activityFilters)
  await timeRangePopover(page).getByRole('button', { name: 'Clear time', exact: true }).click()
  await expectParam(page, 'event_type', 'import')
  await expectParam(page, 'period', null)

  await pickTimeRangePreset(page, 'Last 7 days', activityFilters)
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expectParam(page, 'period', null)
  await expectParam(page, 'event_type', null)
  await expectParam(page, 'page', '1')

  expect(pageErrors).toEqual([])
})

test('activity date-only bookmarks still load', async ({ page }) => {
  await openActivity(page)
  const url = new URL(page.url())
  url.searchParams.set('since', '2026-01-10')
  url.searchParams.set('until', '2026-01-12')
  await page.goto(url.toString())
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
  await expectParam(page, 'since', '2026-01-10')
  await expectParam(page, 'until', '2026-01-12')
})
