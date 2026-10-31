import { test, expect } from '../fixtures'
import { resetDemoDatabase } from '../helpers/database'
import { projectIdFromUrl } from '../helpers/api'
import { openDemoStrings, openStringEditor, searchStrings } from '../helpers/strings'

test.describe.configure({ mode: 'serial' })

const key = `e2e_qa_price_${Date.now()}`
const source = 'Save {price, number}'
const changed = 'Save {price, number, percent}'
const grouped = 'Placeholder price changed from {price, number} to {price, number, percent}.'

test.beforeAll(() => {
  resetDemoDatabase()
})

test.use({ viewport: { width: 1280, height: 900 } })

test('review groups a placeholder style change and still allows apply', async ({ page }) => {
  await openDemoStrings(page)
  const projectId = projectIdFromUrl(page)
  const created = await page.request.post(`/api/projects/${projectId}/strings`, {
    data: { key, source_text: source },
  })
  expect(created.ok(), await created.text()).toBeTruthy()

  await searchStrings(page, key)
  await expect(page.getByRole('row').filter({ hasText: key })).toBeVisible()
  await page.getByRole('button', { name: 'Translate missing' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('li').filter({ hasText: key })).toHaveCount(1)
  await dialog.getByRole('button', { name: 'Translate', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Review Translations' })).toBeVisible()

  const row = dialog.locator('li').filter({ hasText: key })
  const english = row.getByLabel('en', { exact: true })
  await expect(english).toHaveValue(`[en] ${source}`)
  await expect(dialog.getByText('No QA issues').first()).toBeVisible()

  const qa = page.waitForResponse(
    (response) => response.url().includes('/translate/qa') && response.request().method() === 'POST',
  )
  await english.fill(changed)
  const response = await qa
  expect(response.ok(), await response.text()).toBeTruthy()
  const body = await response.json() as { issues: { code: string }[] }
  expect(body.issues.map((issue) => issue.code).sort()).toEqual(['placeholder_extra', 'placeholder_missing'])

  await row.getByRole('button', { name: /QA for en/ }).click()
  const popover = page.locator('[data-slot="popover-content"]')
  await expect(popover.getByText(grouped)).toBeVisible()
  await expect(popover.getByText('placeholder_changed')).toBeVisible()
  await expect(page.getByText(/Missing placeholder/)).toHaveCount(0)
  await expect(page.getByText(/Extra placeholder/)).toHaveCount(0)
  await expect(dialog.getByText('1 QA error. You can still apply.')).toBeVisible()
  await expect(dialog.getByRole('button', { name: /^Apply/ })).toBeEnabled()
  await page.screenshot({ path: '/opt/cursor/artifacts/qa-review-placeholder-changed.png' })

  await dialog.getByRole('button', { name: 'Discard' }).click()
  await expect(dialog).toBeHidden()
})

test('edit form groups a placeholder style change and still allows save', async ({ page }) => {
  await openStringEditor(page, key)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/It never blocks Save/)).toBeVisible()
  await expect(dialog.getByText('No QA issues')).toHaveCount(0)

  const qa = page.waitForResponse(
    (response) => response.url().includes('/translate/qa') && response.request().method() === 'POST',
  )
  await dialog.locator('#translation-en').fill(changed)
  const response = await qa
  expect(response.ok(), await response.text()).toBeTruthy()

  await dialog.getByRole('button', { name: /QA for en/ }).click()
  const popover = page.locator('[data-slot="popover-content"]')
  await expect(popover.getByText(grouped)).toBeVisible()
  await expect(popover.getByText('placeholder_changed')).toBeVisible()
  await expect(page.getByText(/Missing placeholder/)).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeEnabled()
  await expect(dialog.locator('#translation-en')).not.toHaveAttribute('aria-invalid')
  await page.screenshot({ path: '/opt/cursor/artifacts/qa-edit-placeholder-changed.png' })
})
