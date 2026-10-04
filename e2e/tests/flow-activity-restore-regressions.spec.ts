import { test, expect, type Page } from '@playwright/test'
import { openStringEditor } from '../helpers/strings'

test.describe.configure({ mode: 'serial' })

async function project(page: Page) {
  const response = await page.request.post('/api/projects', {
    data: {
      name: `Restore regression ${Date.now()}`,
      base_language: 'vi',
      target_languages: ['en'],
    },
  })
  expect(response).toBeOK()
  const pid = (await response.json()).id as string
  return { pid, root: `/api/projects/${pid}` }
}

async function create(page: Page, root: string, key = 'restore_demo') {
  const response = await page.request.post(`${root}/strings`, {
    data: { key, source_text: 'A1', translations: { en: 'Hello' } },
  })
  expect(response).toBeOK()
  return (await response.json()).id as string
}

async function updateImport(page: Page, root: string) {
  const response = await page.request.post(`${root}/strings/import`, {
    data: { strings: { restore_demo: 'A2' } },
  })
  expect(response).toBeOK()
  return (await response.json()).batch_id as string
}

async function publish(page: Page, root: string, sid: string) {
  const preview = await page.request.post(`${root}/strings/publish-preview`, {
    data: { string_ids: [sid] },
  })
  expect(preview).toBeOK()
  const response = await page.request.post(`${root}/strings/batch`, {
    data: {
      action: 'publish',
      string_ids: [sid],
      fingerprint: (await preview.json()).fingerprint,
    },
  })
  expect(response).toBeOK()
  return (await response.json()).batch_id as string
}

async function openBatchUndo(page: Page, pid: string, batch: string) {
  await page.goto(`/projects/${pid}/activity`)
  const card = page
    .locator('div.rounded-lg')
    .filter({ has: page.locator(`a[href*="batch_id=${batch}"]`) })
  await card.getByRole('button', { name: 'Undo', exact: true }).click()
  return page.getByRole('alertdialog')
}

async function openCreationRestore(page: Page, pid: string, key = 'restore_demo') {
  await page.goto(`/projects/${pid}/strings`)
  await openStringEditor(page, key)
  await page.getByText('History', { exact: true }).click()
  const creation = page.getByRole('listitem').filter({ hasText: `Created '${key}'` })
  await creation.getByRole('button', { name: 'Restore working copy', exact: true }).click()
  return page.getByRole('alertdialog', { name: 'Restore working copy?' })
}

test('forced undo history records the value actually overwritten', async ({ page }) => {
  const { pid, root } = await project(page)
  const sid = await create(page, root)
  const batch = await updateImport(page, root)
  expect(
    await page.request.patch(`${root}/strings/${sid}`, {
      data: { source_text: 'A3' },
    })
  ).toBeOK()
  const dialog = await openBatchUndo(page, pid, batch)
  await expect(dialog).toContainText('Source text “A3” → “A1”')
  await expect(page.getByRole('alertdialog', { name: 'Overwrite later edits?' })).toBeVisible()
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && request.url().includes(`/activities/batch/${batch}/revert`)
  )
  await dialog.getByRole('button', { name: 'Overwrite and undo' }).click()
  expect(new URL((await submitted).url()).searchParams.get('force')).toBe('true')
  await expect(dialog).toBeHidden()
  const restored = page.locator('div.rounded-lg').filter({ hasText: 'Restored 1 string' })
  await restored.getByRole('button', { name: /Show 1 strings/ }).click()
  await restored.getByRole('button', { name: 'View details' }).click()
  const details = page
    .getByRole('dialog')
    .filter({ hasText: "Restored previous value of 'restore_demo'" })
  await expect(details.getByText('A3', { exact: true })).toBeVisible()
  await expect(details.getByText('A1', { exact: true })).toBeVisible()
  await expect(details.getByText('A2', { exact: true })).toHaveCount(0)
})

