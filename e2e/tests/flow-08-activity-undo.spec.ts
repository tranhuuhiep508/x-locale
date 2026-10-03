import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'
import { openDemoStrings, searchStrings } from '../helpers/strings'

test.describe.configure({ mode: 'serial' })

const importKey = `e2e_undo_import_${Date.now()}`

test.beforeAll(() => {
  resetDemoDatabase()
})

async function goToImportExport(page: import('@playwright/test').Page) {
  await openDemoStrings(page)
  await page.getByRole('link', { name: 'Import / Export' }).click()
  await expect(page.getByRole('heading', { name: 'Import / Export' })).toBeVisible()
}

test('activity date range works after navigation and a direct reload', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await openDemoStrings(page)
  await page.getByRole('link', { name: 'Activity' }).click()
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
  await page.getByRole('button', { name: 'Date range', exact: true }).click()

  const calendar = page.locator('[data-slot="calendar"]')
  await expect(calendar.getByRole('grid')).toHaveCount(2)
  await calendar.getByRole('button', { name: 'Go to the Previous Month' }).click()

  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 10)
  const to = new Date(now.getFullYear(), now.getMonth() - 1, 12)
  await calendar.locator(`button[data-day="${from.toLocaleDateString('en-US')}"]`).click()
  await calendar.locator(`button[data-day="${to.toLocaleDateString('en-US')}"]`).click()

  await expect.poll(() => new URL(page.url()).searchParams.get('since')).toContain('T00:00:00')
  await expect.poll(() => new URL(page.url()).searchParams.get('until')).toContain('T23:59:59')
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Date range', exact: true })).toBeEnabled()
  expect(pageErrors).toEqual([])
})

test('activity undo reverts a batch import', async ({ page }) => {
  await goToImportExport(page)

  await page.getByRole('combobox', { name: 'Module (JSON only)' }).click()
  await page.getByRole('option', { name: /Common/ }).click()

  const importJson = JSON.stringify({ [importKey]: 'Undo me' }, null, 2)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'x-locale-e2e-'))
  const importPath = path.join(tmpDir, 'vi.json')
  fs.writeFileSync(importPath, importJson)

  await page.locator('input[type="file"]').setInputFiles(importPath)
  const preview = page.getByRole('dialog').filter({ hasText: 'Import preview (dry run)' })
  await expect(preview).toBeVisible()
  await preview.getByRole('button', { name: 'Apply import' }).click()
  await expect(preview).toBeHidden()

  await page.getByRole('link', { name: 'Strings' }).click()
  await searchStrings(page, importKey)
  await expect(page.getByRole('row').filter({ hasText: importKey })).toBeVisible()

  await page.getByRole('link', { name: 'Activity' }).click()
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()

  await expect(page.getByText(/Imported · \d+ string/)).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).first().click()

  const confirm = page.getByRole('alertdialog', { name: 'Undo this batch?' })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText(/Restored \d+ strings/)).toBeVisible()

  await page.getByRole('link', { name: 'Strings' }).click()
  await searchStrings(page, importKey)
  await expect(page.getByRole('row').filter({ hasText: importKey })).toHaveCount(0)
})
