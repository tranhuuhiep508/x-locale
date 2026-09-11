import { expect, type Page } from '@playwright/test'

export async function openDemoStrings(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await page.getByRole('link', { name: 'Demo App' }).click()
  await expect(page).toHaveURL(/\/projects\/[^/]+\/strings/)
}

export async function searchStrings(page: Page, query: string) {
  await ensureStringsPage(page)
  const search = page.getByRole('textbox', { name: 'Search strings' })
  await search.fill(query)
  await expect
    .poll(async () => {
      const url = new URL(page.url())
      return url.searchParams.get('q') ?? ''
    })
    .toBe(query)
}

export async function clearStringSearch(page: Page) {
  const clear = page.getByRole('button', { name: 'Clear search' })
  if (await clear.isVisible()) {
    await clear.click()
  } else {
    await page.getByRole('textbox', { name: 'Search strings' }).fill('')
  }
}

export async function openAddStringDialog(page: Page) {
  await page.getByRole('button', { name: 'Add string' }).click()
  await expect(page.getByRole('heading', { name: 'Add string' })).toBeVisible()
}

export async function openAddManyDialog(page: Page) {
  await page.getByRole('button', { name: 'Add many' }).click()
  await expect(page.getByRole('heading', { name: 'Add many' })).toBeVisible()
}

export async function openStringEditor(page: Page, key: string) {
  await searchStrings(page, key)
  const row = page.getByRole('row').filter({ hasText: key }).first()
  await expect(row).toBeVisible()
  await row.click()
  await expect(page.getByRole('heading', { name: 'Edit string' })).toBeVisible()
}

export async function openRowActions(page: Page, key: string) {
  const row = page.getByRole('row').filter({ hasText: key }).first()
  await row.getByRole('button', { name: 'Row actions' }).click()
}

export async function setStatusFilter(page: Page, status: 'All' | 'Draft' | 'Public' | 'Needs publish' | 'Deleted') {
  await page.getByRole('combobox', { name: 'Status' }).click()
  await page.getByRole('option', { name: status }).click()
}

export async function dismissBlockingDialogs(page: Page) {
  const publish = page.getByRole('dialog').filter({ hasText: 'Publish preview' })
  if (await publish.isVisible().catch(() => false)) {
    await publish.getByRole('button', { name: 'Cancel' }).click()
  }
  const editor = page.getByRole('heading', { name: 'Edit string' })
  if (await editor.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Cancel' }).click()
  }
}

export async function ensureStringsPage(page: Page) {
  await dismissBlockingDialogs(page)
  const addButton = page.getByRole('button', { name: 'Add string' })
  if (await addButton.isVisible().catch(() => false)) {
    return
  }
  const projectMatch = page.url().match(/\/projects\/([^/]+)/)
  if (projectMatch) {
    await page.goto(`/projects/${projectMatch[1]}/strings`)
  } else {
    await openDemoStrings(page)
  }
  await expect(page.getByRole('button', { name: 'Add string' })).toBeVisible()
}

export async function createInlineModule(page: Page, slug: string, name: string) {
  const addDialog = page.getByRole('dialog').filter({ hasText: 'Add string' })
  await addDialog.getByRole('button', { name: 'New' }).first().click()
  const popover = page.getByRole('dialog').filter({ hasText: 'New module' })
  await expect(popover).toBeVisible()
  await popover.getByLabel('Slug').fill(slug)
  await popover.getByLabel('Name').fill(name)
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/modules') &&
        response.ok(),
    ),
    popover.getByRole('button', { name: 'Create', exact: true }).click(),
  ])
  await expect(popover).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Add string' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Module' })).toContainText(name)
}

export async function createInlineTag(page: Page, name: string) {
  const addDialog = page.getByRole('dialog').filter({ hasText: 'Add string' })
  await addDialog.getByRole('button', { name: 'New' }).last().click()
  const popover = page.getByRole('dialog').filter({ hasText: 'New tag' })
  await expect(popover).toBeVisible()
  await popover.getByLabel('Name').fill(name)
  await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/tags') &&
        response.ok(),
    ),
    popover.getByRole('button', { name: 'Create', exact: true }).click(),
  ])
  await expect(popover).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Add string' })).toBeVisible()
  await expect(addDialog.locator('[data-state="on"]', { hasText: name })).toBeVisible()
}

export async function fillStringForm(
  page: Page,
  values: { key: string; source: string; published?: boolean },
) {
  await page.getByLabel('Key').fill(values.key)
  await page.getByLabel('Source text').fill(values.source)
  if (values.published !== undefined) {
    const published = page.getByRole('switch', { name: 'Published' })
    const checked = await published.isChecked()
    if (checked !== values.published) {
      await published.click()
    }
  }
}

export async function saveStringForm(page: Page, mode: 'create' | 'edit' = 'create') {
  const button = page.getByRole('button', {
    name: mode === 'create' ? 'Create string' : 'Save changes',
  })
  await expect(button).toBeEnabled()
  await button.click()
}

export async function togglePublishSwitch(page: Page, key: string, on: boolean) {
  const row = page.getByRole('row').filter({ hasText: key }).first()
  const switchEl = row.getByRole('switch', { name: on ? 'Draft' : 'Public' })
  await switchEl.click()
}

export async function expectPublishDialog(page: Page) {
  await expect(page.getByRole('heading', { name: 'Publish preview' })).toBeVisible()
}

export async function confirmPublish(page: Page) {
  const dialog = page.getByRole('dialog').filter({ hasText: 'Publish preview' })
  await dialog.getByRole('button', { name: 'Publish' }).click()
}

export async function cancelPublish(page: Page) {
  const dialog = page.getByRole('dialog').filter({ hasText: 'Publish preview' })
  await dialog.getByRole('button', { name: 'Cancel' }).click()
}
