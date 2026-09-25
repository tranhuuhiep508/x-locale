import { test, expect } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'
import { openDemoStrings } from '../helpers/strings'

test.beforeAll(() => resetDemoDatabase())

test('catalog controls and string form work from the keyboard', async ({ page }) => {
  await openDemoStrings(page)
  await page.getByRole('button', { name: 'Add string' }).focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog').filter({ hasText: 'Add string' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Key').focus()
  await page.keyboard.type(`keyboard_${Date.now()}`)
  await page.keyboard.press('Tab')
  await expect(dialog.getByLabel('Source text')).toBeFocused()
  await page.keyboard.type('Keyboard source')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'Add string' })).toBeVisible()
})
