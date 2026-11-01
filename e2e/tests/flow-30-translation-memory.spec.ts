import { test, expect, type Page } from '../fixtures'
import { publishStringsViaApi } from '../helpers/api'
import { openStringEditor, searchStrings } from '../helpers/strings'

test.use({ viewport: { width: 1280, height: 900 } })

async function setupProject(page: Page) {
  await page.goto('/')
  const response = await page.request.post('/api/projects', {
    data: { name: `Memory ${Date.now()}`, base_language: 'vi', target_languages: ['en', 'ja'] },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  const project = (await response.json()) as { id: string; slug: string }
  await page.goto(`/projects/${project.slug}/strings`)
  return project
}

async function create(
  page: Page,
  pid: string,
  key: string,
  source: string,
  translations: Record<string, string> = {},
  scores: Record<string, number> = {},
) {
  const response = await page.request.post(`/api/projects/${pid}/strings`, {
    data: { key, source_text: source, translations, translation_scores: scores },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
  return response.json() as Promise<{ id: string; key: string }>
}

test('batch review shows memory inline before AI and skips only the selected locale', async ({
  page,
}) => {
  const project = await setupProject(page)
  const source = 'Xin chào thành viên {name}'
  const origin = await create(page, project.id, 'origin', source, { en: 'Published hello {name}' })
  await publishStringsViaApi(page, project.id, [origin.id])
  const destination = await create(page, project.id, 'destination', source)
  await searchStrings(page, 'destination')
  await expect(page.getByRole('row').filter({ hasText: 'origin' })).toBeHidden()
  await expect(page.getByRole('row').filter({ hasText: 'destination' })).toBeVisible()
  await page.getByRole('button', { name: 'Translate missing' }).click()
  const dialog = page.locator('[data-slot="dialog-content"]')
  const use = dialog.getByRole('switch', { name: 'Use match for en in destination' })
  await expect(use).toBeVisible()
  await expect(dialog.getByLabel('en', { exact: true })).toHaveValue('')
  await expect(dialog.getByRole('meter')).toHaveAttribute('aria-valuenow', '100')
  await use.focus()
  await use.press('Space')
  await expect(dialog.getByLabel('en', { exact: true })).toHaveValue('Published hello {name}')
  await expect(dialog.getByRole('button', { name: 'Apply 1 translation' })).toBeEnabled()
  const generation = page.waitForResponse((response) =>
    response.url().endsWith('/translate/proposals'),
  )
  await dialog.getByRole('button', { name: /^Translate \d+ cells$/ }).click()
  const generated = await generation
  expect(generated.ok(), await generated.text()).toBeTruthy()
  expect(generated.request().postDataJSON().exclude_cells).toEqual({ [destination.id]: ['en'] })
  await expect(dialog.getByLabel('ja', { exact: true })).toHaveValue(`[ja] ${source}`)
  await expect(dialog.getByLabel('en', { exact: true })).toHaveValue('Published hello {name}')
  await dialog.getByRole('button', { name: 'Apply 2 translations' }).click()
  await expect(dialog.getByText('Every target locale already has text.').first()).toBeVisible()
  const saved = await (
    await page.request.get(`/api/projects/${project.id}/strings/${destination.id}`)
  ).json()
  expect(saved.status).toBe('draft')
  expect(saved.published_at).toBeNull()
  expect(
    saved.translations.find((cell: { locale: string }) => cell.locale === 'en').confidence,
  ).toBeNull()
})

test('retranslation can reuse its own publication and clear confidence for unchanged text', async ({
  page,
}) => {
  const project = await setupProject(page)
  const row = await create(
    page,
    project.id,
    'self',
    'Nội dung đã phát hành',
    { en: 'Published English', ja: 'Published Japanese' },
    { en: 91 },
  )
  await publishStringsViaApi(page, project.id, [row.id])
  await openStringEditor(page, 'self')
  const dialog = page.locator('[data-slot="dialog-content"]')
  await expect(page.getByRole('button', { name: 'Use en match from self' })).toBeVisible()
  await page.getByRole('button', { name: 'Use en match from self' }).click()
  const preview = page.waitForResponse((response) => response.url().endsWith('/translate/preview'))
  await dialog.getByRole('button', { name: /^Generate .*AI$/ }).click()
  expect((await preview).request().postDataJSON().locales).toEqual(['ja'])
  await expect(dialog.getByLabel('en', { exact: true })).toHaveValue('Published English')
  await expect(dialog.getByLabel('ja', { exact: true })).toHaveValue('[ja] Nội dung đã phát hành')
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(dialog).toBeHidden()
  const saved = await (
    await page.request.get(`/api/projects/${project.id}/strings/${row.id}`)
  ).json()
  const en = saved.translations.find((cell: { locale: string }) => cell.locale === 'en')
  const ja = saved.translations.find((cell: { locale: string }) => cell.locale === 'ja')
  expect(en.confidence).toBeNull()
  expect(en.published_value).toBe('Published English')
  expect(ja.published_value).toBe('Published Japanese')
})

test('fuzzy suggestions show source differences and QA before Use; typing refreshes suggestions automatically', async ({
  page,
}) => {
  const project = await setupProject(page)
  const prefix = 'Welcome back dear customer please confirm your account information and continue'
  const origin = await create(page, project.id, 'origin', `${prefix} {name}`, {
    en: 'Hello {name}',
  })
  await publishStringsViaApi(page, project.id, [origin.id])
  await create(page, project.id, 'destination', `${prefix} {user}`)
  await openStringEditor(page, 'destination')
  const dialog = page.locator('[data-slot="dialog-content"]')
  const panel = dialog.getByRole('region', { name: 'Previously published' })
  await expect(panel.getByText(/% similar/)).toBeVisible()
  await expect(panel.getByText(`Source: ${prefix} {name}`)).toBeVisible()
  await expect(panel.getByRole('button', { name: /en match from origin.*errors/ })).toBeVisible()
  await panel.getByRole('button', { name: 'Use en match from origin' }).click()
  const lookups: string[] = []
  const previews: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/translate/memory')) lookups.push(request.postData() ?? '')
    if (request.url().endsWith('/translate/preview')) previews.push(request.postData() ?? '')
  })
  await dialog.getByLabel('Source text').fill(`${prefix} {user}!`)
  await expect(dialog.getByRole('button', { name: /^Generate .*AI$/ })).toBeDisabled()
  await expect.poll(() => lookups.length).toBe(1)
  await expect(dialog.getByRole('button', { name: /^Generate .*AI$/ })).toBeEnabled()
  expect(previews).toHaveLength(0)
  await dialog.getByRole('button', { name: /^Generate .*AI$/ }).click()
  await expect.poll(() => previews.length).toBe(1)
})
