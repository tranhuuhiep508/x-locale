import { test, expect } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'
import {
  clearStringSearch,
  createInlineModule,
  createInlineTag,
  fillStringForm,
  openAddStringDialog,
  openDemoStrings,
  openStringEditor,
  saveStringForm,
  searchStrings,
} from '../helpers/strings'

test.describe.configure({ mode: 'serial' })

const key = `e2e_catalog_${Date.now()}`
const moduleSlug = `e2e-mod-${Date.now()}`
const moduleName = 'E2E Module'
const tagName = `E2E Tag ${Date.now()}`

test.beforeAll(() => {
  resetDemoDatabase()
})

test('add string with inline module and tag, then edit source', async ({ page }) => {
  await openDemoStrings(page)
  await openAddStringDialog(page)
  await fillStringForm(page, { key, source: 'Original source' })
  await createInlineModule(page, moduleSlug, moduleName)
  await createInlineTag(page, tagName)
  await saveStringForm(page, 'create')

  await expect(page.getByRole('heading', { name: 'Add string' })).toBeHidden()
  await searchStrings(page, key)
  await expect(page.getByRole('row').filter({ hasText: key })).toBeVisible()

  await openStringEditor(page, key)
  await page.getByLabel('Source text').fill('Updated source')
  await saveStringForm(page, 'edit')

  await clearStringSearch(page)
  await searchStrings(page, key)
  await expect(page.getByRole('row').filter({ hasText: 'Updated source' })).toBeVisible()
})
