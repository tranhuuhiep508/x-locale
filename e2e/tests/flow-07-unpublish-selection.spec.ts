import { test, expect } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'
import {
  fillStringForm,
  openAddStringDialog,
  openDemoStrings,
  saveStringForm,
  searchStrings,
} from '../helpers/strings'

test.describe.configure({ mode: 'serial' })

const publicKey = `e2e_unpublish_${Date.now()}`

test.beforeAll(() => {
  resetDemoDatabase()
})

test('batch unpublish moves published string back to draft immediately', async ({ page }) => {
  await openDemoStrings(page)
  await openAddStringDialog(page)
  await fillStringForm(page, { key: publicKey, source: 'Published for unpublish', published: true })
  await saveStringForm(page, 'create')
  await searchStrings(page, publicKey)

  const row = page.getByRole('row').filter({ hasText: publicKey }).first()
  await expect(row.getByRole('switch', { name: 'Public' })).toBeVisible()

  await row.getByRole('checkbox', { name: 'Select row' }).click()
  await page
    .getByRole('toolbar', { name: 'Batch actions' })
    .getByRole('button', { name: 'Unpublish' })
    .click()

  await expect(row.getByRole('switch', { name: 'Draft' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
