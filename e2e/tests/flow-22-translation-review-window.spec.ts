import { expect, test } from '@playwright/test'
import { resetDemoDatabase } from '../helpers/database'
import { importStringsViaApi, projectIdFromUrl } from '../helpers/api'
import { openDemoStrings } from '../helpers/strings'

test.beforeAll(() => resetDemoDatabase())

for (const filter of [
  { param: 'period', value: '1h', advanceHours: 2 },
  { param: 'updated_within_days', value: '7', advanceHours: 8 * 24 },
]) {
  test(`${filter.param} stays fixed while paging and applying; reopening starts a fresh window`, async ({ page }) => {
    await openDemoStrings(page)
    const projectId = projectIdFromUrl(page)
    const prefix = `review_window_${filter.param}`
    const keys = Array.from({ length: 55 }, (_, i) => `${prefix}_${String(i).padStart(2, '0')}`)
    await importStringsViaApi(page, projectId, Object.fromEntries(keys.map((key) => [key, key])))

    const url = new URL(page.url())
    url.searchParams.set('q', prefix)
    url.searchParams.set(filter.param, filter.value)
    await page.goto(url.toString())
    const endpoint = `/api/projects/${projectId}/translate/missing`
    const waitForQueue = () => page.waitForResponse(
      (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === endpoint,
    )
    const firstResponse = waitForQueue()
    await page.getByRole('button', { name: 'Translate missing' }).click()
    const first = await firstResponse
    const firstBody = first.request().postDataJSON()
    const firstQueue = await first.json()
    expect(firstBody.since).toEqual(expect.any(String))
    expect(firstBody.updated_within_days).toBeUndefined()
    expect(firstQueue.total).toBe(55)
    expect(firstQueue.items.map((item: { key: string }) => item.key)).toEqual(keys.slice(0, 50))

    // Only time moves: the original candidates must remain reachable on page 2.
    const later = Date.now() + filter.advanceHours * 3_600_000
    await page.clock.setSystemTime(new Date(later))
    const dialog = page.getByRole('dialog')
    const secondResponse = waitForQueue()
    const paging = dialog.getByText(/\d+–\d+ of \d+/)
    await paging.locator('..').getByRole('button').last().click()
    const second = await secondResponse
    const secondBody = second.request().postDataJSON()
    const secondQueue = await second.json()
    expect(secondBody).toEqual({ ...firstBody, page: 2 })
    expect(secondQueue.total).toBe(55)
    expect(secondQueue.items.map((item: { key: string }) => item.key)).toEqual(keys.slice(50))
    await expect(dialog.locator('li')).toHaveCount(5)

    await dialog.getByRole('button', { name: 'Translate', exact: true }).click()
    const apply = dialog.getByRole('button', { name: /Apply \d+ translations?/ })
    await expect(apply).toBeEnabled()
    await page.clock.setSystemTime(new Date(later + 3_600_000))
    const refreshedResponse = waitForQueue()
    await apply.click()
    const refreshed = await refreshedResponse
    expect(refreshed.request().postDataJSON()).toEqual(secondBody)
    const refreshedQueue = await refreshed.json()
    expect(refreshedQueue.total).toBe(50)
    expect(refreshedQueue.page).toBe(1)
    expect(refreshedQueue.items.map((item: { key: string }) => item.key)).toEqual(keys.slice(0, 50))
    await expect(dialog.locator('li')).toHaveCount(50)
    await dialog.getByRole('button', { name: 'Discard', exact: true }).click()
    await expect(dialog).not.toBeVisible()

    const reopenedResponse = waitForQueue()
    await page.getByRole('button', { name: 'Translate missing' }).click()
    const reopened = await reopenedResponse
    const reopenedBody = reopened.request().postDataJSON()
    expect(Date.parse(reopenedBody.since)).toBeGreaterThan(Date.parse(firstBody.since))
    expect(reopenedBody).toEqual({ ...firstBody, since: reopenedBody.since })
    expect((await reopened.json()).total).toBe(0)
    await expect(dialog.getByText('Nothing to translate', { exact: true })).toBeVisible()
  })
}
