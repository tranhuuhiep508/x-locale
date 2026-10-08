import { test, expect } from '@playwright/test'

test('admin deletes a project only after typing its slug', async ({ page }) => {
  const name = `Delete ${Date.now()}`
  const created = await page.request.post('/api/projects', {
    data: {
      name,
      base_language: 'vi',
      target_languages: ['en'],
      layout: 'flat',
    },
  })
  expect(created.status()).toBe(201)
  const project = (await created.json()) as { name: string; slug: string }

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  await page.getByRole('button', { name: `Delete ${project.name}` }).click()

  const dialog = page.getByRole('alertdialog')
  const confirm = dialog.getByRole('button', { name: 'Delete project' })
  await expect(dialog.getByText(/no undo/i)).toBeVisible()
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel('Project slug').fill('not-the-slug')
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel('Project slug').fill(project.slug)
  await expect(confirm).toBeEnabled()
  await confirm.click()

  await expect(page.getByText('Project deleted')).toBeVisible()
  await expect(page.getByRole('button', { name: `Delete ${project.name}` })).toHaveCount(0)
  expect((await page.request.get(`/api/projects/${project.slug}`)).status()).toBe(404)
})
