import { test, expect } from '../fixtures'
import { resetDemoDatabase } from '../helpers/database'
import { openDemoStrings, openAddStringDialog, fillStringForm, openStringEditor, setStatusFilter } from '../helpers/strings'
import { fetchStringByKey, projectIdFromUrl } from '../helpers/api'

test.beforeAll(() => resetDemoDatabase())

test('publishing preserves filters until the toast action reveals the saved row', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openDemoStrings(page)
  await setStatusFilter(page, 'Draft')
  await expect(page).toHaveURL(/[?&]status=draft(?:&|$)/)
  const originalUrl = page.url()
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
  const row = page.getByRole('row').filter({ hasText: key })
  await expect(page.getByRole('dialog', { name: 'Add string', exact: true })).toBeHidden()
  await expect(page.getByText('String saved and published', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(originalUrl)
  await expect(row).toHaveCount(0)
  await page.getByRole('button', { name: 'View changes', exact: true }).click()
  await expect(row).toBeFocused()
  expect(new URL(page.url()).searchParams.has('status')).toBe(false)
  expect((await fetchStringByKey(page, project, key)).published_source_text).toBe('Welcome')
  await row.getByText('Welcome', { exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit string', exact: true })
  await expect(dialog.getByLabel('Source text')).toHaveValue('Welcome')
  await dialog.getByLabel('Source text').fill('Good morning')
  await dialog.getByRole('button', { name: 'Save as draft' }).click()
  await expect(page.getByText('String saved as draft', { exact: true })).toBeVisible()
  await expect(dialog).toBeHidden()
  await page.locator('[data-sonner-toast]').filter({ hasText: 'String saved as draft' }).getByRole('button', { name: 'View changes' }).click()
  await expect(row).toBeFocused()
  expect((await fetchStringByKey(page, project, key)).published_source_text).toBe('Welcome')
  await row.getByText('Good morning', { exact: true }).click()
  await dialog.getByRole('button', { name: 'Publish changes' }).click()
  await expect(page.getByRole('region', { name: 'Content updates' })).toBeVisible()
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.locator('[data-sonner-toast]').filter({ hasText: 'String saved and published' }).getByRole('button', { name: 'View changes' }).click()
  await expect(row).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath('editor-saved-mobile.png') })
  expect((await fetchStringByKey(page, project, key)).published_source_text).toBe('Good morning')
})

test('draft creation preserves the catalog and its toast opens the exact saved row from Activity', async ({ page }) => {
  await openDemoStrings(page)
  const project = projectIdFromUrl(page)
  const key = `zz_compact_draft_${Date.now()}`
  const similar = await page.request.post(`/api/projects/${project}/strings`, {
    data: { key: `${key}_other`, source_text: 'Other draft' },
  })
  expect(similar.ok()).toBeTruthy()
  const originalUrl = page.url()
  await openAddStringDialog(page)
  await fillStringForm(page, { key, source: 'Draft content' })
  await page.getByRole('button', { name: 'Save as draft' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit string', exact: true })
  const row = page.getByRole('row').filter({ has: page.getByText(key, { exact: true }) })
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(page).toHaveURL(originalUrl)
  await page.getByRole('link', { name: 'Activity', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'View changes', exact: true }).click()
  await expect(row).toBeFocused()
  await expect(page.getByText(`${key}_other`, { exact: true })).toHaveCount(0)
  const first = await fetchStringByKey(page, project, key)
  expect(new URL(page.url()).searchParams.get('saved_string')).toBe(first.id)
  expect(first.status).toBe('draft')
  await row.click()
  await dialog.getByLabel('Source text').fill('Revised draft')
  const response = page.waitForResponse((res) => res.url().endsWith('/strings/editor-save'))
  await dialog.getByRole('button', { name: 'Save as draft' }).click()
  expect((await response).ok()).toBeTruthy()
  expect((await fetchStringByKey(page, project, key)).id).toBe(first.id)
  await expect(dialog).toBeHidden()
  const search = page.getByRole('textbox', { name: 'Search strings' })
  await search.focus()
  await page.getByRole('button', { name: 'View changes', exact: true }).press('Enter')
  await expect(row).toBeFocused()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible()
  await page.goForward()
  await expect(row).toBeVisible()
  const query = key.slice(0, -1)
  const searchResponse = Promise.withResolvers<void>()
  await page.route(
    (url) => url.pathname.endsWith('/strings') && url.searchParams.get('q') === query,
    async (route) => {
      await searchResponse.promise
      await route.continue()
    },
  )
  try {
    await search.fill(query)
    await expect(page.getByRole('status', { name: 'Loading strings' })).toBeVisible()
    await expect(row).toHaveCount(0)
  } finally {
    searchResponse.resolve()
  }
  await expect(page.getByText(`${key}_other`, { exact: true })).toBeVisible()
  await expect(search).toBeFocused()
})

test('a pending search does not carry into the published batch', async ({ page }) => {
  await openDemoStrings(page)
  const project = projectIdFromUrl(page)
  const key = `compact_batch_search_${Date.now()}`
  const response = await page.request.post(`/api/projects/${project}/strings`, {
    data: { key, source_text: 'Batch search source' },
  })
  expect(response.ok()).toBeTruthy()
  await page.goto(`/projects/${project}/strings?status=draft&sort=created_at&order=desc`)
  const row = page.getByRole('row').filter({ hasText: key })
  await row.getByRole('checkbox', { name: 'Select row' }).click()
  await page.getByRole('toolbar', { name: 'Batch actions' }).getByRole('button', { name: 'Publish', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(dialog).toBeHidden()
  const toast = page.getByRole('button', { name: 'View changes', exact: true })
  await expect(toast).toBeVisible()

  await page.clock.install()
  await page.clock.pauseAt(new Date(Date.now() + 100))
  const search = page.getByRole('textbox', { name: 'Search strings' })
  await search.fill('key_outside_the_batch')
  await toast.evaluate((button: HTMLButtonElement) => button.click())
  await expect(page).toHaveURL(/batch_id=/)
  await page.clock.runFor(500)
  await page.clock.resume()

  await expect(search).toHaveValue('')
  await expect(page).not.toHaveURL(/[?&]q=/)
  await expect(row).toBeVisible()
})

for (const destination of ['Activity', 'another project'] as const) {
  test(`a pending save still shows View changes after leaving the editor for ${destination}`, async ({ page }) => {
    await openDemoStrings(page)
    const name = `Pending save project ${Date.now()}`
    if (destination === 'Activity') {
      await page.getByRole('link', { name: 'Activity', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Activity', exact: true })).toBeVisible()
    } else {
      const project = await page.request.post('/api/projects', {
        data: { name, base_language: 'en', target_languages: ['fr'], layout: 'flat' },
      })
      expect(project.status()).toBe(201)
      await page.goto('/')
      await page.getByRole('link', { name }).click()
      await expect(page.getByRole('button', { name: `Switch project, current: ${name}` })).toBeVisible()
    }
    const previousUrl = page.url()
    if (destination === 'Activity') {
      await page.getByRole('link', { name: 'Strings', exact: true }).click()
    } else {
      await page.getByRole('button', { name: /Switch project, current:/ }).click()
      await page.getByRole('menuitem', { name: /Demo App/ }).click()
    }
    await expect(page).toHaveURL(/\/projects\/demo-app\/strings/)
    const key = `compact_pending_${Date.now()}`
    await openAddStringDialog(page)
    await fillStringForm(page, { key, source: 'Pending save' })

    let releaseResponse!: () => void
    const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve })
    await page.route('**/strings/editor-save', async (route) => {
      const response = await route.fetch()
      await responseGate
      await route.fulfill({ response })
    })
    const request = page.waitForRequest('**/strings/editor-save')
    try {
      await page.getByRole('button', { name: 'Save as draft', exact: true }).click()
      await request
      await page.goBack()
      await expect(page).toHaveURL(previousUrl)
      await expect(destination === 'Activity'
        ? page.getByRole('heading', { name: 'Activity', exact: true })
        : page.getByRole('button', { name: `Switch project, current: ${name}`, includeHidden: true })).toBeVisible()
    } finally {
      releaseResponse()
    }
    await expect(page.getByText('String saved as draft', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'View changes', exact: true }).click()
    await expect(page).toHaveURL(/\/projects\/demo-app\/strings\?.*saved_string=/)
    await expect(page.getByRole('row').filter({ hasText: key })).toBeFocused()
  })
}

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
  await expect(page.getByRole('dialog', { name: 'Edit string', exact: true })).toBeHidden()
  const saved = await (await page.request.get(`/api/projects/${project}/strings/${entry.id}`)).json()
  expect(saved.translations.find((t: { locale: string }) => t.locale === 'en').published_value).toBe('My English')
  expect(saved.translations.find((t: { locale: string }) => t.locale === 'ja').published_value).toBe('Competing Japanese')
})
