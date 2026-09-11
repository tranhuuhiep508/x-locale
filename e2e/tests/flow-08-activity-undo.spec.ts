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
