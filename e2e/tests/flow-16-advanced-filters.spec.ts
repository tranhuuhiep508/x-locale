import { test, expect, type Page } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'

test.beforeAll(() => {
  resetDemoDatabase()
})

async function seedFilterProject(page: Page) {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  const projectResponse = await page.request.post('/api/projects', {
    data: {
      name: `Filter E2E ${Date.now()}`,
      base_language: 'vi',
      target_languages: ['en', 'fr'],
      layout: 'modular',
    },
  })
  expect(projectResponse.status()).toBe(201)
  const project = await projectResponse.json()
  const base = `/api/projects/${project.id}`
  const moduleResponse = await page.request.post(`${base}/modules`, {
    data: { slug: 'common', name: 'Common' },
  })
  expect(moduleResponse.status()).toBe(201)
  const module = await moduleResponse.json()
  const tagResponse = await page.request.post(`${base}/tags`, {
    data: { name: 'Featured', color: '#123456' },
  })
  expect(tagResponse.status()).toBe(201)
  const tag = await tagResponse.json()
  const entries: Record<string, { id: string }> = {}
  const fixtures = [
    { key: 'unassigned', translations: { en: 'Ready', fr: '   ' } },
    { key: 'empty', translations: { en: '   ', fr: '' } },
    {
      key: 'assigned',
      translations: { en: 'Ready', fr: 'Prêt' },
      module_id: module.id,
      tag_ids: [tag.id],
      status: 'public',
    },
    { key: 'tagged', translations: { en: 'Ready', fr: '' }, tag_ids: [tag.id] },
  ]
  for (const fixture of fixtures) {
    const response = await page.request.post(`${base}/strings`, {
      data: { ...fixture, source_text: fixture.key },
    })
    expect(response.status()).toBe(201)
    entries[fixture.key] = await response.json()
  }
  const stringsUrl = `/projects/${project.slug}/strings?page_size=50`
  await page.goto(stringsUrl)
  await expect(stringRow(page, 'unassigned')).toBeVisible()
  return { project, module, tag, entries, stringsUrl }
}

function stringRow(page: Page, key: string) {
  return page.getByRole('row').filter({ has: page.getByText(key, { exact: true }) })
}

