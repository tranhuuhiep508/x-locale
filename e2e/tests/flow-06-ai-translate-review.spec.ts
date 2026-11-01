import { test, expect } from '../fixtures'
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
  await dialog.getByRole('button', { name: 'Generate with AI' }).click()
  const preview = await selected
  expect(preview.ok()).toBeTruthy()
  expect(preview.request().postDataJSON().module_id).toBe(module.id)
  await dialog.getByRole('combobox', { name: 'Module' }).click()
  await page.getByRole('option', { name: '— None —', exact: true }).click()
  const unassigned = page.waitForResponse((res) => res.url().endsWith('/translate/preview'))
  await dialog.getByRole('button', { name: 'Generate with AI' }).click()
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

test('stale AI proposals require targeted regeneration and preserve unrelated drafts', async ({ page }) => {
  await openDemoStrings(page)
  const projectId = projectIdFromUrl(page)
  const root = `/api/projects/${projectId}`
  const prefix = `e2e_source_conflict_${Date.now()}`
  const rows: Array<{ id: string; key: string }> = []
  for (const suffix of ['stale', 'unrelated']) {
    const response = await page.request.post(`${root}/strings`, {
      data: { key: `${prefix}_${suffix}`, source_text: 'Lưu' },
    })
    expect(response.ok(), await response.text()).toBeTruthy()
    rows.push(await response.json())
  }
  await page.getByRole('textbox', { name: 'Search strings' }).fill(prefix)
  await expect(page.getByRole('row').filter({ hasText: rows[1].key })).toBeVisible()
  await page.getByRole('button', { name: 'Translate missing' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('li').filter({ hasText: prefix })).toHaveCount(2)
  await dialog.getByRole('button', { name: 'Translate', exact: true }).click()
  const stale = dialog.locator('li').filter({ hasText: rows[0].key })
  const unrelated = dialog.locator('li').filter({ hasText: rows[1].key })
  await expect(stale.getByLabel('en', { exact: true })).toBeVisible()
  await unrelated.getByLabel('en', { exact: true }).fill('Unrelated reviewed draft')
  const edited = await page.request.patch(`${root}/strings/${rows[0].id}`, { data: { source_text: 'Hủy' } })
  expect(edited.ok()).toBeTruthy()
  const conflictResponse = page.waitForResponse((response) => response.url().endsWith('/translate/apply'))
  await dialog.getByRole('button', { name: /^Apply/ }).click()
  expect((await conflictResponse).status()).toBe(409)
  await expect(stale.getByText('Source text changed since generation')).toBeVisible()
  await expect(unrelated.getByLabel('en', { exact: true })).toHaveValue('Unrelated reviewed draft')
  const before = await page.request.get(`${root}/strings/${rows[1].id}`)
  expect((await before.json()).translations.every((cell: { value: string }) => cell.value === '')).toBe(true)
  const regenerated = page.waitForResponse((response) => response.url().endsWith('/translate/proposals'))
  await dialog.getByRole('button', { name: 'Regenerate changed strings' }).click()
  const generation = await regenerated
  expect(generation.ok()).toBeTruthy()
  expect(generation.request().postDataJSON().string_ids).toEqual([rows[0].id])
  await expect(stale.getByText('Source text changed since generation')).toBeHidden()
  await expect(stale.getByLabel('en', { exact: true })).toBeVisible()
  await expect(unrelated.getByLabel('en', { exact: true })).toHaveValue('Unrelated reviewed draft')
  const applied = page.waitForResponse((response) => response.url().endsWith('/translate/apply'))
  await dialog.getByRole('button', { name: /^Apply/ }).click()
  const response = await applied
  expect(response.ok(), await response.text()).toBeTruthy()
  const items = response.request().postDataJSON().items as Array<{ string_id: string; expected_source_text: string; translations: Record<string, string> }>
  expect(items.find((item) => item.string_id === rows[0].id)?.expected_source_text).toBe('Hủy')
  expect(items.find((item) => item.string_id === rows[1].id)?.translations.en).toBe('Unrelated reviewed draft')
})
