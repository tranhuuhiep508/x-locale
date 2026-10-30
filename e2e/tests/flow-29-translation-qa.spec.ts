import { expect, test } from '../fixtures'
import { resetDemoDatabase } from '../helpers/database'
import { publishStringsViaApi } from '../helpers/api'
import { openDemoStrings, openStringEditor } from '../helpers/strings'

test.beforeAll(() => resetDemoDatabase())

test('QA flags generated structure, refreshes manual edits, and never gates Apply or Publish', async ({ page }) => {
  await openDemoStrings(page)
  const projectResponse = await page.request.post('/api/projects', {
    data: { name: `QA ${Date.now()}`, base_language: 'vi', target_languages: ['en'] },
  })
  expect(projectResponse.ok()).toBeTruthy()
  const project = await projectResponse.json()
  const root = `/api/projects/${project.id}`
  const entries = []
  for (const key of ['qa.corrected', 'qa.advisory']) {
    const response = await page.request.post(`${root}/strings`, {
      data: { key, source_text: 'Hello {name}' },
    })
    expect(response.ok()).toBeTruthy()
    entries.push(await response.json())
  }

  // Replace stub model output, but obtain diagnostics from the real QA endpoint.
  await page.route('**/translate/proposals', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    for (const item of body.items) {
      item.translations = { en: 'Hello' }
      item.scores = { en: 99 }
      const qa = await page.request.post(`${root}/translate/qa`, {
        data: { source_text: item.source_text, translations: item.translations },
      })
      item.qa = (await qa.json()).qa
    }
    await route.fulfill({ response, json: body })
  })
  await page.goto(`/projects/${project.slug}/strings`)
  await page.getByRole('button', { name: 'Translate missing', exact: true }).click()
  const review = page.getByRole('dialog')
  await review.getByRole('button', { name: 'Translate', exact: true }).click()
  await expect(review.getByText('Error: Missing placeholder {name}', { exact: true })).toHaveCount(2)
  await expect(review.getByText('AI estimate 99', { exact: true })).toHaveCount(2)
  const apply = review.getByRole('button', { name: /Apply 2 translations/ })
  await expect(apply).toBeEnabled()

  const corrected = review.locator(`#proposal-${entries[0].id}-en`)
  await corrected.fill('Hello {name}')
  await corrected.blur()
  await expect(review.getByText('No structural issues detected', { exact: true })).toHaveCount(1)
  await expect(review.getByText('Error: Missing placeholder {name}', { exact: true })).toHaveCount(1)
  await expect(apply).toBeEnabled()
  await apply.click()
  await review.getByRole('button', { name: 'Discard', exact: true }).click()

  // The still-invalid translation can be published without an override.
  await publishStringsViaApi(page, project.id, entries.map((entry) => entry.id))
  const stored = await (await page.request.get(`${root}/strings/${entries[1].id}`)).json()
  expect(stored.status).toBe('public')
  expect(stored.translations.find((item: { locale: string }) => item.locale === 'en')).toMatchObject({
    published_value: 'Hello', qa: { issues: [{ code: 'placeholder_missing' }], complete: true },
  })
  await page.reload()
  await expect(page.getByLabel('QA: 1 errors, 0 warnings')).toBeVisible()
  await openStringEditor(page, entries[1].key)
  const editor = page.getByRole('dialog')
  await expect(editor.getByText('Error: Missing placeholder {name}', { exact: true })).toBeVisible()
  await editor.getByLabel('en', { exact: true }).fill('Hello {name}')
  await editor.getByLabel('en', { exact: true }).blur()
  await expect(editor.getByText('No structural issues detected', { exact: true })).toBeVisible()
  await expect(editor.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled()
})
