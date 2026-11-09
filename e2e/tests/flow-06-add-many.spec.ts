import { test, expect } from '../fixtures'
import { resetDemoDatabase } from '../helpers/database'
import { openAddManyDialog, openDemoStrings, searchStrings } from '../helpers/strings'
import { publishStringsViaApi } from '../helpers/api'

test.describe.configure({ mode: 'serial' })

const newKey = `e2e_add_many_${Date.now()}`

test.beforeAll(() => {
  resetDemoDatabase()
})

function buildPasteJson() {
  return JSON.stringify(
    {
      save: 'Lưu (add many updated)',
      [newKey]: 'E2E add many string',
    },
    null,
    2,
  )
}

test('add many paste: reject invalid input, cancel is a no-op, save as draft writes once', async ({
  page,
}) => {
  await openDemoStrings(page)
  await openAddManyDialog(page)

  const dialog = page.getByRole('dialog').filter({ hasText: 'Add many' })
  const json = dialog.getByLabel('JSON')

  await json.fill('{not json')
  await dialog.getByRole('button', { name: 'Preview' }).click()
  await expect(dialog.getByText(/Invalid JSON/)).toBeVisible()

  await json.fill('{"welcome": {"en": "Hi"}}')
  await dialog.getByRole('button', { name: 'Preview' }).click()
  await expect(dialog.getByText(/must have a string value/)).toBeVisible()

  await json.fill('{}')
  await dialog.getByRole('button', { name: 'Preview' }).click()
  await expect(dialog.getByText(/JSON object is empty/)).toBeVisible()

  await json.fill(buildPasteJson())
  await dialog.getByRole('combobox', { name: 'Module' }).click()
  await page.getByRole('option', { name: /Common/ }).click()
  await dialog.getByRole('button', { name: 'Preview' }).click()
  const list = dialog.getByRole('list', { name: 'Pasted strings' })
  await expect(list.getByText(newKey)).toBeVisible()
  await expect(list.getByRole('listitem').filter({ hasText: 'save' }).getByText('Update', { exact: true })).toBeVisible()

  // Nothing is written before Save: closing discards after confirmation.
  await page.keyboard.press('Escape')
  await page
    .getByRole('alertdialog', { name: 'Discard pasted strings?' })
    .getByRole('button', { name: 'Discard' })
    .click()
  await expect(page.getByRole('heading', { name: 'Add many' })).toBeHidden()
  await searchStrings(page, newKey)
  await expect(page.getByRole('row').filter({ hasText: newKey })).toHaveCount(0)

  await openAddManyDialog(page)
  const saveDialog = page.getByRole('dialog').filter({ hasText: 'Add many' })
  await saveDialog.getByLabel('JSON').fill(buildPasteJson())
  await saveDialog.getByRole('combobox', { name: 'Module' }).click()
  await page.getByRole('option', { name: /Common/ }).click()
  await saveDialog.getByRole('button', { name: 'Preview' }).click()
  await saveDialog.getByRole('textbox', { name: `EN translation for ${newKey}` }).fill('E2E English')
  await saveDialog.getByRole('button', { name: 'Save as draft' }).click()
  await expect(saveDialog.getByText('Saved 2 strings as draft')).toBeVisible()
  await saveDialog.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('heading', { name: 'Add many' })).toBeHidden()

  await searchStrings(page, newKey)
  const created = page.getByRole('row').filter({ hasText: newKey })
  await expect(created).toBeVisible()
  await expect(created.getByRole('switch', { name: 'Draft' })).toBeVisible()

  await searchStrings(page, 'save')
  await expect(page.getByRole('row').filter({ hasText: 'Lưu (add many updated)' })).toBeVisible()

  await page.getByRole('link', { name: 'Activity' }).click()
  await expect(page.getByText(/Imported · 2 strings/)).toBeVisible()
})

test('add many target-language paste: AI fills empty cells, review, then publish', async ({
  page,
}) => {
  await page.goto('/')
  const created = await page.request.post('/api/projects', {
    data: {
      name: `Paste review ${Date.now()}`,
      base_language: 'vi',
      target_languages: ['en', 'ja'],
      layout: 'flat',
    },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const project = await created.json()
  const root = `/api/projects/${project.slug}`
  const hello = await page.request.post(`${root}/strings`, {
    data: { key: 'hello', source_text: 'Xin chào', translations: { en: 'Hi' } },
  })
  expect(hello.ok()).toBeTruthy()
  await publishStringsViaApi(page, project.slug, [(await hello.json()).id])

  await page.goto(`/projects/${project.slug}/strings`)
  await openAddManyDialog(page)
  const dialog = page.getByRole('dialog').filter({ hasText: 'Add many' })
  await dialog.getByRole('combobox', { name: 'Language' }).click()
  await page.getByRole('option', { name: 'EN', exact: true }).click()
  await dialog.getByLabel('JSON').fill(JSON.stringify({ hello: 'Hello there', bye: 'Bye' }))
  await dialog.getByRole('button', { name: 'Preview' }).click()

  const english = dialog.getByRole('textbox', { name: 'EN translation for hello', exact: true })
  await expect(english).toHaveValue('Hello there')
  await dialog.getByRole('button', { name: 'Generate with AI' }).click()
  const japanese = dialog.getByRole('textbox', { name: 'JA translation for hello', exact: true })
  await expect(japanese).not.toHaveValue('')
  // Pasted target text is kept; AI only fills empty languages.
  await expect(english).toHaveValue('Hello there')
  await english.fill('Hello friend')

  const publicBefore = await (await page.request.get(`${root}/export?stage=public&locale=en`)).json()
  expect(publicBefore.en.hello).toBe('Hi')
  await dialog.getByRole('button', { name: 'Review & publish' }).click()
  await expect(dialog.getByText('Hello friend').first()).toBeVisible()
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click()
  // Publish closes the dialog and confirms with a toast.
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Saved and published 2 strings' })).toBeVisible()
  await expect(dialog).toBeHidden()

  const afterPublish = await (await page.request.get(`${root}/export?stage=public&locale=en`)).json()
  expect(afterPublish.en.hello).toBe('Hello friend')
  expect(afterPublish.en.bye).toBe('Bye')
})
