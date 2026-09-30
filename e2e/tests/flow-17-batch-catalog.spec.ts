import { test, expect } from '@playwright/test'
import {
  deleteStringViaApi,
  fetchStringByKey,
  importStringsViaApi,
  projectIdFromUrl,
} from '../helpers/api'
import { resetDemoDatabase } from '../helpers/database'
import {
  cancelPublish,
  expectPublishDialog,
  openDemoStrings,
  searchStrings,
} from '../helpers/strings'

test.describe.configure({ mode: 'serial' })

const runId = Date.now()
const liveKey = `e2e_batch_live_${runId}`
const deletedKey = `e2e_batch_deleted_${runId}`
const unknownBatchId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

let projectRef = ''
let batchId = ''

test.beforeAll(() => {
  resetDemoDatabase()
})

async function expectRowBatchSelected(
  page: import('@playwright/test').Page,
  key: string,
  selected: boolean,
) {
  const checkbox = page
    .getByRole('row')
    .filter({ hasText: key })
    .first()
    .getByRole('checkbox', { name: 'Select row' })
  if (selected) {
    await expect(checkbox).toBeChecked()
    await expect(
      page
        .getByRole('toolbar', { name: 'Batch actions' })
        .getByRole('button', { name: 'Publish', exact: true }),
    ).toBeVisible()
  } else {
    await expect(checkbox).not.toBeChecked()
    await expect(
      page
        .getByRole('toolbar', { name: 'Batch actions' })
        .getByRole('button', { name: 'Publish', exact: true }),
    ).toBeHidden()
  }
}

async function openActivity(page: import('@playwright/test').Page) {
  await page.getByRole('link', { name: 'Activity' }).click()
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible()
}

async function openBatchCatalogFromActivity(page: import('@playwright/test').Page) {
  await openActivity(page)
  const review = page.getByRole('link', { name: 'Review this batch' }).first()
  await expect(review).toBeVisible()
  await review.click()
  await expect(page).toHaveURL(new RegExp(`batch_id=${batchId}`))
  await expect(page.getByText('Filtered to this push')).toBeVisible()
}

test('seed import batch with a soft-deleted member', async ({ page }) => {
  await openDemoStrings(page)
  projectRef = projectIdFromUrl(page)

  const imported = await importStringsViaApi(page, projectRef, {
    [liveKey]: 'Batch live member',
    [deletedKey]: 'Batch deleted member',
  })
  expect(imported.created).toBe(2)
  batchId = imported.batch_id

  const tombstone = await fetchStringByKey(page, projectRef, deletedKey)
  await deleteStringViaApi(page, projectRef, tombstone.id)

  await searchStrings(page, deletedKey)
  await expect(page.getByRole('row').filter({ hasText: deletedKey })).toHaveCount(0)
})

test('happy path: Review this batch lists members including soft-deleted', async ({ page }) => {
  await openDemoStrings(page)
  await openBatchCatalogFromActivity(page)

  await expect(page.getByRole('row').filter({ hasText: liveKey })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: deletedKey })).toBeVisible()
})

test('chip clear: drops batch filter, hides tombstone, clears selection', async ({ page }) => {
  await openDemoStrings(page)
  await page.goto(
    `/projects/${projectRef}/strings?batch_id=${batchId}&batch_kind=import&page=1`,
  )
  await expect(page.getByText('Filtered to this push')).toBeVisible()

  const liveRow = page.getByRole('row').filter({ hasText: liveKey }).first()
  await liveRow.getByRole('checkbox', { name: 'Select row' }).click()
  await expectRowBatchSelected(page, liveKey, true)

  await page.getByRole('button', { name: 'Clear batch filter' }).click()
  await expect(page).not.toHaveURL(new RegExp(`batch_id=${batchId}`))
  await expect(page.getByText('Filtered to this push')).toHaveCount(0)
  await expectRowBatchSelected(page, liveKey, false)

  await searchStrings(page, deletedKey)
  await expect(page.getByRole('row').filter({ hasText: deletedKey })).toHaveCount(0)
})

test('Clear all: removes batch filter and selection', async ({ page }) => {
  await openDemoStrings(page)
  await page.goto(
    `/projects/${projectRef}/strings?batch_id=${batchId}&batch_kind=import&page=1`,
  )
  await expect(page.getByText('Filtered to this push')).toBeVisible()

  const liveRow = page.getByRole('row').filter({ hasText: liveKey }).first()
  await liveRow.getByRole('checkbox', { name: 'Select row' }).click()
  await expectRowBatchSelected(page, liveKey, true)

  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(page).not.toHaveURL(/batch_id=/)
  await expect(page.getByText('Filtered to this push')).toHaveCount(0)
  await expectRowBatchSelected(page, liveKey, false)
})

test('unknown batch_id shows batch empty state; chip remains clearable', async ({ page }) => {
  await openDemoStrings(page)
  await page.goto(
    `/projects/${projectRef}/strings?batch_id=${unknownBatchId}&batch_kind=import&page=1`,
  )

  await expect(page.getByText('No strings left for this batch')).toBeVisible()
  await expect(page.getByText('Clear the batch filter to see the live catalog.')).toBeVisible()
  await expect(page.getByText('Filtered to this push')).toBeVisible()

  await page.getByRole('button', { name: 'Clear batch filter' }).click()
  await expect(page).not.toHaveURL(/batch_id=/)
  await expect(page.getByRole('button', { name: 'Add string' })).toBeVisible()
})

test('import activity card exposes Review this batch (translate/excel covered in unit tests)', async ({
  page,
}) => {
  await openDemoStrings(page)
  await openActivity(page)

  await expect(page.getByText(/Imported · \d+ strings/).first()).toBeVisible()
  await expect(page.getByRole('link', { name: 'Review this batch' }).first()).toBeVisible()
})

test('optional: publish preview from batch-filtered selection can be cancelled', async ({
  page,
}) => {
  await openDemoStrings(page)
  await page.goto(
    `/projects/${projectRef}/strings?batch_id=${batchId}&batch_kind=import&page=1`,
  )

  const liveRow = page.getByRole('row').filter({ hasText: liveKey }).first()
  await liveRow.getByRole('checkbox', { name: 'Select row' }).click()
  await page
    .getByRole('toolbar', { name: 'Batch actions' })
    .getByRole('button', { name: 'Publish', exact: true })
    .click()

  await expectPublishDialog(page)
  await cancelPublish(page)
  await expect(page.getByRole('heading', { name: 'Publish preview' })).toBeHidden()
})