test('incompatible undo preview fails closed and can be retried', async ({ page }) => {
  const { pid, root } = await project(page)
  await create(page, root)
  const batch = await updateImport(page, root)
  let incompatible = true
  await page.route('**/activities/batch/*/revert/preview', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    if (incompatible) delete body.can_revert
    await route.fulfill({ response, json: body })
  })
  const dialog = await openBatchUndo(page, pid, batch)
  await expect(dialog.getByRole('alert')).toContainText('incompatible preview')
  await expect(dialog.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  incompatible = false
  await dialog.getByRole('button', { name: 'Retry preview' }).click()
  await expect(dialog.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
})

test('execution conflicts refresh preview and block a newly reused key', async ({ page }) => {
  const { pid, root } = await project(page)
  const sid = await create(page, root)
  const batch = await updateImport(page, root)
  const dialog = await openBatchUndo(page, pid, batch)
  const undo = dialog.getByRole('button', { name: 'Undo', exact: true })
  await expect(undo).toBeEnabled()
  await page.request.patch(`${root}/strings/${sid}`, {
    data: { source_text: 'A3' },
  })
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/activities/batch/*/revert/preview', async (route) => {
    await gate
    await route.continue()
  })
  await undo.click()
  await expect(undo).toBeDisabled()
  release()
  const overwrite = dialog.getByRole('button', { name: 'Overwrite and undo' })
  await expect(overwrite).toBeEnabled()
  // Another edit now makes the key unavailable; the stale force-capable preview must not bypass it.
  await page.request.patch(`${root}/strings/${sid}`, {
    data: { key: 'renamed_demo' },
  })
  await create(page, root)
  await overwrite.click()
  await expect(dialog).toContainText("Key 'restore_demo' is already used")
  await expect(dialog.getByRole('button', { name: 'Overwrite and undo' })).toBeDisabled()
})

test('refreshed preview returns to normal undo when the conflict disappears', async ({ page }) => {
  const { pid, root } = await project(page)
  const sid = await create(page, root)
  const batch = await updateImport(page, root)
  await page.request.patch(`${root}/strings/${sid}`, {
    data: { source_text: 'A3' },
  })
  const dialog = await openBatchUndo(page, pid, batch)
  await expect(dialog.getByRole('button', { name: 'Overwrite and undo' })).toBeEnabled()
  await page.request.patch(`${root}/strings/${sid}`, {
    data: { source_text: 'A2' },
  })
  // Simulate a transient execution conflict, keeping the real authoritative refreshed preview.
  await page.route(
    `**/activities/batch/${batch}/revert?*`,
    async (route) => {
      await route.fulfill({
        status: 409,
        json: {
          detail: 'Conflict on activity x. Pass force=true to override.',
        },
      })
    },
    { times: 1 }
  )
  await dialog.getByRole('button', { name: 'Overwrite and undo' }).click()
  await expect(dialog.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
  await expect(dialog).toContainText('Undo this batch?')
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && request.url().includes(`/activities/batch/${batch}/revert`)
  )
  await dialog.getByRole('button', { name: 'Undo', exact: true }).click()
  expect(new URL((await submitted).url()).searchParams.get('force')).toBe('false')
  await expect(dialog).toBeHidden()
})

test('structured invalid snapshot error refreshes into a hard blocker', async ({ page }) => {
  const { pid, root } = await project(page)
  await create(page, root)
  const batch = await updateImport(page, root)
  const dialog = await openBatchUndo(page, pid, batch)
  await expect(dialog.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
  const message =
    'Cannot undo this activity because its saved before.published_at timestamp is invalid.'
  await page.route(`**/activities/batch/${batch}/revert?*`, async (route) => {
    await route.fulfill({
      status: 409,
      json: { detail: { code: 'invalid_snapshot', message } },
    })
  })
  await page.route('**/activities/batch/*/revert/preview', async (route) => {
    const response = await route.fetch()
    await route.fulfill({
      response,
      json: {
        ...(await response.json()),
        can_revert: false,
        blocked_reason: message,
      },
    })
  })
  await dialog.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(dialog).toContainText(message)
  await expect(dialog.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Overwrite and undo' })).toHaveCount(0)
})

test('forced undo explicitly warns about later publication', async ({ page }) => {
  const { pid, root } = await project(page)
  const sid = await create(page, root)
  const batch = await updateImport(page, root)
  await publish(page, root, sid)
  const dialog = await openBatchUndo(page, pid, batch)
  await expect(dialog).toContainText('This also changes published content or publish status.')
  await dialog.getByRole('button', { name: 'Overwrite and undo' }).click()
  await expect(dialog).toBeHidden()
  const live = await (await page.request.get(`${root}/strings/${sid}`)).json()
  expect(live.status).toBe('draft')
  expect(live.source_text).toBe('A1')
})

test('normal undo warns before rolling back publication', async ({ page }) => {
  const { pid, root } = await project(page)
  const sid = await create(page, root)
  await publish(page, root, sid)
  await page.goto(`/projects/${pid}/activity`)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Undo this batch?' })
  await expect(dialog).toContainText('This also changes the published snapshot or publish status.')
  await expect(dialog.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(dialog).toBeHidden()
  const live = await (await page.request.get(`${root}/strings/${sid}`)).json()
  expect(live.status).toBe('draft')
})

test('working-copy preview excludes publication and preserves public content', async ({ page }) => {
  const { pid, root } = await project(page)
  const sid = await create(page, root)
  expect(
    await page.request.patch(`${root}/strings/${sid}`, {
      data: { source_text: 'A2' },
    })
  ).toBeOK()
  await publish(page, root, sid)
  const dialog = await openCreationRestore(page, pid)
  await expect(dialog).toContainText('Source text “A2” → “A1”')
  await expect(dialog).not.toContainText('(published)')
  await dialog.getByRole('button', { name: 'Restore working copy', exact: true }).click()
  await expect(dialog).toBeHidden()
  const live = await (await page.request.get(`${root}/strings/${sid}`)).json()
  expect(live.source_text).toBe('A1')
  expect(live.status).toBe('public')
  expect(live.published_source_text).toBe('A2')
})

test('reused keys block restoration without offering overwrite', async ({ page }) => {
  const { pid, root } = await project(page)
  const sid = await create(page, root)
  expect(
    await page.request.patch(`${root}/strings/${sid}`, {
      data: { key: 'renamed_demo' },
    })
  ).toBeOK()
  await create(page, root)
  await page.goto(`/projects/${pid}/strings`)
  await openStringEditor(page, 'renamed_demo')
  await page.getByText('History', { exact: true }).click()
  const creation = page.getByRole('listitem').filter({ hasText: "Created 'restore_demo'" })
  await creation.getByRole('button', { name: 'Restore working copy', exact: true }).click()
  const dialog = page.getByRole('alertdialog', {
    name: 'Restore working copy?',
  })
  await expect(dialog).toContainText("Key 'restore_demo' is already used by another string.")
  await expect(
    dialog.getByRole('button', { name: 'Restore working copy', exact: true })
  ).toBeDisabled()
  await expect(dialog.getByRole('button', { name: 'Overwrite and undo' })).toHaveCount(0)
})

test('failed previews stay disabled and can be retried', async ({ page }) => {
  const { pid, root } = await project(page)
  const sid = await create(page, root)
  expect(
    await page.request.patch(`${root}/strings/${sid}`, {
      data: { source_text: 'A2' },
    })
  ).toBeOK()
  let fail = true
  await page.route('**/activities/*/restore/preview', async (route) => {
    if (fail) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Preview unavailable' }),
      })
    } else {
      await route.continue()
    }
  })
  const dialog = await openCreationRestore(page, pid)
  await expect(dialog).toContainText('Preview unavailable')
  await expect(
    dialog.getByRole('button', { name: 'Restore working copy', exact: true })
  ).toBeDisabled()
  fail = false
  await dialog.getByRole('button', { name: 'Retry preview' }).click()
  await expect(dialog).toContainText('Source text “A2” → “A1”')
  await expect(
    dialog.getByRole('button', { name: 'Restore working copy', exact: true })
  ).toBeEnabled()
})

test('history clears a language added after the selected version', async ({ page }) => {
  const { pid, root } = await project(page)
  const sid = await create(page, root)
  expect(
    await page.request.patch(root, {
      data: { target_languages: ['en', 'fr'] },
    })
  ).toBeOK()
  expect(
    await page.request.put(`${root}/strings/${sid}/translations/fr`, {
      data: { value: 'Bonjour' },
    })
  ).toBeOK()
  const dialog = await openCreationRestore(page, pid)
  await expect(dialog).toContainText('FR “Bonjour” → “—”')
  await dialog.getByRole('button', { name: 'Restore working copy', exact: true }).click()
  await expect(dialog).toBeHidden()
  const live = await (await page.request.get(`${root}/strings/${sid}`)).json()
  expect(live.translations.find((t: { locale: string }) => t.locale === 'fr').value).toBe('')
})

test('batch undo waits for its preview and supports retry after failure', async ({ page }) => {
  const { pid, root } = await project(page)
  await create(page, root)
  const batch = await updateImport(page, root)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let fail = true
  await page.route('**/activities/batch/*/revert/preview', async (route) => {
    await gate
    if (fail) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'Undo preview unavailable' }),
      })
    } else {
      await route.continue()
    }
  })
  const dialog = await openBatchUndo(page, pid, batch)
  await expect(dialog.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  release()
  await expect(dialog).toContainText('Undo preview unavailable')
  await expect(dialog.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  fail = false
  await dialog.getByRole('button', { name: 'Retry preview' }).click()
  await expect(dialog.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
})
