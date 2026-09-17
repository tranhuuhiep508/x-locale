import { test, expect } from '@playwright/test'
import { fetchStringByKey, projectIdFromUrl, seedPublicWithUnpublishedSource } from '../helpers/api'
import { resetDemoDatabase } from '../helpers/database'
import { openDemoStrings, openRowActions, searchStrings } from '../helpers/strings'

test.describe.configure({ mode: 'serial' })

const runId = Date.now()
const rowConfirmKey = `e2e_discard_row_ok_${runId}`
const rowCancelKey = `e2e_discard_row_cancel_${runId}`
const batchKeyA = `e2e_discard_batch_a_${runId}`
const batchKeyB = `e2e_discard_batch_b_${runId}`

const published = 'Published snapshot'
const working = 'Unpublished working edit'

test.beforeAll(() => {
  resetDemoDatabase()
})

async function seedDirtyKeys(
  page: import('@playwright/test').Page,
  keys: string[],
) {
  await openDemoStrings(page)
  const projectId = projectIdFromUrl(page)
  for (const key of keys) {
    await seedPublicWithUnpublishedSource(page, projectId, key, published, working)
  }
}

test('row discard cancel leaves unpublished working copy unchanged', async ({ page }) => {
  await seedDirtyKeys(page, [rowCancelKey])
  await searchStrings(page, rowCancelKey)

  await openRowActions(page, rowCancelKey)
  await page.getByRole('menuitem', { name: 'Discard changes' }).click()

  const dialog = page.getByRole('alertdialog', { name: 'Discard working copy?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()

  const projectId = projectIdFromUrl(page)
  const entry = await fetchStringByKey(page, projectId, rowCancelKey)
  expect(entry.source_text).toBe(working)
  expect(entry.has_unpublished_changes).toBe(true)
  await expect(page.getByRole('row').filter({ hasText: working })).toBeVisible()
})

test('row discard confirm restores last published snapshot', async ({ page }) => {
  await seedDirtyKeys(page, [rowConfirmKey])
  await searchStrings(page, rowConfirmKey)

  await openRowActions(page, rowConfirmKey)
  await page.getByRole('menuitem', { name: 'Discard changes' }).click()

  const dialog = page.getByRole('alertdialog', { name: 'Discard working copy?' })
  await dialog.getByRole('button', { name: 'Discard changes' }).click()
  await expect(page.getByText('Working copy discarded')).toBeVisible()

  const projectId = projectIdFromUrl(page)
  const entry = await fetchStringByKey(page, projectId, rowConfirmKey)
  expect(entry.source_text).toBe(published)
  expect(entry.has_unpublished_changes).toBe(false)
  await expect(page.getByRole('row').filter({ hasText: published })).toBeVisible()
})

test('batch discard restores published snapshot for selected strings', async ({ page }) => {
  await seedDirtyKeys(page, [batchKeyA, batchKeyB])
  await searchStrings(page, `e2e_discard_batch_`)

  for (const key of [batchKeyA, batchKeyB]) {
    const row = page.getByRole('row').filter({ hasText: key }).first()
    await row.getByRole('checkbox', { name: 'Select row' }).click()
  }

  const batchBar = page.getByRole('toolbar', { name: 'Batch actions' })
  const discardButton = batchBar.getByRole('button', { name: 'Discard changes' })
  await expect(discardButton).toBeVisible()
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/strings/batch') &&
        response.ok(),
    ),
    discardButton.click(),
  ])

  const projectId = projectIdFromUrl(page)
  for (const key of [batchKeyA, batchKeyB]) {
    await expect
      .poll(async () => (await fetchStringByKey(page, projectId, key)).source_text)
      .toBe(published)
    const entry = await fetchStringByKey(page, projectId, key)
    expect(entry.has_unpublished_changes).toBe(false)
  }
})
