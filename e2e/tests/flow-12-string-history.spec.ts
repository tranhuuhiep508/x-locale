import { test, expect } from '@playwright/test'
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

const key = `e2e_history_${Date.now()}`

test.beforeAll(() => {
  resetDemoDatabase()
})

test('string history restore reverts working copy to previous version', async ({ page }) => {
  await openDemoStrings(page)

  // 1. Create string with initial version
  await openAddStringDialog(page)
  await fillStringForm(page, { key, source: 'Original version 1' })
  await saveStringForm(page, 'create')

  // 2. Edit string with updated version
  await openStringEditor(page, key)
  await page.getByLabel('Source text').fill('Updated version 2')
  await saveStringForm(page, 'edit')
  await expect(page.getByRole('heading', { name: 'Edit string' })).toBeHidden()

  // 3. Re-open string editor and switch to History tab
  await openStringEditor(page, key)
  await page.getByText('History', { exact: true }).click()

  // 4. Verify history list shows older version and click Restore
  const restoreButton = page.getByRole('button', { name: 'Restore' }).first()
  await expect(restoreButton).toBeVisible()
  await restoreButton.click()

  // 5. Switch back to Details tab and verify source text is restored
  await page.getByText('Details', { exact: true }).click()
  await expect(page.getByLabel('Source text')).toHaveValue('Original version 1')
})
