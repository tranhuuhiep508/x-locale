import { test, expect } from '../fixtures'
import { publishStringsViaApi } from '../helpers/api'

test('CLI batch links reuse the catalog AI review dialog', async ({ page }) => {
  await page.goto('/')
  const created = await page.request.post('/api/projects', {
    data: {
      name: `CLI review ${Date.now()}`,
      base_language: 'vi',
      target_languages: ['en'],
      layout: 'flat',
    },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const project = await created.json()
  const root = `/api/projects/${project.slug}`
  const unrelated = await page.request.post(`${root}/strings`, {
    data: { key: 'unrelated', source_text: 'Other batch' },
  })
  expect(unrelated.ok()).toBeTruthy()
  const pushed = await page.request.post(`${root}/strings/import`, {
    data: { strings: { greeting: 'Xin chào', removal: 'Queued for removal' } },
  })
  expect(pushed.ok(), await pushed.text()).toBeTruthy()
  const { batch_id } = await pushed.json()
  const members = await page.request.get(`${root}/strings?batch_id=${batch_id}`)
  const removal = (await members.json()).items.find((entry: { key: string }) => entry.key === 'removal')
  await publishStringsViaApi(page, project.slug, [removal.id])
  const deleted = await page.request.delete(`${root}/strings/${removal.id}`)
  expect(deleted.ok()).toBeTruthy()

  await page.goto(`/projects/${project.slug}/activity`)
  const link = page.getByRole('link', { name: 'Review this batch' }).first()
  await expect(link).toHaveAttribute('href', /strings\?.*batch_id=/)
  await link.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Missing Translations' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Filtered to this push')).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'greeting' })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'removal' })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: 'unrelated' })).toHaveCount(0)

  // Previously printed workspace URLs preserve the batch scope.
  await page.goto(`/projects/${project.slug}/batches/${batch_id}`)
  await expect(page).toHaveURL(/\/strings\?.*batch_id=/)
  await expect(dialog.getByRole('heading', { name: 'Missing Translations' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Translate', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Review Translations' })).toBeVisible()
  await expect(dialog.getByLabel('en', { exact: true })).not.toHaveValue('')
  const before = await page.request.get(`${root}/export?stage=public&locale=en`)
  expect((await before.json()).en).toEqual({ removal: '' })
  await dialog.getByRole('button', { name: 'Review & publish', exact: true }).click()
  await dialog.getByRole('button', { name: 'Publish 1 string', exact: true }).click()
  await expect(dialog).toBeHidden()
  const after = await page.request.get(`${root}/export?stage=public&locale=en`)
  expect(Object.keys((await after.json()).en).sort()).toEqual(['greeting', 'removal'])
  const stillPending = await page.request.get(`${root}/strings/${removal.id}`)
  expect((await stillPending.json()).pending_delete).toBe(true)
})
