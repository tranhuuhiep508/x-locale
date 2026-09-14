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

type StringOut = {
  id: string
  key: string
  source_text: string
  status: string
  published_source_text: string | null
  has_unpublished_changes: boolean
}

export async function fetchStringByKey(page: Page, projectId: string, key: string): Promise<StringOut> {
  const response = await page.request.get(
    `/api/projects/${projectId}/strings?q=${encodeURIComponent(key)}&page_size=50`,
  )
  expect(response.ok()).toBeTruthy()
  const data = (await response.json()) as { items: StringOut[] }
  const match = data.items.find((item) => item.key === key)
  if (!match) {
    throw new Error(`String not found for key ${key}`)
  }
  return match
}

export async function patchStringSource(
  page: Page,
  projectId: string,
  stringId: string,
  sourceText: string,
) {
  const response = await page.request.patch(`/api/projects/${projectId}/strings/${stringId}`, {
    data: { source_text: sourceText },
  })
  expect(response.ok()).toBeTruthy()
  return response.json() as Promise<StringOut>
}
