import { expect, test, type Page } from '../fixtures'

test.describe.configure({ mode: 'serial' })

async function projectRole(page: Page, role: 'editor' | null) {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await page.route('**/api/projects/demo-app', async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() !== 'GET' || url.pathname !== '/api/projects/demo-app') {
      await route.continue()
      return
    }
    const response = await route.fetch()
    const body = await response.json()
    body.role = role
    await route.fulfill({ response, json: body })
  })
}

test('page tours start once, replay from Help, and skip steps the role cannot see', {
  tag: '@show-tour',
}, async ({ page }) => {
  const tour = page.locator('.driver-popover')

  await page.goto('/')
  await expect(tour).toContainText('Every project you belong to is listed here.')
  await expect(tour).toContainText('1 of 3')
  await tour.getByRole('button', { name: 'Skip tour' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-tour-status', 'idle')
  await expect(tour).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-tour-status', 'idle')
  await expect(tour).toHaveCount(0)

  await page.getByRole('button', { name: 'Help' }).click()
  await page.getByRole('menuitem', { name: 'Tour this page' }).click()
  await expect(tour).toContainText('1 of 3')
  await tour.getByRole('button', { name: 'Next' }).click()
  await expect(tour).toContainText('Sync strings from your code with the CLI.')
  await expect(tour).toContainText('2 of 3')
  await tour.getByRole('button', { name: 'Next' }).click()
  await expect(tour).toContainText('3 of 3')
  await tour.getByRole('button', { name: 'Done' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-tour-status', 'idle')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-tour-status', 'idle')
  await expect(tour).toHaveCount(0)

  await page.goto('/projects/demo-app/strings')
  await expect(tour).toContainText('Each row is a string key.')
  await expect(tour).toContainText('1 of 7')
  await tour.getByRole('button', { name: 'Skip tour' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-tour-status', 'idle')

  await page.goto('/projects/demo-app/import-export')
  await expect(tour).toContainText('Import a JSON or Excel file into a module.')
  await expect(tour).toContainText('1 of 5')

  await projectRole(page, null)
  await page.reload()
  await expect(page.getByRole('button', { name: /Click to browse or drop/ })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('data-tour-status', 'idle')
  await expect(tour).toHaveCount(0)

  await projectRole(page, 'editor')
  await page.reload()
  await expect(tour).toContainText('Import a JSON or Excel file into a module.')
  await expect(tour).toContainText('1 of 5')
})
