import { test, expect } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'
import { bootstrapWithApiKey } from '../helpers/api'
import { openDemoStrings } from '../helpers/strings'

test.describe.configure({ mode: 'serial' })

const keyName = `E2E key ${Date.now()}`

test.beforeAll(() => {
  resetDemoDatabase()
})

test('settings: generate API key, show secret once, revoke blocks bootstrap', async ({ page }) => {
  await openDemoStrings(page)
  await page.getByRole('link', { name: 'Settings' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()

  await page.getByRole('button', { name: 'Generate key' }).click()
  const createDialog = page.getByRole('dialog').filter({ hasText: 'Generate API key' })
  await createDialog.getByLabel('Key name').fill(keyName)
  await createDialog.getByRole('button', { name: 'Generate key' }).click()

  const secretDialog = page.getByRole('dialog').filter({ hasText: 'API key generated' })
  await expect(secretDialog).toBeVisible()
  const secret = await secretDialog.getByRole('textbox', { name: 'API key' }).inputValue()
  expect(secret.length).toBeGreaterThan(10)
  await secretDialog.getByRole('button', { name: 'Done' }).click()

  const row = page.getByRole('row').filter({ hasText: keyName })
  await expect(row).toBeVisible()
  await expect(row.getByText('Active')).toBeVisible()

  const activeBootstrap = await bootstrapWithApiKey(page, secret)
  expect(activeBootstrap.ok()).toBeTruthy()

  await row.getByRole('button', { name: `Revoke ${keyName}` }).click()
  const revokeDialog = page.getByRole('alertdialog', { name: `Revoke "${keyName}"?` })
  await revokeDialog.getByRole('button', { name: 'Revoke key' }).click()
  await expect(page.getByText('API key revoked')).toBeVisible()
  await expect(row).toHaveCount(0)

  const revokedBootstrap = await bootstrapWithApiKey(page, secret)
  expect(revokedBootstrap.status()).toBe(401)
})
