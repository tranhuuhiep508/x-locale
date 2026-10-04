import { test, expect } from '@playwright/test'
import {
  deleteStringViaApi,
  exportXlsxViaApi,
  fetchStringByKey,
  importStringsViaApi,
  importXlsxViaApi,
  patchStringSource,
  projectIdFromUrl,
  publishStringsViaApi,
  translateApplyBatchViaApi,
} from '../helpers/api'
import { resetDemoDatabase } from '../helpers/database'
import {
  cancelPublish,
  clearStringSearch,
  expectPublishDialog,
  openDemoStrings,
  searchStrings,
} from '../helpers/strings'

test.describe.configure({ mode: 'serial' })

const runId = Date.now()
const liveKey = `e2e_batch_live_${runId}`
const deletedKey = `e2e_batch_deleted_${runId}`
const pendingKey = `e2e_batch_pending_${runId}`
const excelKey = `e2e_batch_excel_${runId}`
const translateKey = `e2e_batch_translate_${runId}`
const unknownBatchId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

let projectRef = ''
let batchId = ''
let excelBatchId = ''
let translateBatchId = ''

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

async function reviewBatchFromActivityCard(
  page: import('@playwright/test').Page,
  cardSummary: RegExp,
  expectedBatchId: string,
  chipLabel: string,
) {
  await openActivity(page)
  const card = page.locator('div.rounded-lg').filter({ hasText: cardSummary }).first()
  await expect(card).toBeVisible()
  await card.getByRole('link', { name: 'Review this batch' }).click()
  await expect(page).toHaveURL(new RegExp(`batch_id=${expectedBatchId}`))
  await expect(page.getByText(chipLabel)).toBeVisible()
}

test('seed import batch with soft-deleted and pending_delete members', async ({ page }) => {
  await openDemoStrings(page)
  projectRef = projectIdFromUrl(page)

  const imported = await importStringsViaApi(page, projectRef, {
    [liveKey]: 'Batch live member',
    [deletedKey]: 'Batch deleted member',
    [pendingKey]: 'Batch pending delete member',
  })
  expect(imported.created).toBe(3)
  batchId = imported.batch_id

  const tombstone = await fetchStringByKey(page, projectRef, deletedKey)
  await deleteStringViaApi(page, projectRef, tombstone.id)

  const pending = await fetchStringByKey(page, projectRef, pendingKey)
  await publishStringsViaApi(page, projectRef, [pending.id])
  await deleteStringViaApi(page, projectRef, pending.id)

  await searchStrings(page, deletedKey)
  await expect(page.getByRole('row').filter({ hasText: deletedKey })).toHaveCount(0)

  await searchStrings(page, pendingKey)
  await expect(page.getByRole('row').filter({ hasText: pendingKey })).toBeVisible()
})

test('happy path: Review this batch lists live, soft-deleted, and pending_delete members', async ({
  page,
}) => {
  await openDemoStrings(page)
  await reviewBatchFromActivityCard(
    page,
    /Imported · \d+ strings?/,
    batchId,
    'Filtered to this push',
  )

  await expect(page.getByRole('row').filter({ hasText: liveKey })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: deletedKey })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: pendingKey })).toBeVisible()
})

test('clearing search preserves batch_id and batch chip (AC13 preserve-path)', async ({ page }) => {
  await openDemoStrings(page)
  await reviewBatchFromActivityCard(
    page,
    /Imported · \d+ strings?/,
    batchId,
    'Filtered to this push',
  )

  await searchStrings(page, liveKey)
  await expect(page.getByRole('row').filter({ hasText: liveKey })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: deletedKey })).toHaveCount(0)
  await expect(page.getByRole('row').filter({ hasText: 'sign_in' })).toHaveCount(0)

  await clearStringSearch(page)
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBeNull()
  await expect(page).toHaveURL(new RegExp(`batch_id=${batchId}`))
  await expect(page.getByText('Filtered to this push')).toBeVisible()

  await expect(page.getByRole('row').filter({ hasText: liveKey })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: deletedKey })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: pendingKey })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'sign_in' })).toHaveCount(0)
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

  await searchStrings(page, pendingKey)
  await expect(page.getByRole('row').filter({ hasText: pendingKey })).toBeVisible()
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
  await expect(page.getByRole('button', { name: 'Add string' })).toHaveCount(1)
})

test('excel_import activity card: Review this batch opens kind-aware catalog', async ({ page }) => {
  await openDemoStrings(page)

  await importStringsViaApi(page, projectRef, { [excelKey]: 'Excel seed v1' })
  const excelRow = await fetchStringByKey(page, projectRef, excelKey)
  await patchStringSource(page, projectRef, excelRow.id, 'Excel seed v2')

  const workbook = await exportXlsxViaApi(page, projectRef)
  await patchStringSource(page, projectRef, excelRow.id, 'Excel seed v1')

  const excelImport = await importXlsxViaApi(page, projectRef, workbook)
  expect(excelImport.updated).toBeGreaterThan(0)
  excelBatchId = excelImport.batch_id

  await reviewBatchFromActivityCard(
    page,
    /Imported from Excel · \d+ strings?/,
    excelBatchId,
    'Filtered to this Excel import',
  )
  await expect(page.getByRole('row').filter({ hasText: excelKey })).toBeVisible()
})

test('translate activity card: Review this batch opens kind-aware catalog', async ({ page }) => {
  await openDemoStrings(page)

  await importStringsViaApi(page, projectRef, { [translateKey]: 'Translate source' })
  const created = await fetchStringByKey(page, projectRef, translateKey)

  const applied = await translateApplyBatchViaApi(page, projectRef, created.id)
  expect(applied.translated_count).toBeGreaterThan(0)
  translateBatchId = applied.batch_id

  await reviewBatchFromActivityCard(
    page,
    /AI translated \d+ strings?/,
    translateBatchId,
    'Filtered to this translation',
  )
  await expect(page.getByRole('row').filter({ hasText: translateKey })).toBeVisible()
})

test('import activity card exposes Review this batch', async ({ page }) => {
  await openDemoStrings(page)
  await openActivity(page)

  await expect(page.getByText(/Imported · \d+ strings?/).first()).toBeVisible()
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
