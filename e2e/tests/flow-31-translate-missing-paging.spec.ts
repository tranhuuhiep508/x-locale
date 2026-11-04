import { expect, test, type Page } from '../fixtures'
import { importStringsViaApi, publishStringsViaApi } from '../helpers/api'

test.use({ viewport: { width: 1280, height: 900 } })

async function setupProject(page: Page) {
  await page.goto('/')
  const response = await page.request.post('/api/projects', {
    data: { name: `Missing pages ${Date.now()}`, base_language: 'vi', target_languages: ['en'] },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const project = (await response.json()) as { id: string; slug: string }
  await page.goto(`/projects/${project.slug}/strings`)
  return project
}

async function createPublished(
  page: Page,
  projectId: string,
  key: string,
  source: string,
  translation: string,
) {
  const response = await page.request.post(`/api/projects/${projectId}/strings`, {
    data: { key, source_text: source, translations: { en: translation } },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const created = (await response.json()) as { id: string }
  await publishStringsViaApi(page, projectId, [created.id])
}

function lightness(color: string): number {
  const oklch = color.match(/oklch\(\s*([\d.]+)/)
  if (oklch) return Number(oklch[1])
  const channels = color.match(/\d+(\.\d+)?/g)?.slice(0, 3).map(Number) ?? []
  if (channels.length < 3) return 1
  const [red, green, blue] = channels
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
}

test('exact filter resets on the next page, and an empty page says so', async ({ page }) => {
  const project = await setupProject(page)
  const source = 'Shared hello for the missing queue'
  await createPublished(page, project.id, 'tm_page_origin', source, 'Published hello')
  const strings: Record<string, string> = {}
  for (let index = 0; index < 50; index += 1) {
    strings[`tm_page_a_${String(index).padStart(2, '0')}`] = source
  }
  for (let index = 0; index < 5; index += 1) {
    strings[`tm_page_b_${String(index).padStart(2, '0')}`] = `Unique hello ${index}`
  }
  await importStringsViaApi(page, project.id, strings)

  await page.getByRole('button', { name: 'Translate missing' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Missing Translations' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Use 50 exact matches on this page' })).toBeVisible()
  await expect(dialog.getByText('on this page', { exact: true })).toBeVisible()

  await dialog.getByRole('radio', { name: 'Exact 50' }).click()
  await expect(dialog.getByText('Showing 50 of 50 on this page')).toBeVisible()
  await expect(dialog.getByText('tm_page_b_00')).toBeHidden()

  const nextResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().includes('/translate/missing'),
  )
  await dialog.getByRole('button', { name: 'Next page' }).click()
  expect((await nextResponse).ok()).toBeTruthy()
  await expect(dialog.getByRole('radio', { name: 'All 5' })).toBeChecked()
  await expect(dialog.getByText('tm_page_b_00')).toBeVisible()
  await expect(dialog.getByText('tm_page_a_00')).toBeHidden()

  await dialog.getByRole('radio', { name: 'Exact 0' }).click()
  await expect(dialog.getByText('No exact matches on this page')).toBeVisible()
  await expect(dialog.getByRole('radio', { name: 'Exact 0' })).toBeChecked()
  await expect(dialog.getByText('Showing 0 of 5 on this page')).toBeVisible()
})

test('next stays put while exact matches on this page are unapplied', async ({ page }) => {
  const project = await setupProject(page)
  const source = 'Shared hello for the page guard'
  await createPublished(page, project.id, 'tm_guard_origin', source, 'Published guard')
  const strings: Record<string, string> = {}
  for (let index = 0; index < 51; index += 1) strings[`tm_guard_${String(index).padStart(2, '0')}`] = source
  await importStringsViaApi(page, project.id, strings)

  await page.getByRole('button', { name: 'Translate missing' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Use 50 exact matches on this page' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Use 50 exact matches on this page' }).click()
  const next = dialog.getByRole('button', { name: 'Next page' })
  await expect(next).toHaveAttribute('aria-disabled', 'true')
  expect(await next.evaluate((element) => (element as HTMLButtonElement).disabled)).toBe(false)
  await next.focus()
  await expect(page.getByRole('tooltip')).toHaveText("Apply or undo this page's changes first")

  let paged = false
  const mark = (request: { url: () => string; method: () => string }) => {
    if (request.method() === 'POST' && request.url().includes('/translate/missing')) paged = true
  }
  page.on('request', mark)
  await next.click({ force: true })
  await expect(dialog.getByText('Skipped · using match').first()).toBeVisible()
  await expect(dialog.getByText(/1–50 of 51/)).toBeVisible()
  expect(paged).toBe(false)
  page.off('request', mark)
})

test('exact filter falls back to all after this page no longer has matches', async ({ page }) => {
  const project = await setupProject(page)
  const source = 'Shared hello that gets applied'
  await createPublished(page, project.id, 'tm_apply_origin', source, 'Published apply')
  const strings: Record<string, string> = {}
  for (let index = 0; index < 50; index += 1) {
    strings[`tm_apply_a_${String(index).padStart(2, '0')}`] = source
  }
  strings.tm_apply_b_00 = 'Unique hello after apply'
  await importStringsViaApi(page, project.id, strings)

  await page.getByRole('button', { name: 'Translate missing' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('radio', { name: 'Exact 50' }).click()
  await dialog.getByRole('button', { name: 'Use 50 exact matches on this page' }).click()
  const reload = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().includes('/translate/missing'),
  )
  await dialog.getByRole('button', { name: 'Apply 50 translations' }).click()
  expect((await reload).ok()).toBeTruthy()
  await expect(dialog.getByRole('radio', { name: 'All 1' })).toBeChecked()
  await expect(dialog.getByText('tm_apply_b_00')).toBeVisible()
  await expect(dialog.getByText('No exact matches on this page')).toBeHidden()
})

test('generated translations block the next page until they are discarded', async ({ page }) => {
  const project = await setupProject(page)
  const strings: Record<string, string> = {}
  for (let index = 0; index < 55; index += 1) {
    strings[`tm_gen_${String(index).padStart(2, '0')}`] = `Generate me ${index}`
  }
  await importStringsViaApi(page, project.id, strings)

  await page.getByRole('button', { name: 'Translate missing' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Translate 50 cells' }).click()
  await expect(dialog.getByRole('heading', { name: 'Review Translations' })).toBeVisible()
  const next = dialog.getByRole('button', { name: 'Next page' })
  await expect(next).toHaveAttribute('aria-disabled', 'true')
  await next.focus()
  await expect(page.getByRole('tooltip')).toHaveText("Apply or undo this page's changes first")

  let paged = false
  const mark = (request: { url: () => string; method: () => string }) => {
    if (request.method() === 'POST' && request.url().includes('/translate/missing')) paged = true
  }
  page.on('request', mark)
  await next.click({ force: true })
  await expect(dialog.getByRole('heading', { name: 'Review Translations' })).toBeVisible()
  expect(paged).toBe(false)
  page.off('request', mark)

  await dialog.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'Translate missing' }).click()
  const reopened = page.getByRole('dialog')
  await expect(reopened.getByRole('heading', { name: 'Missing Translations' })).toBeVisible()
  const nextAgain = reopened.getByRole('button', { name: 'Next page' })
  await expect(nextAgain).not.toHaveAttribute('aria-disabled', 'true')
  const response = page.waitForResponse(
    (result) => result.request().method() === 'POST' && result.url().includes('/translate/missing'),
  )
  await nextAgain.click()
  expect((await response).ok()).toBeTruthy()
  await expect(reopened.getByText('tm_gen_50')).toBeVisible()
})

test('applying generated translations unlocks the next page', async ({ page }) => {
  const project = await setupProject(page)
  const strings: Record<string, string> = {}
  for (let index = 0; index < 101; index += 1) {
    strings[`tm_applied_${String(index).padStart(3, '0')}`] = `Apply me ${index}`
  }
  await importStringsViaApi(page, project.id, strings)

  await page.getByRole('button', { name: 'Translate missing' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Translate 50 cells' }).click()
  await expect(dialog.getByRole('heading', { name: 'Review Translations' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Next page' })).toHaveAttribute('aria-disabled', 'true')

  const reload = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/translate/missing'),
  )
  await dialog.getByRole('button', { name: 'Apply 50 translations' }).click()
  expect((await reload).ok()).toBeTruthy()
  await expect(dialog.getByRole('heading', { name: 'Missing Translations' })).toBeVisible()
  const next = dialog.getByRole('button', { name: 'Next page' })
  await expect(next).not.toHaveAttribute('aria-disabled', 'true')
  const pageTwo = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().includes('/translate/missing'),
  )
  await next.click()
  expect((await pageTwo).ok()).toBeTruthy()
  await expect(dialog.getByText('tm_applied_100')).toBeVisible()
})

test('description stacks under the source text on a phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })
  const project = await setupProject(page)
  const created = await page.request.post(`/api/projects/${project.id}/strings`, {
    data: { key: 'tm_narrow', source_text: 'A long source sentence that must stay readable on a phone' },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  await page.getByRole('button', { name: 'Translate missing' }).click()
  const dialog = page.getByRole('dialog')
  const source = dialog.getByText('A long source sentence that must stay readable on a phone')
  const description = dialog.getByLabel('Description')
  await expect(source).toBeVisible()
  const sourceBox = await source.boundingBox()
  const descriptionBox = await description.boundingBox()
  expect(sourceBox).toBeTruthy()
  expect(descriptionBox).toBeTruthy()
  expect(sourceBox!.width).toBeGreaterThan(120)
  expect(descriptionBox!.y).toBeGreaterThan(sourceBox!.y + sourceBox!.height - 1)
})

test('a used match stays on the public color in dark mode', async ({ page }) => {
  const project = await setupProject(page)
  const source = 'Dark mode hello'
  await createPublished(page, project.id, 'tm_dark_origin', source, 'Published dark')
  const missing = await page.request.post(`/api/projects/${project.id}/strings`, {
    data: { key: 'tm_dark_missing', source_text: source },
  })
  expect(missing.ok(), await missing.text()).toBeTruthy()

  await page.getByRole('button', { name: 'Translate missing' }).click()
  const dialog = page.getByRole('dialog')
  const row = () => dialog.locator('tr').filter({ hasText: 'Skipped · using match' })
  await dialog.getByRole('button', { name: 'Use match for en in tm_dark_missing' }).click()
  await expect(row()).toBeVisible()
  const light = await row().evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(lightness(light)).toBeGreaterThan(0.9)

  await dialog.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('radio', { name: 'Dark theme' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.getByRole('button', { name: 'Translate missing' }).click()
  await dialog.getByRole('button', { name: 'Use match for en in tm_dark_missing' }).click()
  const darkRow = await row().evaluate((element) => getComputedStyle(element).backgroundColor)
  const label = await dialog.getByText('Exact match', { exact: true }).evaluate((element) => getComputedStyle(element).color)
  expect(lightness(darkRow)).toBeLessThan(0.45)
  expect(lightness(label)).toBeGreaterThan(0.7)
  await expect(row()).toHaveClass(/bg-public/)
})
