import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'
import { openDemoStrings, searchStrings } from '../helpers/strings'

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  resetDemoDatabase()
})

async function goToImportExport(page: import('@playwright/test').Page) {
  await openDemoStrings(page)
  await page.getByRole('link', { name: 'Import / Export' }).click()
  await expect(page.getByRole('heading', { name: 'Import / Export' })).toBeVisible()
}

test('excel export and import round-trip', async ({ page }) => {
  await goToImportExport(page)

  // 1. Export Excel (.xlsx)
  await page.getByRole('combobox', { name: 'Format' }).click()
  await page.getByRole('option', { name: 'Excel (.xlsx)' }).click()

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'x-locale-excel-e2e-'))
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download XLSX' }).click()
  const download = await downloadPromise
  const exportPath = path.join(tmpDir, await download.suggestedFilename())
  await download.saveAs(exportPath)

  expect(exportPath.endsWith('.xlsx')).toBeTruthy()
  expect(fs.statSync(exportPath).size).toBeGreaterThan(100)

  // 2. Upload the exported file in Dry Run mode
  await page.getByRole('combobox', { name: 'Mode' }).click()
  await page.getByRole('option', { name: 'Dry run (preview)' }).click()

  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(exportPath)

  // 3. Verify Dry Run Preview dialog
  await expect(page.getByRole('heading', { name: 'Import preview (dry run)' })).toBeVisible()
  const preview = page.getByRole('dialog').filter({ hasText: 'Import preview (dry run)' })
  await expect(preview.getByRole('button', { name: 'Apply import' })).toBeVisible()

  // 4. Apply import
  await preview.getByRole('button', { name: 'Apply import' }).click()
  await expect(page.getByRole('heading', { name: 'Import preview (dry run)' })).toBeHidden()

  // 5. Navigate to Strings and verify catalog is intact
  await page.getByRole('link', { name: 'Strings' }).click()
  await searchStrings(page, 'sign_in')
  await expect(page.getByRole('row').filter({ hasText: 'sign_in' }).first()).toBeVisible()
})
