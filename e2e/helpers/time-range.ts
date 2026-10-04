import { expect, type Locator, type Page } from '@playwright/test'

/** TimeRangePicker popover is portaled to document body, not inside `<main>`. */
export function timeRangePopover(page: Page) {
  return page.locator('[data-slot="popover-content"]').filter({ has: page.locator('#time-range-since') })
}

function timeRangeTrigger(root: Locator) {
  // Trigger label varies (presets, custom range, legacy updated_within_days); icon is stable.
  return root.locator('button:has([data-icon="inline-start"])').first()
}

export async function openTimeRangePicker(page: Page, scope: Locator = page.locator('main')) {
  await timeRangeTrigger(scope).click()
  await expect(timeRangePopover(page)).toBeVisible()
}

export async function pickTimeRangePreset(page: Page, label: string, scope: Locator = page.locator('main')) {
  await openTimeRangePicker(page, scope)
  await timeRangePopover(page).getByRole('button', { name: label, exact: true }).click()
}

export function activityFilterBar(page: Page) {
  return page.locator('div.shrink-0.border-b').filter({ has: page.getByRole('heading', { name: 'Activity' }) })
}
