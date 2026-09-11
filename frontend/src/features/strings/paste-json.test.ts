import { describe, expect, it } from 'vitest'
import { parseFlatI18nJson, pasteImportParams } from './paste-json'

describe('parseFlatI18nJson', () => {
  it('parses a flat key to source map', () => {
    const result = parseFlatI18nJson('{"welcome.title": "Welcome", "cta": "Go"}')
    expect(result).toEqual({
      ok: true,
      rows: [
        { key: 'welcome.title', source_text: 'Welcome' },
        { key: 'cta', source_text: 'Go' },
      ],
      map: { 'welcome.title': 'Welcome', cta: 'Go' },
    })
  })

  it('treats an empty object as a no-op', () => {
    expect(parseFlatI18nJson('{}')).toEqual({ ok: true, rows: [], map: {} })
  })

  it('rejects invalid JSON', () => {
    const result = parseFlatI18nJson('{not json')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/Invalid JSON/)
  })

  it('rejects arrays and primitives', () => {
    const arrayResult = parseFlatI18nJson('["a"]')
    expect(arrayResult.ok).toBe(false)
    if (!arrayResult.ok) expect(arrayResult.error).toMatch(/flat JSON object/)

    const primitive = parseFlatI18nJson('"hello"')
    expect(primitive.ok).toBe(false)
  })

  it('rejects nested objects, arrays, and non-string values without partial apply', () => {
    const nested = parseFlatI18nJson('{"welcome": {"en": "Hi"}, "ok": "yes"}')
    expect(nested.ok).toBe(false)
    if (!nested.ok) {
      expect(nested.error).toMatch(/welcome/)
      expect(nested.error).toMatch(/object/)
    }

    const arrayValue = parseFlatI18nJson('{"welcome": ["Hi"]}')
    expect(arrayValue.ok).toBe(false)
    if (!arrayValue.ok) expect(arrayValue.error).toMatch(/array/)

    const numberValue = parseFlatI18nJson('{"count": 1}')
    expect(numberValue.ok).toBe(false)
    if (!numberValue.ok) expect(numberValue.error).toMatch(/number/)
  })

  it('rejects empty keys', () => {
    const result = parseFlatI18nJson('{"": "Hi"}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/non-empty/)
  })
})

describe('pasteImportParams', () => {
  it('maps onto the JSON import dry-run contract', () => {
    expect(
      pasteImportParams({
        locale: 'vi',
        dry: true,
        moduleId: 'mod-1',
        tagIds: ['tag-1', 'tag-2'],
      }),
    ).toEqual({
      locale: 'vi',
      dry_run: 'true',
      status: 'draft',
      partial: 'true',
      module_id: 'mod-1',
      tag_ids: ['tag-1', 'tag-2'],
    })
  })

  it('omits unused module and tags', () => {
    expect(pasteImportParams({ locale: 'en', dry: false })).toEqual({
      locale: 'en',
      dry_run: 'false',
      status: 'draft',
      partial: 'true',
    })
  })
})
