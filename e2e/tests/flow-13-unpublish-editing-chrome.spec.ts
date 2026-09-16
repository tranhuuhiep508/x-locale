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

type ChromeKind = 'none' | 'editing' | 'was_live'

async function expectWorkingCopyChrome(page: Page, key: string, kind: ChromeKind) {
  const row = rowFor(page, key)
  const editingBadge = row.getByText('Editing', { exact: true })
  const wasLiveBadge = row.getByText('Was live · unpublished edits', { exact: true })
  const compareButton = row.getByRole('button', {
    name: 'Compare published and working values',
  })
  if (kind === 'editing') {
    await expect(editingBadge).toBeVisible()
    await expect(wasLiveBadge).toHaveCount(0)
    await expect(compareButton).toBeVisible()
  } else if (kind === 'was_live') {
    await expect(wasLiveBadge).toBeVisible()
    await expect(editingBadge).toHaveCount(0)
    await expect(compareButton).toBeVisible()
  } else {
    await expect(editingBadge).toHaveCount(0)
    await expect(wasLiveBadge).toHaveCount(0)
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
  await expectWorkingCopyChrome(page, publishedKey, 'none')

  await editSource(page, publishedKey, 'Working copy ahead')
  await searchStrings(page, publishedKey)
  await expectWorkingCopyChrome(page, publishedKey, 'editing')
})

test('after unpublish, further edits show Was live working-copy chrome', async ({ page }) => {
  await searchStrings(page, publishedKey)
  const row = rowFor(page, publishedKey)
  await row.getByRole('switch', { name: 'Public' }).click()
  await expect(row.getByRole('switch', { name: 'Draft' })).toBeVisible()
  await expectWorkingCopyChrome(page, publishedKey, 'was_live')

  await editSource(page, publishedKey, 'Still snapshot after unpublish')
  await searchStrings(page, publishedKey)
  await expect(row.getByRole('switch', { name: 'Draft' })).toBeVisible()
  await expectWorkingCopyChrome(page, publishedKey, 'was_live')
})

test('never-published draft edits do not show Editing chrome', async ({ page }) => {
  await openDemoStrings(page)
  await openAddStringDialog(page)
  await fillStringForm(page, { key: draftOnlyKey, source: 'Draft original' })
  await saveStringForm(page, 'create')
  await searchStrings(page, draftOnlyKey)

  const row = rowFor(page, draftOnlyKey)
  await expect(row.getByRole('switch', { name: 'Draft' })).toBeVisible()
  await expectWorkingCopyChrome(page, draftOnlyKey, 'none')

  await editSource(page, draftOnlyKey, 'Draft edited')
  await searchStrings(page, draftOnlyKey)
  await expect(row.getByRole('switch', { name: 'Draft' })).toBeVisible()
  await expectWorkingCopyChrome(page, draftOnlyKey, 'none')
})
