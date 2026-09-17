import { test, expect, type Page } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'
import {
  fillStringForm,
  openAddStringDialog,
  openDemoStrings,
  saveStringForm,
  searchStrings,
  togglePublishSwitch,
} from '../helpers/strings'

test.describe.configure({ mode: 'serial' })

const publicKey = `e2e_unpublish_${Date.now()}`
const rowKey = `e2e_unpublish_row_${Date.now()}`

test.beforeAll(() => {
  resetDemoDatabase()
})

function unpublishConfirm(page: Page) {
  return page.getByRole('alertdialog').filter({ hasText: 'Unpublish' })
}

test('batch unpublish cancel is no-write; confirm moves to draft with toast', async ({ page }) => {
  await openDemoStrings(page)
  await openAddStringDialog(page)
  await fillStringForm(page, { key: publicKey, source: 'Published for unpublish', published: true })
  await saveStringForm(page, 'create')
  await searchStrings(page, publicKey)

  const row = page.getByRole('row').filter({ hasText: publicKey }).first()
  await expect(row.getByRole('switch', { name: 'Public' })).toBeVisible()

  let unpublishPosts = 0
  page.on('request', (request) => {
    if (request.method() !== 'POST' || !request.url().includes('/strings/batch')) return
    if (request.postData()?.includes('"unpublish"')) unpublishPosts += 1
  })

  await row.getByRole('checkbox', { name: 'Select row' }).click()
  const toolbar = page.getByRole('toolbar', { name: 'Batch actions' })
  await toolbar.getByRole('button', { name: 'Unpublish' }).click()

  const dialog = unpublishConfirm(page)
  await expect(dialog.getByRole('heading', { name: 'Unpublish this string?' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  await expect(row.getByRole('switch', { name: 'Public' })).toBeVisible()
  expect(unpublishPosts).toBe(0)

  await toolbar.getByRole('button', { name: 'Unpublish' }).click()
  await dialog.getByRole('button', { name: 'Unpublish' }).click()
  await expect(row.getByRole('switch', { name: 'Draft' })).toBeVisible()
  await expect(page.getByText('Unpublished 1 string')).toBeVisible()
  expect(unpublishPosts).toBe(1)
})

test('row unpublish cancel is no-write; confirm shows success toast', async ({ page }) => {
  await openDemoStrings(page)
  await openAddStringDialog(page)
  await fillStringForm(page, { key: rowKey, source: 'Published for row unpublish', published: true })
  await saveStringForm(page, 'create')
  await searchStrings(page, rowKey)

  const row = page.getByRole('row').filter({ hasText: rowKey }).first()
  await expect(row.getByRole('switch', { name: 'Public' })).toBeVisible()

  let unpublishPosts = 0
  page.on('request', (request) => {
    if (request.method() !== 'POST' || !request.url().includes('/strings/batch')) return
    if (request.postData()?.includes('"unpublish"')) unpublishPosts += 1
  })

  await togglePublishSwitch(page, rowKey, false)
  const dialog = unpublishConfirm(page)
  await expect(dialog.getByRole('heading', { name: 'Unpublish this string?' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
  await expect(row.getByRole('switch', { name: 'Public' })).toBeVisible()
  expect(unpublishPosts).toBe(0)

  await togglePublishSwitch(page, rowKey, false)
  await dialog.getByRole('button', { name: 'Unpublish' }).click()
  await expect(row.getByRole('switch', { name: 'Draft' })).toBeVisible()
  await expect(page.getByText('Unpublished 1 string')).toBeVisible()
  expect(unpublishPosts).toBe(1)
})
