import { test, expect, type Page } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'
import { openDemoStrings } from '../helpers/strings'
import {
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

test('activity time presets and custom ranges persist in the URL', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await openActivity(page)
  await pickTimeRangePreset(page, 'Last 7 days')
  await expectParam(page, 'period', '7d')
  await expectParam(page, 'since', null)
  await expectParam(page, 'until', null)

  await openTimeRangePicker(page)
  const popover = timeRangePopover(page)
  await popover.locator('#time-range-since').fill('2026-01-10T08:30')
  await popover.locator('#time-range-until').fill('2026-01-12T18:45')
  await popover.getByRole('button', { name: 'Apply range', exact: true }).click()
  await expectParam(page, 'period', null)
  await expect.poll(() => new URL(page.url()).searchParams.get('since')).toContain('2026-01-10')
  await expect.poll(() => new URL(page.url()).searchParams.get('until')).toContain('2026-01-12')

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
  await expectParam(page, 'period', null)
  await expect.poll(() => new URL(page.url()).searchParams.get('since')).toContain('2026-01-10')

  await openTimeRangePicker(page)
  await timeRangePopover(page).getByRole('button', { name: 'Clear time', exact: true }).click()
  await expectParam(page, 'period', null)
  await expectParam(page, 'since', null)
  await expectParam(page, 'until', null)

  await page.getByRole('combobox').first().click()
  await page.getByRole('option', { name: 'Import' }).click()
  await pickTimeRangePreset(page, 'Last 24 hours')
  await expectParam(page, 'event_type', 'import')
  await expectParam(page, 'period', '24h')
  await openTimeRangePicker(page)
  await timeRangePopover(page).getByRole('button', { name: 'Clear time', exact: true }).click()
  await expectParam(page, 'event_type', 'import')
  await expectParam(page, 'period', null)

  await pickTimeRangePreset(page, 'Last 7 days')
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
