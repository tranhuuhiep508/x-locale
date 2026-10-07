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

test('dropping JSON previews it and applies the retained file after confirmation', async ({ page }) => {
  await goToImportExport(page)
  await selectImportModule(page, 'Common')
  const key = `e2e_dropped_${Date.now()}`
  const transfer = await page.evaluateHandle((key) => {
    const data = new DataTransfer()
    data.items.add(new File([JSON.stringify({ [key]: 'Dropped source' })], 'vi.json', { type: 'application/json' }))
    return data
  }, key)
  const dropZone = page.getByRole('button', { name: /Click to browse or drop/ })
  await dropZone.dispatchEvent('dragover', { dataTransfer: transfer })
  await dropZone.dispatchEvent('drop', { dataTransfer: transfer })
  await transfer.dispose()

  const preview = page.getByRole('dialog', { name: 'Import preview (dry run)' })
  await expect(preview.getByText(key, { exact: false })).toBeVisible()
  await preview.getByRole('button', { name: 'Apply import' }).click()
  await expect(page.getByText(/Import complete:/)).toBeVisible()
  await page.getByRole('link', { name: 'Strings', exact: true }).click()
  await searchStrings(page, key)
  await expect(page.getByText(key, { exact: true })).toBeVisible()
})

test('the upload zone opens the file picker from the keyboard', async ({ page }) => {
  await goToImportExport(page)
  const zone = page.getByRole('button', { name: /Click to browse or drop/ })
  await zone.focus()
  const chooserPromise = page.waitForEvent('filechooser')
  await page.keyboard.press('Enter')
  const chooser = await chooserPromise
  await chooser.setFiles({ name: 'vi.json', mimeType: 'application/json', buffer: Buffer.from('{"e2e_keyboard_import":"Keyboard source"}') })
  await expect(page.getByRole('dialog', { name: 'Import preview (dry run)' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('invalid and oversized drops are rejected before upload', async ({ page }) => {
  await goToImportExport(page)
  const uploads: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/import')) uploads.push(request.url())
  })
  for (const invalid of [
    { name: 'notes.txt', size: 1, error: 'Choose a JSON (.json) or Excel (.xlsx) file' },
    { name: 'large.json', size: 10 * 1024 * 1024 + 1, error: 'File must be 10 MB or smaller' },
  ]) {
    const transfer = await page.evaluateHandle(({ name, size }) => {
      const data = new DataTransfer()
      data.items.add(new File([new Uint8Array(size)], name))
      return data
    }, invalid)
    await page.getByRole('button', { name: /Click to browse or drop/ }).dispatchEvent('drop', { dataTransfer: transfer })
    await transfer.dispose()
    await expect(page.getByText(invalid.error, { exact: true })).toBeVisible()
  }
  expect(uploads).toEqual([])
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

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
  await page.getByRole('option', { name: 'Dry run (preview changes)' }).click()

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
  await page.getByRole('option', { name: 'Published snapshot only' }).click()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download JSON' }).click()
  const download = await downloadPromise
  const exportPath = path.join(tmpDir, await download.suggestedFilename())
  await download.saveAs(exportPath)

  const exported = fs.readFileSync(exportPath, 'utf8')
  expect(exported.trim().length).toBeGreaterThan(2)
})
