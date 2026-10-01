import { test, expect } from '@playwright/test'
import {
  deleteStringViaApi,
  fetchStringByKey,
  importStringsViaApi,
  projectIdFromUrl,
  publishStringsViaApi,
} from '../helpers/api'
import { resetDemoDatabase } from '../helpers/database'
import { openDemoStrings } from '../helpers/strings'

test.beforeAll(() => resetDemoDatabase())

test('mixed selection across pages shows eligible counts and never restores a tombstone when discarding a removal', async ({ page }) => {
  await openDemoStrings(page)
  const projectId = projectIdFromUrl(page)
  const prefix = `e2e_mixed_${Date.now()}`
  const pendingKey = `${prefix}_01_pending`
  const liveKey = `${prefix}_02_live`
  const deletedKey = `${prefix}_03_deleted`
  const imported = await importStringsViaApi(page, projectId, {
    [pendingKey]: 'Pending removal',
    [liveKey]: 'Live draft',
    [deletedKey]: 'Published tombstone',
  })
  const pending = await fetchStringByKey(page, projectId, pendingKey)
  const deleted = await fetchStringByKey(page, projectId, deletedKey)
  await publishStringsViaApi(page, projectId, [pending.id, deleted.id])
  await deleteStringViaApi(page, projectId, pending.id)
  await deleteStringViaApi(page, projectId, deleted.id)
  await publishStringsViaApi(page, projectId, [deleted.id])

  await page.goto(`/projects/${projectId}/strings?batch_id=${imported.batch_id}&page_size=2&page=1`)
  await page.getByRole('row').filter({ hasText: pendingKey })
    .getByRole('checkbox', { name: 'Select row' }).click()
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(page).toHaveURL(/page=2/)
  await page.getByRole('row').filter({ hasText: deletedKey })
    .getByRole('checkbox', { name: 'Select row' }).click()

  const toolbar = page.getByRole('toolbar', { name: 'Batch actions' })
  const discard = toolbar.getByRole('button', { name: 'Discard delete', exact: true })
  await expect(discard).toBeEnabled()
  await expect(discard).toHaveText(/Discard delete\s*1/)
  await expect(discard).toHaveAttribute('aria-description', /1 of 2 selected strings/)
  await expect(toolbar.getByRole('button', { name: 'Restore', exact: true })).toHaveText(/Restore\s*1/)
  await expect(toolbar.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled()

  await toolbar.getByRole('button', { name: 'Unpublish', exact: true }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Unpublish this string?' })
  await expect(confirm).toContainText('1 selected string will be skipped')
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(confirm).toBeHidden()

  const [request] = await Promise.all([
    page.waitForRequest((request) => request.method() === 'POST' &&
      request.url().endsWith('/strings/batch') &&
      request.postDataJSON().action === 'discard_delete'),
    discard.click(),
  ])
  expect(request.postDataJSON()).toEqual({
    action: 'discard_delete', string_ids: [pending.id],
  })
  await expect(page.locator('[data-sonner-toast]').filter({
    hasText: 'Discarded pending delete on 1 string. 1 selected string skipped',
  })).toBeVisible()
  await expect(toolbar).toBeHidden()

  const pendingResponse = await page.request.get(`/api/projects/${projectId}/strings/${pending.id}`)
  expect(pendingResponse.ok()).toBeTruthy()
  expect((await pendingResponse.json()).pending_delete).toBe(false)
  const deletedResponse = await page.request.get(`/api/projects/${projectId}/strings/${deleted.id}`)
  expect(deletedResponse.ok()).toBeTruthy()
  const tombstone = await deletedResponse.json()
  expect(tombstone.deleted_at).toBeTruthy()
  expect(tombstone.pending_delete).toBe(false)
})
