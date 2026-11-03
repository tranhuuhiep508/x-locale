import { test, expect } from '../fixtures'
import { resetDemoDatabase } from '../helpers/database'
import { openDemoStrings, openAddStringDialog, fillStringForm, openStringEditor } from '../helpers/strings'
import { fetchStringByKey, projectIdFromUrl } from '../helpers/api'

test.beforeAll(() => resetDemoDatabase())

test('create, review, publish, and keep editing without leaving the dialog', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openDemoStrings(page)
  const key = `compact_${Date.now()}`
  await openAddStringDialog(page)
  await fillStringForm(page, { key, source: 'Welcome' })
  await page.getByLabel('en', { exact: true }).fill('Welcome English')
  await page.getByRole('button', { name: 'Create and publish' }).click()
  await expect(page.getByRole('heading', { name: 'Review publication' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('editor-review-mobile.png') })
  const project = projectIdFromUrl(page)
  const before = await page.request.get(`/api/projects/${project}/strings?q=${key}`)
  expect((await before.json()).total).toBe(0)
  await page.getByRole('button', { name: 'Back to editing' }).click()
  await expect(page.getByLabel('en', { exact: true })).toHaveValue('Welcome English')
  await page.getByRole('button', { name: 'Create and publish' }).click()
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit string', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Source text')).toHaveValue('Welcome')
  expect((await fetchStringByKey(page, project, key)).published_source_text).toBe('Welcome')
  await dialog.getByLabel('Source text').fill('Good morning')
  await dialog.getByRole('button', { name: 'Save as draft' }).click()
  await expect(page.getByText('String saved as draft', { exact: true })).toBeVisible()
  await expect(dialog).toBeVisible()
  expect((await fetchStringByKey(page, project, key)).published_source_text).toBe('Welcome')
  await dialog.getByRole('button', { name: 'Publish changes' }).click()
  await expect(page.getByRole('region', { name: 'Content updates' })).toBeVisible()
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'View in Strings' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('editor-saved-mobile.png') })
  await dialog.getByRole('button', { name: 'View in Strings' }).click()
  await expect(dialog).toBeHidden()
  await expect(page).toHaveURL(new RegExp(`q=${key}`))
  expect((await fetchStringByKey(page, project, key)).published_source_text).toBe('Good morning')
})

test('draft creation stays open and reuses the saved string on subsequent saves', async ({ page }) => {
  await openDemoStrings(page)
  await openAddStringDialog(page)
  const key = `compact_draft_${Date.now()}`
  await fillStringForm(page, { key, source: 'Draft content' })
  await page.getByRole('button', { name: 'Save as draft' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit string', exact: true })
  await expect(dialog).toBeVisible()
  const project = projectIdFromUrl(page)
  const first = await fetchStringByKey(page, project, key)
  expect(first.status).toBe('draft')
  await dialog.getByLabel('Source text').fill('Revised draft')
  const response = page.waitForResponse((res) => res.url().endsWith('/strings/editor-save'))
  await dialog.getByRole('button', { name: 'Save as draft' }).click()
  expect((await response).ok()).toBeTruthy()
  expect((await fetchStringByKey(page, project, key)).id).toBe(first.id)
  await expect(dialog).toBeVisible()
})

test('a competing locale edit refreshes the review and requires another confirmation', async ({ page }) => {
  await openDemoStrings(page)
  const project = projectIdFromUrl(page)
  const key = `compact_stale_${Date.now()}`
  const created = await page.request.post(`/api/projects/${project}/strings`, {
    data: { key, source_text: 'Shared source', translations: { en: 'Original English', ja: 'Original Japanese' } },
  })
  expect(created.ok()).toBeTruthy()
  const entry = await created.json()
  await openStringEditor(page, key)
  await page.getByLabel('en', { exact: true }).fill('My English')
  await page.getByRole('button', { name: 'Publish changes' }).click()
  await expect(page.getByRole('heading', { name: 'Review publication' })).toBeVisible()
  const changed = await page.request.patch(`/api/projects/${project}/strings/${entry.id}`, {
    data: { translations: { ja: 'Competing Japanese' } },
  })
  expect(changed.ok()).toBeTruthy()
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Complete proposed public content' }).getByText('Competing Japanese')).toBeVisible()
  expect((await fetchStringByKey(page, project, key)).status).toBe('draft')
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save as draft' })).toBeVisible()
  const saved = await (await page.request.get(`/api/projects/${project}/strings/${entry.id}`)).json()
  expect(saved.translations.find((t: { locale: string }) => t.locale === 'en').published_value).toBe('My English')
  expect(saved.translations.find((t: { locale: string }) => t.locale === 'ja').published_value).toBe('Competing Japanese')
})
