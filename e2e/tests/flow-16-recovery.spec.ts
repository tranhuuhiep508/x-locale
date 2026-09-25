import { test, expect } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'
import { importStringsViaApi, projectIdFromUrl } from '../helpers/api'
import { fillStringForm, openAddStringDialog, openDemoStrings, searchStrings } from '../helpers/strings'

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => resetDemoDatabase())

async function openProjectLink(page: import('@playwright/test').Page, name: string) {
  const link = page.getByRole('link', { name })
  if (!(await link.isVisible())) {
    await page.getByRole('button', { name: 'Toggle Sidebar' }).click()
  }
  await link.click()
}

test('failed string save keeps the form and succeeds on retry', async ({ page }) => {
  await openDemoStrings(page)
  const key = `recovery_save_${Date.now()}`
  await openAddStringDialog(page)
  await fillStringForm(page, { key, source: 'Keep this text' })
  let failures = 0
  await page.route('**/api/projects/*/strings', async (route) => {
    if (route.request().method() === 'POST' && failures++ === 0) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Temporary save failure' }) })
      return
    }
    await route.continue()
  })

  const dialog = page.getByRole('dialog').filter({ hasText: 'Add string' })
  await dialog.getByRole('button', { name: 'Create string' }).click()
  await expect(page.getByText('Temporary save failure')).toBeVisible()
  await expect(dialog.getByLabel('Key')).toHaveValue(key)
  await expect(dialog.getByLabel('Source text')).toHaveValue('Keep this text')
  await expect(dialog.getByRole('button', { name: 'Create string' })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Create string' }).click()
  await expect(dialog).toBeHidden()
  await searchStrings(page, key)
  await expect(page.getByRole('row').filter({ hasText: key })).toBeVisible()
})

test('failed import can be retried with the same file', async ({ page }) => {
  await openDemoStrings(page)
  await openProjectLink(page, 'Import / Export')
  await page.getByRole('combobox', { name: 'Module (JSON only)' }).click()
  await page.getByRole('option', { name: /Common/ }).click()
  const key = `recovery_import_${Date.now()}`
  let failures = 0
  await page.route('**/api/projects/*/import?**', async (route) => {
    if (failures++ === 0) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Temporary import failure' }) })
      return
    }
    await route.continue()
  })
  const file = { name: 'vi.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ [key]: 'Recovered import' })) }
  await page.locator('input[type="file"]').setInputFiles(file)
  await expect(page.getByText('Temporary import failure')).toBeVisible()
  await page.locator('input[type="file"]').setInputFiles(file)
  const preview = page.getByRole('dialog').filter({ hasText: 'Import preview (dry run)' })
  await expect(preview).toBeVisible()
  await preview.getByRole('button', { name: 'Apply import' }).click()
  await expect(page.getByText(/Import complete/)).toBeVisible()
  await openProjectLink(page, 'Strings')
  await searchStrings(page, key)
  await expect(page.getByRole('row').filter({ hasText: key })).toBeVisible()
})

test('interrupted translation polling exposes retry and recovers', async ({ page }) => {
  await openDemoStrings(page)
  const projectId = projectIdFromUrl(page)
  const prefix = `recovery_translate_${Date.now()}`
  const strings = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`${prefix}_${index}`, `Source ${index}`]))
  await importStringsViaApi(page, projectId, strings)
  await page.route('**/api/jobs/*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Polling interrupted' }) }))

  await page.getByRole('button', { name: 'Translate missing' }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: 'Missing Translations' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Translate', exact: true }).click()
  await expect(dialog.getByText(/Could not check translation progress/)).toBeVisible({ timeout: 20_000 })
  await page.unroute('**/api/jobs/*')
  await dialog.getByRole('button', { name: 'Translate', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Review Translations' })).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('button', { name: /Apply \d+ translations/ })).toBeEnabled()
})
