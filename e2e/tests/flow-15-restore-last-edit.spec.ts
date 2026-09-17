import { test, expect } from '@playwright/test'
import { fetchStringByKey, projectIdFromUrl } from '../helpers/api'
import { resetDemoDatabase } from '../helpers/database'
import {
  fillStringForm,
  openAddStringDialog,
  openDemoStrings,
  openStringEditor,
  saveStringForm,
  searchStrings,
} from '../helpers/strings'

test.describe.configure({ mode: 'serial' })

const key = `e2e_restore_last_${Date.now()}`

test.beforeAll(() => {
  resetDemoDatabase()
})

async function seedStringWithEditHistory(page: import('@playwright/test').Page) {
  await openDemoStrings(page)

  await openAddStringDialog(page)
  await fillStringForm(page, { key, source: 'Version A' })
  await saveStringForm(page, 'create')

  await openStringEditor(page, key)
  await page.getByLabel('Source text').fill('Version B')
  await saveStringForm(page, 'edit')
  await expect(page.getByRole('heading', { name: 'Edit string' })).toBeHidden()

  await openStringEditor(page, key)
  await page.getByLabel('Source text').fill('Version C')
  await saveStringForm(page, 'edit')
  await expect(page.getByRole('heading', { name: 'Edit string' })).toBeHidden()
}

test('batch restore last edit cancel leaves current working copy unchanged', async ({ page }) => {
  await seedStringWithEditHistory(page)
  await searchStrings(page, key)

  const row = page.getByRole('row').filter({ hasText: key }).first()
  await row.getByRole('checkbox', { name: 'Select row' }).click()

  await page
    .getByRole('toolbar', { name: 'Batch actions' })
    .getByRole('button', { name: 'Restore last edit' })
    .click()

  const dialog = page.getByRole('alertdialog', { name: 'Restore last edit?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()

  const projectId = projectIdFromUrl(page)
  const entry = await fetchStringByKey(page, projectId, key)
  expect(entry.source_text).toBe('Version C')
})

test('batch restore last edit confirm reverts to prior working copy', async ({ page }) => {
  await searchStrings(page, key)

  const row = page.getByRole('row').filter({ hasText: key }).first()
  await row.getByRole('checkbox', { name: 'Select row' }).click()

  await page
    .getByRole('toolbar', { name: 'Batch actions' })
    .getByRole('button', { name: 'Restore last edit' })
    .click()

  const dialog = page.getByRole('alertdialog', { name: 'Restore last edit?' })
  await dialog.getByRole('button', { name: 'Restore last edit' }).click()
  await expect(dialog).toBeHidden()

  const projectId = projectIdFromUrl(page)
  const entry = await fetchStringByKey(page, projectId, key)
  expect(entry.source_text).toBe('Version B')
  await expect(page.getByRole('row').filter({ hasText: 'Version B' })).toBeVisible()
})
