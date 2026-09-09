import { test, expect } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'
import {
  cancelPublish,
  confirmPublish,
  expectPublishDialog,
  fillStringForm,
  openAddStringDialog,
  openDemoStrings,
  openRowActions,
  saveStringForm,
  searchStrings,
  setStatusFilter,
} from '../helpers/strings'

test.describe.configure({ mode: 'serial' })

const draftKey = `e2e_delete_draft_${Date.now()}`
const publicKey = `e2e_delete_public_${Date.now()}`

test.beforeAll(() => {
  resetDemoDatabase()
})

test('never-published string: delete then restore from Deleted filter', async ({ page }) => {
  await openDemoStrings(page)
  await openAddStringDialog(page)
  await fillStringForm(page, { key: draftKey, source: 'Delete me' })
  await saveStringForm(page, 'create')
  await searchStrings(page, draftKey)

  await openRowActions(page, draftKey)
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('row').filter({ hasText: draftKey })).toHaveCount(0)

  await setStatusFilter(page, 'Deleted')
  await searchStrings(page, draftKey)
  await openRowActions(page, draftKey)
  await page.getByRole('menuitem', { name: 'Restore' }).click()

  await setStatusFilter(page, 'All')
  await searchStrings(page, draftKey)
  await expect(page.getByRole('row').filter({ hasText: draftKey })).toBeVisible()
})

test('published string: pending delete then publish removal', async ({ page }) => {
  await openDemoStrings(page)
  await openAddStringDialog(page)
  await fillStringForm(page, { key: publicKey, source: 'Published copy', published: true })
  await saveStringForm(page, 'create')
  await searchStrings(page, publicKey)

  await openRowActions(page, publicKey)
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Queue deletion' }).click()

  await openRowActions(page, publicKey)
  await page.getByRole('menuitem', { name: 'Publish delete' }).click()
  await expectPublishDialog(page)
  await expect(page.getByLabel('Removals')).toBeVisible()
  await confirmPublish(page)

  await setStatusFilter(page, 'Deleted')
  await searchStrings(page, publicKey)
  await expect(page.getByRole('row').filter({ hasText: publicKey })).toBeVisible()
})
