import { expect, type Page } from '@playwright/test'

export function projectIdFromUrl(page: Page): string {
  const match = page.url().match(/\/projects\/([^/]+)/)
  if (!match) {
    throw new Error(`Expected project URL, got ${page.url()}`)
  }
  return match[1]
}

export async function importStringsViaApi(
  page: Page,
  projectId: string,
  strings: Record<string, string>,
) {
  const response = await page.request.post(`/api/projects/${projectId}/strings/import`, {
    data: { strings },
  })
  expect(response.ok()).toBeTruthy()
  return response.json()
}

export async function bootstrapWithApiKey(page: Page, apiKey: string) {
  const response = await page.request.get('/api/bootstrap', {
    headers: { 'X-API-Key': apiKey },
  })
  return response
}
