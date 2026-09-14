import { test, expect } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'
import { fetchStringByKey, patchStringSource, projectIdFromUrl } from '../helpers/api'
import {
  cancelPublish,
  confirmPublish,
  expectPublishDialog,
  fillStringForm,
  openAddStringDialog,
  openDemoStrings,
  saveStringForm,
  searchStrings,
  setStatusFilter,
  togglePublishSwitch,
} from '../helpers/strings'

test.describe.configure({ mode: 'serial' })

const runId = Date.now()
const draftKey = `e2e_fp_draft_${runId}`
const staleKey = `e2e_fp_stale_${runId}`
const cancelKey = `e2e_fp_cancel_${runId}`
const needsPublishKey = `e2e_fp_needs_${runId}`

test.beforeAll(() => {
  resetDemoDatabase()
})

test('confirm publish sends server fingerprint and publishes draft', async ({ page }) => {
  await openDemoStrings(page)
  await openAddStringDialog(page)
  await fillStringForm(page, { key: draftKey, source: 'Fingerprint happy path' })
  await saveStringForm(page, 'create')
  await searchStrings(page, draftKey)

  await togglePublishSwitch(page, draftKey, true)
  await expectPublishDialog(page)

  const dialog = page.getByRole('dialog').filter({ hasText: 'Publish preview' })
  const batchRequest = page.waitForRequest(
    (req) => req.method() === 'POST' && req.url().includes('/strings/batch'),
  )
  await dialog.getByRole('button', { name: 'Publish' }).click()
  const request = await batchRequest
  const body = request.postDataJSON() as { action: string; fingerprint?: string }
  expect(body.action).toBe('publish')
  expect(body.fingerprint).toMatch(/^[a-f0-9]{64}$/)

  await expect(page.getByText('Published')).toBeVisible()
  await expect(
    page.getByRole('row').filter({ hasText: draftKey }).getByRole('switch', { name: 'Public' }),
  ).toBeVisible()

  const projectId = projectIdFromUrl(page)
  const entry = await fetchStringByKey(page, projectId, draftKey)
  expect(entry.status).toBe('public')
  expect(entry.published_source_text).toBe('Fingerprint happy path')
})

test('stale fingerprint: 409 re-previews; confirm after refresh publishes latest working copy', async ({
  page,
}) => {
  await openDemoStrings(page)
  await openAddStringDialog(page)
  await fillStringForm(page, { key: staleKey, source: 'Before stale preview' })
  await saveStringForm(page, 'create')
  await searchStrings(page, staleKey)

  const projectId = projectIdFromUrl(page)

  await togglePublishSwitch(page, staleKey, true)
  await expectPublishDialog(page)
  await expect(page.getByText('Before stale preview')).toBeVisible()

  const entry = await fetchStringByKey(page, projectId, staleKey)
  await patchStringSource(page, projectId, entry.id, 'After stale mutation')

  const dialog = page.getByRole('dialog').filter({ hasText: 'Publish preview' })
  const staleBatch = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' &&
      res.url().includes('/strings/batch') &&
      res.request().postDataJSON()?.action === 'publish',
  )
  await dialog.getByRole('button', { name: 'Publish' }).click()
  const batchResponse = await staleBatch
  expect(batchResponse.status()).toBe(409)

  await expect(page.getByText('Working copy changed. Review the updated preview.')).toBeVisible()
  await expectPublishDialog(page)
  await expect(page.getByText('After stale mutation')).toBeVisible()

  const stillDraft = await fetchStringByKey(page, projectId, staleKey)
  expect(stillDraft.status).toBe('draft')
  expect(stillDraft.published_source_text).toBeNull()

  await confirmPublish(page)
  await expect(page.getByText('Published')).toBeVisible()
  await expect(
    page.getByRole('row').filter({ hasText: staleKey }).getByRole('switch', { name: 'Public' }),
  ).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'After stale mutation' })).toBeVisible()

  const published = await fetchStringByKey(page, projectId, staleKey)
  expect(published.published_source_text).toBe('After stale mutation')
  expect(published.published_source_text).not.toBe('Before stale preview')
})

test('cancel publish preview leaves draft unchanged', async ({ page }) => {
  await openDemoStrings(page)
  await openAddStringDialog(page)
  await fillStringForm(page, { key: cancelKey, source: 'Cancel keeps draft' })
  await saveStringForm(page, 'create')
  await searchStrings(page, cancelKey)

  await togglePublishSwitch(page, cancelKey, true)
  await expectPublishDialog(page)
  await cancelPublish(page)
  await expect(page.getByRole('heading', { name: 'Publish preview' })).toBeHidden()

  await expect(
    page.getByRole('row').filter({ hasText: cancelKey }).getByRole('switch', { name: 'Draft' }),
  ).toBeVisible()

  const projectId = projectIdFromUrl(page)
  const entry = await fetchStringByKey(page, projectId, cancelKey)
  expect(entry.status).toBe('draft')
  expect(entry.published_source_text).toBeNull()
})

test('needs publish review confirms with fingerprint and clears filter', async ({ page }) => {
  await openDemoStrings(page)
  await openAddStringDialog(page)
  await fillStringForm(page, {
    key: needsPublishKey,
    source: 'Published once',
    published: true,
  })
  await saveStringForm(page, 'create')
  await searchStrings(page, needsPublishKey)

  await page.getByRole('row').filter({ hasText: needsPublishKey }).first().click()
  await page.getByLabel('Source text').fill('Edited working copy')
  await saveStringForm(page, 'edit')
  await expect(page.getByRole('heading', { name: 'Edit string' })).toBeHidden()

  await setStatusFilter(page, 'Needs publish')
  await expect(page.getByRole('button', { name: 'Review publish changes' })).toBeVisible()
  await page.getByRole('button', { name: 'Review publish changes' }).click()
  await expectPublishDialog(page)
  await expect(page.getByLabel('Content updates')).toBeVisible()

  const batchRequest = page.waitForRequest(
    (req) => req.method() === 'POST' && req.url().includes('/strings/batch'),
  )
  await confirmPublish(page)
  const request = await batchRequest
  const body = request.postDataJSON() as { fingerprint?: string }
  expect(body.fingerprint).toMatch(/^[a-f0-9]{64}$/)

  await expect(page.getByText('Published')).toBeVisible()
  await expect(
    page.getByRole('row').filter({ hasText: needsPublishKey }).getByRole('switch', { name: 'Public' }),
  ).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'Edited working copy' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Review publish changes' })).toBeHidden()
})
