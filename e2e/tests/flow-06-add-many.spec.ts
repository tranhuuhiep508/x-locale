import { test, expect } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'
import { openAddManyDialog, openDemoStrings, searchStrings } from '../helpers/strings'

test.describe.configure({ mode: 'serial' })

const newKey = `e2e_add_many_${Date.now()}`

test.beforeAll(() => {
  resetDemoDatabase()
})

function buildPasteJson() {
  return JSON.stringify(
    {
      save: 'Lưu (add many updated)',
      [newKey]: 'E2E add many string',
    },
    null,
    2,
  )
}

test('add many paste: reject invalid JSON, cancel is a no-op, apply writes once', async ({
  page,
}) => {
  await openDemoStrings(page)
  await openAddManyDialog(page)

  const dialog = page.getByRole('dialog').filter({ hasText: 'Add many' })
  const json = dialog.getByLabel('JSON')

  await json.fill('{not json')
  await dialog.getByRole('button', { name: 'Preview' }).click()
  await expect(dialog.getByText(/Invalid JSON/)).toBeVisible()

  await json.fill('{"welcome": {"en": "Hi"}}')
  await dialog.getByRole('button', { name: 'Preview' }).click()
  await expect(dialog.getByText(/string value/)).toBeVisible()

  await json.fill('{}')
  await dialog.getByRole('button', { name: 'Preview' }).click()
  await expect(dialog.getByText('New strings')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Apply' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Back' }).click()

  await json.fill(buildPasteJson())
  await dialog.getByRole('combobox', { name: 'Module' }).click()
  await page.getByRole('option', { name: /Common/ }).click()
  await dialog.getByRole('button', { name: 'Preview' }).click()
  await expect(dialog.getByRole('button', { name: 'Apply' })).toBeVisible()
  await expect(dialog.getByText(newKey)).toBeVisible()
  await expect(dialog.getByText('~ save')).toBeVisible()

  await dialog.getByRole('button', { name: 'Back' }).click()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('heading', { name: 'Add many' })).toBeHidden()

  await searchStrings(page, newKey)
  await expect(page.getByRole('row').filter({ hasText: newKey })).toHaveCount(0)

  await openAddManyDialog(page)
  const applyDialog = page.getByRole('dialog').filter({ hasText: 'Add many' })
  await applyDialog.getByLabel('JSON').fill(buildPasteJson())
  await applyDialog.getByRole('combobox', { name: 'Module' }).click()
  await page.getByRole('option', { name: /Common/ }).click()
  await applyDialog.getByRole('button', { name: 'Preview' }).click()
  await expect(applyDialog.getByRole('button', { name: 'Apply' })).toBeVisible()
  await expect(applyDialog.getByText(newKey)).toBeVisible()
  await applyDialog.getByRole('button', { name: 'Apply' }).click()
  await expect(page.getByRole('heading', { name: 'Add many' })).toBeHidden()

  await searchStrings(page, newKey)
  const created = page.getByRole('row').filter({ hasText: newKey })
  await expect(created).toBeVisible()
  await expect(created.getByRole('switch', { name: 'Draft' })).toBeVisible()

  await searchStrings(page, 'save')
  await expect(page.getByRole('row').filter({ hasText: 'Lưu (add many updated)' })).toBeVisible()

  await page.getByRole('link', { name: 'Activity' }).click()
  await expect(page.getByText(/Imported · 2 strings/)).toBeVisible()
})
