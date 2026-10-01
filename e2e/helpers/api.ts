import { expect, type Page } from '@playwright/test'

export function projectIdFromUrl(page: Page): string {
  const match = page.url().match(/\/projects\/([^/]+)/)
  if (!match) {
    throw new Error(`Expected project URL, got ${page.url()}`)
  }
  return match[1]
}

export type ImportResult = {
  created: number
  updated: number
  batch_id: string
}

export async function importStringsViaApi(
  page: Page,
  projectId: string,
  strings: Record<string, string>,
): Promise<ImportResult> {
  const response = await page.request.post(`/api/projects/${projectId}/strings/import`, {
    data: { strings },
  })
  expect(response.ok()).toBeTruthy()
  return response.json() as Promise<ImportResult>
}

export async function deleteStringViaApi(page: Page, projectId: string, stringId: string) {
  const response = await page.request.delete(`/api/projects/${projectId}/strings/${stringId}`)
  expect(response.ok()).toBeTruthy()
}

export async function exportXlsxViaApi(page: Page, projectId: string): Promise<Buffer> {
  const response = await page.request.get(`/api/projects/${projectId}/export`, {
    params: { format: 'xlsx', stage: 'all' },
  })
  expect(response.ok()).toBeTruthy()
  return Buffer.from(await response.body())
}

export async function importXlsxViaApi(
  page: Page,
  projectId: string,
  content: Buffer,
): Promise<ImportResult> {
  const response = await page.request.post(`/api/projects/${projectId}/import`, {
    multipart: {
      file: {
        name: 'e2e-batch.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: content,
      },
    },
  })
  expect(response.ok()).toBeTruthy()
  return response.json() as Promise<ImportResult>
}

export async function publishStringsViaApi(page: Page, projectId: string, stringIds: string[]) {
  const previewResponse = await page.request.post(
    `/api/projects/${projectId}/strings/publish-preview`,
    { data: { string_ids: stringIds } },
  )
  expect(previewResponse.ok()).toBeTruthy()
  const preview = (await previewResponse.json()) as { fingerprint: string }
  const batchResponse = await page.request.post(`/api/projects/${projectId}/strings/batch`, {
    data: {
      action: 'publish',
      string_ids: stringIds,
      fingerprint: preview.fingerprint,
    },
  })
  expect(batchResponse.ok()).toBeTruthy()
}

export async function translateApplyBatchViaApi(
  page: Page,
  projectId: string,
  stringId: string,
  locales: string[] = ['en', 'ja'],
): Promise<{ batch_id: string; translated_count: number }> {
  const proposalsResponse = await page.request.post(
    `/api/projects/${projectId}/translate/proposals`,
    { data: { scope: 'strings', string_ids: [stringId], locales } },
  )
  expect(proposalsResponse.ok()).toBeTruthy()
  const proposals = (await proposalsResponse.json()) as { items: unknown[] }
  expect(proposals.items.length).toBeGreaterThan(0)

  const applyResponse = await page.request.post(`/api/projects/${projectId}/translate/apply`, {
    data: { items: proposals.items },
  })
  expect(applyResponse.ok()).toBeTruthy()
  return applyResponse.json() as Promise<{ batch_id: string; translated_count: number }>
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

export async function createStringViaApi(
  page: Page,
  projectId: string,
  data: {
    key: string
    source_text: string
    status?: 'draft' | 'public'
    translations?: Record<string, string>
  },
): Promise<StringOut> {
  const response = await page.request.post(`/api/projects/${projectId}/strings`, { data })
  expect(response.ok()).toBeTruthy()
  return response.json() as Promise<StringOut>
}

/** Public string whose working copy differs from the last published snapshot. */
export async function seedPublicWithUnpublishedSource(
  page: Page,
  projectId: string,
  key: string,
  publishedSource: string,
  workingSource: string,
): Promise<StringOut> {
  const created = await createStringViaApi(page, projectId, {
    key,
    source_text: publishedSource,
    status: 'public',
  })
  return patchStringSource(page, projectId, created.id, workingSource)
}
