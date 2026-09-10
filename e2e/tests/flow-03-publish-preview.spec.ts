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
  openStringEditor,
  saveStringForm,
  searchStrings,
  togglePublishSwitch,
} from '../helpers/strings'

test.describe.configure({ mode: 'serial' })

const draftKey = `e2e_publish_draft_${Date.now()}`
const publicKey = `e2e_publish_public_${Date.now()}`

test.beforeAll(() => {
  resetDemoDatabase()
})

test('never-published draft: cancel keeps draft, confirm publishes', async ({ page }) => {
  await openDemoStrings(page)
  await openAddStringDialog(page)
  await fillStringForm(page, { key: draftKey, source: 'Draft only' })
  await saveStringForm(page, 'create')
  await searchStrings(page, draftKey)

  await togglePublishSwitch(page, draftKey, true)
  await expectPublishDialog(page)
  await expect(page.getByLabel('New to public')).toBeVisible()

  await cancelPublish(page)
  await expect(page.getByRole('heading', { name: 'Publish preview' })).toBeHidden()
  await expect(
    page.getByRole('row').filter({ hasText: draftKey }).getByRole('switch', { name: 'Draft' }),
  ).toBeVisible()

  await togglePublishSwitch(page, draftKey, true)
  await confirmPublish(page)
  await expect(
    page.getByRole('row').filter({ hasText: draftKey }).getByRole('switch', { name: 'Public' }),
  ).toBeVisible()
})

test('edit public string shows content updates in publish preview', async ({ page }) => {
  await openDemoStrings(page)
  await openAddStringDialog(page)
  await fillStringForm(page, { key: publicKey, source: 'Version 1', published: true })
  await saveStringForm(page, 'create')
  await searchStrings(page, publicKey)

  await openStringEditor(page, publicKey)
  await page.getByLabel('Source text').fill('Version 2')
  await saveStringForm(page, 'edit')
  await expect(page.getByRole('heading', { name: 'Edit string' })).toBeHidden()

  await openRowActions(page, publicKey)
  await page.getByRole('menuitem', { name: 'Publish working copy' }).click()
  await expectPublishDialog(page)
  await expect(page.getByLabel('Content updates')).toBeVisible()
  await confirmPublish(page)
  await expect(page.getByRole('row').filter({ hasText: 'Version 2' })).toBeVisible()
})

test('in-sync public string shows nothing to publish with confirm disabled', async ({ page }) => {
  await searchStrings(page, publicKey)
  const row = page.getByRole('row').filter({ hasText: publicKey }).first()
  await row.getByRole('checkbox', { name: 'Select row' }).click()
  await page
    .getByRole('toolbar', { name: 'Batch actions' })
    .getByRole('button', { name: 'Publish', exact: true })
    .click()
  await expectPublishDialog(page)
  await expect(page.getByText('Nothing to publish')).toBeVisible()
  const dialog = page.getByRole('dialog').filter({ hasText: 'Publish preview' })
  await expect(dialog.getByRole('button', { name: 'Publish' })).toBeDisabled()
  await cancelPublish(page)
})

test('needs publish filter opens review publish changes', async ({ page }) => {
  await openDemoStrings(page)
  await page.getByRole('combobox', { name: 'Status' }).click()
  await page.getByRole('option', { name: 'Needs publish' }).click()
  await expect(page.getByRole('button', { name: 'Review publish changes' })).toBeVisible()
  await page.getByRole('button', { name: 'Review publish changes' }).click()
  await expectPublishDialog(page)
  await cancelPublish(page)
})
