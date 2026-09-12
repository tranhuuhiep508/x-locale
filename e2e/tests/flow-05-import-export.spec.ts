import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'
import { openDemoStrings, searchStrings } from '../helpers/strings'

test.describe.configure({ mode: 'serial' })

const newKey = `e2e_import_new_${Date.now()}`

test.beforeAll(() => {
  resetDemoDatabase()
})

function buildImportJson() {
  return JSON.stringify(
    {
      save: 'Lưu (e2e updated)',
      [newKey]: 'E2E imported string',
    },
    null,
    2,
  )
}

async function goToImportExport(page: import('@playwright/test').Page) {
  await openDemoStrings(page)
  await page.getByRole('link', { name: 'Import / Export' }).click()
  await expect(page.getByRole('heading', { name: 'Import / Export' })).toBeVisible()
}

async function selectImportModule(page: import('@playwright/test').Page, moduleName: string) {
  await page.getByRole('combobox', { name: 'Module (JSON only)' }).click()
  await page.getByRole('option', { name: new RegExp(moduleName) }).click()
}

test('import dry-run preview, cancel leaves catalog unchanged, apply then export public', async ({
  page,
}) => {
  await goToImportExport(page)
  await selectImportModule(page, 'Common')

  const importJson = buildImportJson()
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'x-locale-e2e-'))
  const importPath = path.join(tmpDir, 'vi.json')
  fs.writeFileSync(importPath, importJson)

  await page.getByRole('combobox', { name: 'Mode' }).click()
  await page.getByRole('option', { name: 'Dry run (preview)' }).click()

  const fileInput = page.locator('input[type="file"]')
  await fileInput.setInputFiles(importPath)

  await expect(page.getByRole('heading', { name: 'Import preview (dry run)' })).toBeVisible()
  const preview = page.getByRole('dialog').filter({ hasText: 'Import preview (dry run)' })
  await expect(preview.getByText('New strings', { exact: true })).toBeVisible()
  await expect(preview.getByText('Updated', { exact: true })).toBeVisible()
  await expect(preview.getByText('Orphaned', { exact: true })).toBeVisible()
  await expect(preview.getByText(newKey)).toBeVisible()

  await preview.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('heading', { name: 'Import preview (dry run)' })).toBeHidden()

  await page.getByRole('link', { name: 'Strings' }).click()
  await searchStrings(page, newKey)
  await expect(page.getByRole('row').filter({ hasText: newKey })).toHaveCount(0)

  await page.getByRole('link', { name: 'Import / Export' }).click()
  await selectImportModule(page, 'Common')
  await fileInput.setInputFiles(importPath)
  await expect(page.getByRole('heading', { name: 'Import preview (dry run)' })).toBeVisible()
  const applyPreview = page.getByRole('dialog').filter({ hasText: 'Import preview (dry run)' })
  await applyPreview.getByRole('button', { name: 'Apply import' }).click()
  await expect(page.getByRole('heading', { name: 'Import preview (dry run)' })).toBeHidden()

  await page.getByRole('link', { name: 'Strings' }).click()
  await searchStrings(page, newKey)
  await expect(page.getByRole('row').filter({ hasText: newKey })).toBeVisible()
  await searchStrings(page, 'cancel')
  await expect(page.getByRole('row').filter({ hasText: 'cancel' })).toBeVisible()

  await searchStrings(page, 'save')
  const saveRow = page.getByRole('row').filter({ hasText: 'save' }).first()
  await saveRow.getByRole('switch', { name: 'Draft' }).click()
  const publishDialog = page.getByRole('dialog').filter({ hasText: 'Publish preview' })
  await publishDialog.getByRole('button', { name: 'Publish' }).click()

  await page.getByRole('link', { name: 'Import / Export' }).click()
  await page.getByRole('combobox', { name: 'Stage' }).click()
  await page.getByRole('option', { name: 'Public only' }).click()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download JSON' }).click()
  const download = await downloadPromise
  const exportPath = path.join(tmpDir, await download.suggestedFilename())
  await download.saveAs(exportPath)

  const exported = fs.readFileSync(exportPath, 'utf8')
  expect(exported.trim().length).toBeGreaterThan(2)
})
