import { test, expect } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'
import { openDemoStrings, searchStrings } from '../helpers/strings'

test.describe.configure({ mode: 'serial' })

const moduleSlug = `mod_${Date.now()}`
const moduleName = `E2E Mod ${Date.now()}`
const tagName = `tag_${Date.now()}`

test.beforeAll(() => {
  resetDemoDatabase()
})

test('manage modules: create module and view in table', async ({ page }) => {
  await openDemoStrings(page)
  await page.getByRole('link', { name: 'Modules' }).click()
  await expect(page.getByRole('heading', { name: 'Modules' })).toBeVisible()

  await page.getByRole('button', { name: 'New module' }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: 'New module' })
  await expect(dialog).toBeVisible()

  await dialog.getByLabel('Slug').fill(moduleSlug)
  await dialog.getByLabel('Name').fill(moduleName)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(dialog).toBeHidden()

  await page.getByPlaceholder('Search modules…').fill(moduleSlug)
  await expect(page.getByRole('row').filter({ hasText: moduleName })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: moduleSlug })).toBeVisible()
})

test('manage tags: create tag and view in table', async ({ page }) => {
  await openDemoStrings(page)
  await page.getByRole('link', { name: 'Tags' }).click()
  await expect(page.getByRole('heading', { name: 'Tags' })).toBeVisible()

  await page.getByRole('button', { name: 'New tag' }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: 'New tag' })
  await expect(dialog).toBeVisible()

  await dialog.getByLabel('Name').fill(tagName)
  await dialog.getByRole('button', { name: 'Create' }).click()
  await expect(dialog).toBeHidden()

  await page.getByPlaceholder('Search tags…').fill(tagName)
  await expect(page.getByRole('row').filter({ hasText: tagName })).toBeVisible()
})
