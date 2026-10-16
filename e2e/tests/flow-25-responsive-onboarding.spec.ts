import { test, expect } from '../fixtures'
import { resetDemoDatabase } from '../helpers/database'

test.beforeAll(() => {
  resetDemoDatabase()
})

test('login content and authentication stay within mobile viewports', async ({ page }) => {
  for (const width of [320, 375, 768]) {
    await page.setViewportSize({ width, height: 667 })
    await page.goto('/login')
    const signIn = page.getByRole('link', { name: 'Continue with Microsoft' })
    await expect(signIn).toBeVisible()
    for (const element of [signIn, page.getByRole('heading', { level: 1 })]) {
      const bounds = await element.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    }
    expect(await page.locator('main').evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(width)
  }

  const japanese = page.getByRole('button', { name: /日本語/ })
  await japanese.click()
  await expect(japanese).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: /Tiếng Việt/ })).toHaveAttribute('aria-pressed', 'false')
})

test('a maximum-length project slug keeps the form and submit button in view', async ({ page }) => {
  for (const width of [320, 375, 768, 1024]) {
    await page.setViewportSize({ width, height: 667 })
    await page.goto('/projects/new')
    await page.getByLabel('Project name', { exact: true }).fill('a'.repeat(128))
    const create = page.getByRole('button', { name: 'Create project', exact: true })
    await create.scrollIntoViewIfNeeded()
    const bounds = await create.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    expect(await page.locator('main').evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(width)
  }
})

test('CLI hints connect to the current server and API Docs is absent from the header', async ({ page }) => {
  for (const path of ['/projects/new', '/projects/demo-app/settings']) {
    await page.goto(path)
    const origin = new URL(page.url()).origin
    await expect(page.getByText(`loc init -u ${origin} -k <API_KEY>`, { exact: true })).toBeVisible()
    await expect(page.locator('header').getByRole('link', { name: 'API Docs' })).toHaveCount(0)
  }
})

test('project header keeps Help and the user menu usable at 320px', async ({ page }) => {
  await page.goto('/projects/demo-app/settings')
  const header = page.locator('header')
  const help = header.getByRole('button', { name: 'Help', exact: true })
  const userMenu = header.getByRole('button').filter({ has: page.locator('[data-slot="avatar"]') })

  for (const width of [320, 375, 1280]) {
    await page.setViewportSize({ width, height: 720 })
    for (const control of [help, userMenu]) {
      await expect(control).toBeVisible()
      const bounds = await control.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
    }
    expect(await header.evaluate((el) => el.scrollWidth)).toBeLessThanOrEqual(width)
    if (width >= 640) {
      await expect(header.getByText('x-locale', { exact: true })).toBeVisible()
      await expect(header.getByText('Demo App', { exact: true })).toBeVisible()
    }

    await help.click()
    await expect(page.getByRole('menuitem', { name: 'Tour this page' })).toBeVisible()
    await page.keyboard.press('Escape')
    await userMenu.click()
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible()
    await page.keyboard.press('Escape')
  }
})
