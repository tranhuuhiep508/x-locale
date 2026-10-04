import { expect, type Page } from '@playwright/test'

/** TimeRangePicker popover is portaled to document body, not inside `<main>`. */
export function timeRangePopover(page: Page) {
  return page.locator('[data-slot="popover-content"]').filter({ has: page.locator('#time-range-since') })
}

export async function openTimeRangePicker(page: Page) {
  await page.locator('main [data-slot="popover-trigger"]').first().click()
  await expect(timeRangePopover(page)).toBeVisible()
}

export async function pickTimeRangePreset(page: Page, label: string) {
  await openTimeRangePicker(page)
  await timeRangePopover(page).getByRole('button', { name: label, exact: true }).click()
}
