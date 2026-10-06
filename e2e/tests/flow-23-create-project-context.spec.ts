import { test, expect } from '@playwright/test'

test('create project with translation context saved before opening settings', async ({ page }) => {
  let creationRequests = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/projects' && request.method() === 'POST') {
      creationRequests++
    }
  })
  await page.goto('/projects/new')
  await page.getByLabel('Project name').fill(`Context catalog ${Date.now()}`)
  await page.getByRole('button', { name: /Vietnamese/ }).click()
  const languageSearch = page.getByRole('textbox', { name: 'Search target languages' })
  await languageSearch.fill('Japanese')
  await languageSearch.press('Enter')
  await expect(page).toHaveURL(/\/projects\/new$/)
  await expect(page.getByRole('button', { name: /Japanese/ })).toBeVisible()
  await expect(languageSearch).toHaveValue('Japanese')
  const context = page.getByLabel('Translation context (optional)')
  await expect(context).toHaveAttribute('maxlength', '500')
  await context.fill('  Use a friendly tone and keep product names in English.  ')
  const creation = page.waitForResponse((response) =>
    response.url().endsWith('/api/projects') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Create project' }).click()
  const response = await creation
  expect(response.status()).toBe(201)
  expect(creationRequests).toBe(1)
  const project = await response.json() as { slug: string }
  expect(response.request().postDataJSON().translation_context)
    .toBe('Use a friendly tone and keep product names in English.')
  await expect(page).toHaveURL(new RegExp(`/projects/${project.slug}/strings`))
  const detail = await page.request.get(`/api/projects/${project.slug}`)
  expect((await detail.json()).translation_context)
    .toBe('Use a friendly tone and keep product names in English.')
  await page.getByRole('link', { name: 'Settings', exact: true }).click()
  await expect(context).toHaveValue('Use a friendly tone and keep product names in English.')
  await page.reload()
  await expect(context).toHaveValue('Use a friendly tone and keep product names in English.')
})
