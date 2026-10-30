import { test, expect } from '../fixtures'
import { resetDemoDatabase } from '../helpers/database'
import { projectIdFromUrl, publishStringsViaApi } from '../helpers/api'
import { openDemoStrings } from '../helpers/strings'

test.beforeAll(() => resetDemoDatabase())

test('accepted published memory skips AI for its cell and stays draft until publication', async ({ page }) => {
  await openDemoStrings(page)
  const projectId = projectIdFromUrl(page)
  const root = `/api/projects/${projectId}`
  const prefix = `e2e_memory_${Date.now()}`
  const source = 'Welcome to your personal translation memory account'
  const donorResponse = await page.request.post(`${root}/strings`, {
    data: { key: `${prefix}_donor`, source_text: source, translations: { en: 'Published English translation' } },
  })
  expect(donorResponse.ok(), await donorResponse.text()).toBeTruthy()
  const donor = await donorResponse.json()
  await publishStringsViaApi(page, projectId, [donor.id])
  const recipientResponse = await page.request.post(`${root}/strings`, {
    data: { key: `${prefix}_recipient`, source_text: source },
  })
  expect(recipientResponse.ok(), await recipientResponse.text()).toBeTruthy()
  const recipient = await recipientResponse.json()
  // Publish an empty snapshot so the test can distinguish draft and public values.
  await publishStringsViaApi(page, projectId, [recipient.id])
  const before = await page.request.get(`${root}/export`, { params: { locale: 'en', stage: 'public', format: 'json' } })
  expect(before.ok()).toBeTruthy()
  const publicBefore = await before.text()

  await page.getByRole('textbox', { name: 'Search strings' }).fill(`${prefix}_recipient`)
  await expect(page.getByRole('row').filter({ hasText: recipient.key })).toBeVisible()
  await page.getByRole('button', { name: 'Translate missing' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Previously published', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Use translation' }).click()
  await expect(dialog.getByRole('button', { name: /^Apply/ })).toBeEnabled()
  const generated = page.waitForResponse((response) => response.url().endsWith('/translate/proposals'))
  await dialog.getByRole('button', { name: 'Translate again' }).click()
  const generation = await generated
  expect(generation.ok(), await generation.text()).toBeTruthy()
  expect(generation.request().postDataJSON().exclude_locales_by_string).toEqual({ [recipient.id]: ['en'] })
  const proposals = await generation.json()
  expect(proposals.job_id).toBeNull()
  expect(proposals.items).toHaveLength(1)
  expect(proposals.items[0].translations).not.toHaveProperty('en')
  expect(proposals.items[0].translations.ja).toBeTruthy()
  await expect(dialog.getByLabel('en', { exact: true })).toHaveValue('Published English translation')
  await expect(dialog.getByRole('button', { name: /^Apply/ })).toBeEnabled()
  const applied = page.waitForResponse((response) => response.url().endsWith('/translate/apply'))
  await dialog.getByRole('button', { name: /^Apply/ }).click()
  const application = await applied
  expect(application.ok(), await application.text()).toBeTruthy()
  const savedResponse = await page.request.get(`${root}/strings/${recipient.id}`)
  const saved = await savedResponse.json()
  expect(saved.translations.find((cell: { locale: string }) => cell.locale === 'en')).toMatchObject({ value: 'Published English translation', published_value: '', confidence: null })
  expect(saved.translations.find((cell: { locale: string }) => cell.locale === 'ja').value).toBeTruthy()
  const after = await page.request.get(`${root}/export`, { params: { locale: 'en', stage: 'public', format: 'json' } })
  expect(await after.text()).toBe(publicBefore)
  await publishStringsViaApi(page, projectId, [recipient.id])
  const publishedResponse = await page.request.get(`${root}/strings/${recipient.id}`)
  expect((await publishedResponse.json()).translations.find((cell: { locale: string }) => cell.locale === 'en').published_value).toBe('Published English translation')
})
