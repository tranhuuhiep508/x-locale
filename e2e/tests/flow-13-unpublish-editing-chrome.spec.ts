import { test, expect, type Page } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'
import {
  fillStringForm,
  openAddStringDialog,
  openDemoStrings,
  openStringEditor,
  saveStringForm,
  searchStrings,
} from '../helpers/strings'

test.describe.configure({ mode: 'serial' })

const suffix = Date.now()
const publishedKey = `e2e_editing_chrome_pub_${suffix}`
const draftOnlyKey = `e2e_editing_chrome_draft_${suffix}`

test.beforeAll(() => {
  resetDemoDatabase()
})

function rowFor(page: Page, key: string) {
  return page.getByRole('row').filter({ hasText: key }).first()
}

async function editSource(page: Page, key: string, source: string) {
  await openStringEditor(page, key)
  await page.getByLabel('Source text').fill(source)
  await saveStringForm(page, 'edit')
  await expect(page.getByRole('heading', { name: 'Edit string' })).toBeHidden()
}

async function expectLiveEditingChrome(page: Page, key: string, visible: boolean) {
  const row = rowFor(page, key)
  const editingBadge = row.getByText('Editing', { exact: true })
  const compareButton = row.getByRole('button', {
    name: 'Compare published and working values',
  })
  if (visible) {
    await expect(editingBadge).toBeVisible()
    await expect(compareButton).toBeVisible()
  } else {
    await expect(editingBadge).toHaveCount(0)
    await expect(compareButton).toHaveCount(0)
  }
}

test('published string with working copy edits shows Editing chrome', async ({ page }) => {
  await openDemoStrings(page)
  await openAddStringDialog(page)
  await fillStringForm(page, {
    key: publishedKey,
    source: 'Live baseline',
    published: true,
  })
  await saveStringForm(page, 'create')
  await searchStrings(page, publishedKey)

  const row = rowFor(page, publishedKey)
  await expect(row.getByRole('switch', { name: 'Public' })).toBeVisible()
  await expectLiveEditingChrome(page, publishedKey, false)

  await editSource(page, publishedKey, 'Working copy ahead')
  await searchStrings(page, publishedKey)
  await expectLiveEditingChrome(page, publishedKey, true)
})

test('after unpublish, further edits stay draft chrome without Editing', async ({ page }) => {
  await searchStrings(page, publishedKey)
  const row = rowFor(page, publishedKey)
  await row.getByRole('switch', { name: 'Public' }).click()
  await expect(row.getByRole('switch', { name: 'Draft' })).toBeVisible()
  await expectLiveEditingChrome(page, publishedKey, false)

  await editSource(page, publishedKey, 'Still draft after unpublish')
  await searchStrings(page, publishedKey)
  await expect(row.getByRole('switch', { name: 'Draft' })).toBeVisible()
  await expectLiveEditingChrome(page, publishedKey, false)
})

test('never-published draft edits do not show Editing chrome', async ({ page }) => {
  await openDemoStrings(page)
  await openAddStringDialog(page)
  await fillStringForm(page, { key: draftOnlyKey, source: 'Draft original' })
  await saveStringForm(page, 'create')
  await searchStrings(page, draftOnlyKey)

  const row = rowFor(page, draftOnlyKey)
  await expect(row.getByRole('switch', { name: 'Draft' })).toBeVisible()
  await expectLiveEditingChrome(page, draftOnlyKey, false)

  await editSource(page, draftOnlyKey, 'Draft edited')
  await searchStrings(page, draftOnlyKey)
  await expect(row.getByRole('switch', { name: 'Draft' })).toBeVisible()
  await expectLiveEditingChrome(page, draftOnlyKey, false)
})
