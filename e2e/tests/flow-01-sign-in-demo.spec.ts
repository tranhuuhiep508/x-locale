import { test, expect } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'
import { openDemoStrings } from '../helpers/strings'

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => {
  resetDemoDatabase()
})

test('dev bypass lands on projects without manual sign-in', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Dev User' })).toBeVisible()
})

test('login page exposes Microsoft sign-in when visited directly', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByText('Sign in', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue with Microsoft' })).toBeVisible()
})

test('open Demo App strings catalog with seeded keys', async ({ page }) => {
  await openDemoStrings(page)
  await expect(page.getByRole('button', { name: 'Add string' })).toBeVisible()
  await expect(page.getByText('sign_in', { exact: true })).toBeVisible()
  await expect(page.getByText('save', { exact: true })).toBeVisible()
})
