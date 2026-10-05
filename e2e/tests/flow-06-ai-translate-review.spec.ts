import { test, expect } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'
import { importStringsViaApi, projectIdFromUrl } from '../helpers/api'
import { openDemoStrings } from '../helpers/strings'

test.describe.configure({ mode: 'serial' })

const pagingPrefix = `e2e_translate_page_${Date.now()}`

test.beforeAll(() => {
  resetDemoDatabase()
})

test('string preview sends the selected module and null after unassigning', async ({ page }) => {
  await openDemoStrings(page)
  const projectId = projectIdFromUrl(page)
  const response = await page.request.get(`/api/projects/${projectId}/modules`)
  const modules = await response.json() as { id: string; name: string }[]
  const module = modules[0]
  await page.getByRole('button', { name: 'Add string', exact: true }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: 'Add string' })
  await dialog.getByLabel('Key', { exact: true }).fill('preview_context')
  await dialog.getByLabel('Source text').fill('Xin chào')
  await dialog.getByRole('combobox', { name: 'Module' }).click()
  await page.getByRole('option', { name: module.name, exact: true }).click()
  const selected = page.waitForResponse((res) => res.url().endsWith('/translate/preview'))
  await dialog.getByRole('button', { name: 'Auto-translate' }).click()
  const preview = await selected
  expect(preview.ok()).toBeTruthy()
  expect(preview.request().postDataJSON().module_id).toBe(module.id)
  await dialog.getByRole('combobox', { name: 'Module' }).click()
  await page.getByRole('option', { name: '— None —', exact: true }).click()
  const unassigned = page.waitForResponse((res) => res.url().endsWith('/translate/preview'))
  await dialog.getByRole('button', { name: 'Auto-translate' }).click()
  const noModule = await unassigned
  expect(noModule.ok()).toBeTruthy()
  expect(noModule.request().postDataJSON().module_id).toBeNull()
})

test('translate missing: paging stays mounted, progress while generating, apply to working copy', async ({
  page,
}) => {
  await openDemoStrings(page)
  const projectId = projectIdFromUrl(page)

  const bulk: Record<string, string> = {}
  for (let i = 0; i < 45; i++) {
    bulk[`${pagingPrefix}_${i}`] = `Bulk source ${i}`
  }
  await importStringsViaApi(page, projectId, bulk)

  await page.getByRole('button', { name: 'Translate missing' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Missing Translations' })).toBeVisible()

  const paging = dialog.getByText(/\d+–\d+ of \d+/)
  await expect(paging).toBeVisible()
  const firstKey = dialog.locator('li').filter({ hasText: pagingPrefix }).first()
  await expect(firstKey).toBeVisible()

  const pagerButtons = paging.locator('..').getByRole('button')
  await pagerButtons.last().click()
  await expect(paging).toBeVisible()
  await expect(firstKey).toBeHidden()

  await pagerButtons.first().click()
  await expect(firstKey).toBeVisible()

  await dialog.getByRole('button', { name: 'Translate', exact: true }).click()
  await expect(dialog.getByRole('progressbar')).toBeVisible()
  await expect(paging).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Review Translations' })).toBeVisible()

  const applyButton = dialog.getByRole('button', { name: /Apply \d+ translations/ })
  await expect(applyButton).toBeEnabled()
  await applyButton.click()

  await expect(
    page.getByText(/Filled \d+ empty translations across \d+ strings/),
  ).toBeVisible()

  await dialog.getByRole('button', { name: 'Discard' }).click()
  await expect(dialog).toBeHidden()

  await page.getByRole('textbox', { name: 'Search strings' }).fill(`${pagingPrefix}_0`)
  const row = page.getByRole('row').filter({ hasText: `${pagingPrefix}_0` }).first()
  await expect(row).toBeVisible()
  await expect(row.getByRole('switch', { name: 'Draft' })).toBeVisible()
  await expect(row.getByText('[en]')).toBeVisible()
})
