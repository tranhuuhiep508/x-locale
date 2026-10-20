import { test, expect } from '../fixtures'
import { resetDemoDatabase } from '../helpers/database'
import {
  fillStringForm,
  openAddStringDialog,
  openDemoStrings,
  openStringEditor,
  saveStringForm,
} from '../helpers/strings'

test.beforeAll(() => resetDemoDatabase())

test('two editors merge unrelated changes and explicitly resolve competing text', async ({ page, context }) => {
  const key = `e2e_shared_${Date.now()}`
  await openDemoStrings(page)
  await openAddStringDialog(page)
  await fillStringForm(page, { key, source: 'Shared source' })
  await page.getByLabel('en', { exact: true }).fill('Original English')
  await saveStringForm(page)
  await expect(page.getByRole('heading', { name: 'Add string' })).toBeHidden()

  const bob = await context.newPage()
  await bob.goto(page.url())
  await openStringEditor(page, key)
  await openStringEditor(bob, key)

  await page.getByLabel('en', { exact: true }).fill('Alice English')
  await saveStringForm(page, 'edit')
  await expect(page.getByRole('heading', { name: 'Edit string' })).toBeHidden()
  await bob.getByLabel('Description').fill('Bob context')
  await saveStringForm(bob, 'edit')
  await expect(bob.getByRole('heading', { name: 'Edit string' })).toBeHidden()

  await page.reload()
  await openStringEditor(page, key)
  await expect(page.getByLabel('en', { exact: true })).toHaveValue('Alice English')
  await expect(page.getByLabel('Description')).toHaveValue('Bob context')
  await openStringEditor(bob, key)

  await page.getByLabel('en', { exact: true }).fill('Alice newer English')
  await saveStringForm(page, 'edit')
  await expect(page.getByRole('heading', { name: 'Edit string' })).toBeHidden()
  await bob.getByLabel('en', { exact: true }).fill('Bob English')
  await bob.getByLabel('Description').fill('Bob unsaved context')
  const conflict = bob.waitForResponse((response) => response.request().method() === 'PATCH' && response.status() === 409)
  await saveStringForm(bob, 'edit')
  await conflict
  await expect(bob.getByText('Latest saved: Alice newer English', { exact: true })).toBeVisible()
  await expect(bob.getByLabel('en', { exact: true })).toHaveValue('Bob English')
  await expect(bob.getByLabel('Description')).toHaveValue('Bob unsaved context')

  await bob.getByRole('button', { name: 'Keep my changes', exact: true }).click()
  await saveStringForm(bob, 'edit')
  await expect(bob.getByRole('heading', { name: 'Edit string' })).toBeHidden()
  await page.reload()
  await openStringEditor(page, key)
  await expect(page.getByLabel('en', { exact: true })).toHaveValue('Bob English')
  await expect(page.getByLabel('Description')).toHaveValue('Bob unsaved context')
})