async function chooseSelect(page: Page, label: string, option: string, index = 0) {
  await page.getByRole('combobox', { name: label, exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).nth(index).click()
}

async function chooseOrganization(page: Page, label: string, option: string) {
  await page.getByRole('button', { name: label, exact: true }).click()
  await page
    .getByRole('listbox', { name: label, exact: true })
    .getByRole('option', { name: option, exact: true })
    .click()
}

async function expectParam(page: Page, name: string, value: string | null) {
  await expect.poll(() => new URL(page.url()).searchParams.get(name)).toBe(value)
}

test('combined advanced filters survive reload and Clear retains page size', async ({ page }) => {
  await seedFilterProject(page)
  await chooseSelect(page, 'Status', 'Never published')
  await chooseOrganization(page, 'Module', 'Unassigned')
  await chooseOrganization(page, 'Tag', 'Untagged')
  await chooseSelect(page, 'Translation', 'en', 1)
  await chooseSelect(page, 'Updated', 'Last 7 days')

  for (const [name, value] of Object.entries({
    never_published: 'true',
    unassigned_module: 'true',
    untagged: 'true',
    complete_locale: 'en',
    updated_within_days: '7',
    page_size: '50',
  })) {
    await expectParam(page, name, value)
  }
  await expect(stringRow(page, 'unassigned')).toBeVisible()
  for (const key of ['empty', 'assigned', 'tagged']) {
    await expect(stringRow(page, key)).toHaveCount(0)
  }

  const filteredUrl = page.url()
  await page.reload()
  await expect(page).toHaveURL(filteredUrl)
  await expect(page.getByRole('combobox', { name: 'Status', exact: true })).toContainText('Never published')
  await expect(page.getByRole('button', { name: 'Module', exact: true })).toContainText('Unassigned')
  await expect(page.getByRole('button', { name: 'Tag', exact: true })).toContainText('Untagged')
  await expect(page.getByRole('combobox', { name: 'Translation', exact: true })).toContainText('en')
  await expect(page.getByRole('combobox', { name: 'Updated', exact: true })).toContainText('Last 7 days')
  await expect(stringRow(page, 'unassigned')).toBeVisible()

  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  for (const name of [
    'never_published', 'unassigned_module', 'untagged', 'complete_locale', 'updated_within_days',
  ]) {
    await expectParam(page, name, null)
  }
  await expectParam(page, 'page_size', '50')
  await expectParam(page, 'page', '1')
  for (const key of ['unassigned', 'empty', 'assigned', 'tagged']) {
    await expect(stringRow(page, key)).toBeVisible()
  }
  await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeHidden()
})

test('switching exclusive filter choices removes their previous URL fields', async ({ page }) => {
  const { module, tag } = await seedFilterProject(page)
  const filterErrors: string[] = []
  page.on('response', (response) => {
    if (response.url().includes('/strings') && response.status() >= 400) {
      filterErrors.push(`${response.status()} ${response.url()}`)
    }
  })

  await chooseOrganization(page, 'Module', 'Unassigned')
  await expectParam(page, 'unassigned_module', 'true')
  await chooseOrganization(page, 'Module', 'Common')
  await expectParam(page, 'module', module.id)
  await expectParam(page, 'unassigned_module', null)

  await chooseOrganization(page, 'Tag', 'Untagged')
  await expectParam(page, 'untagged', 'true')
  await chooseOrganization(page, 'Tag', 'Featured')
  await expectParam(page, 'tag', tag.id)
  await expectParam(page, 'untagged', null)

  await chooseSelect(page, 'Translation', 'Missing any target')
  await expectParam(page, 'missing_any', 'true')
  await chooseSelect(page, 'Translation', 'en')
  await expectParam(page, 'missing_locale', 'en')
  await expectParam(page, 'missing_any', null)
  await chooseSelect(page, 'Translation', 'en', 1)
  await expectParam(page, 'complete_locale', 'en')
  await expectParam(page, 'missing_locale', null)
  await expectParam(page, 'missing_any', null)

  await chooseSelect(page, 'Status', 'Never published')
  await expectParam(page, 'never_published', 'true')
  await chooseSelect(page, 'Status', 'Pending deletion')
  await expectParam(page, 'pending_delete', 'true')
  await expectParam(page, 'never_published', null)
  await chooseSelect(page, 'Status', 'Public')
  await expectParam(page, 'status', 'public')
  await expectParam(page, 'pending_delete', null)

  await chooseSelect(page, 'Updated', 'Last 30 days')
  await expectParam(page, 'updated_within_days', '30')
  await expect(stringRow(page, 'assigned')).toBeVisible()
  expect(filterErrors).toEqual([])
})

test('filtered publish preview contains the same strings as the grid', async ({ page }) => {
  const { project, entries, stringsUrl } = await seedFilterProject(page)
  const response = await page.request.patch(
    `/api/projects/${project.id}/strings/${entries.assigned.id}`,
    { data: { source_text: 'Changed assigned source' } },
  )
  expect(response.ok()).toBeTruthy()
  await page.goto(stringsUrl)
  await chooseSelect(page, 'Status', 'Needs publish')
  await chooseOrganization(page, 'Module', 'Common')
  await chooseOrganization(page, 'Tag', 'Featured')
  await chooseSelect(page, 'Translation', 'en', 1)
  await chooseSelect(page, 'Updated', 'Last 7 days')
  await expect(stringRow(page, 'assigned')).toBeVisible()
  await expect(stringRow(page, 'unassigned')).toHaveCount(0)

  const previewResponse = page.waitForResponse(
    (res) => res.request().method() === 'POST' && res.url().endsWith('/strings/publish-preview'),
  )
  await page.getByRole('button', { name: 'Review publish changes' }).click()
  const preview = await previewResponse
  expect(preview.ok()).toBeTruthy()
  expect(preview.request().postDataJSON().filter).toMatchObject({
    has_unpublished_changes: true,
    complete_locale: 'en',
    updated_within_days: 7,
  })
  expect((await preview.json()).items.map((item: { id: string }) => item.id)).toEqual([entries.assigned.id])
  await expect(page.getByRole('heading', { name: 'Publish preview' })).toBeVisible()
  await page.getByRole('dialog').filter({ hasText: 'Publish preview' }).getByRole('button', { name: 'Cancel' }).click()
})
