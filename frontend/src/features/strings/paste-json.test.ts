import { describe, expect, it } from 'vitest'
import { parseFlatI18nJson, pasteImportParams } from './paste-json'

describe('parseFlatI18nJson', () => {
  it('parses a flat key to source map', () => {
    const text = '{"welcome.title": "Welcome", "cta": "Go", "quote": "say \\"hi\\""}'
    const result = parseFlatI18nJson(text)
    const parsed = JSON.parse(text) as Record<string, string>
    expect(result).toEqual({
      ok: true,
      rows: Object.entries(parsed).map(([key, source_text]) => ({ key, source_text })),
      map: parsed,
    })
    expect(result).not.toHaveProperty('warning')
  })

  it('treats an empty object as a no-op', () => {
    expect(parseFlatI18nJson('{}')).toEqual({ ok: true, rows: [], map: {} })
  })

  it('rejects invalid JSON', () => {
    const result = parseFlatI18nJson('{not json')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/Invalid JSON/)
      expect(result.error).toMatch(/JSON5/)
    }
  })

  it('accepts trailing commas, comments, single quotes, and unquoted keys', () => {
    const result = parseFlatI18nJson(`{
      // line comment
      "welcome.title": "Welcome",
      /* block comment */
      'cta': 'Go',
      unquoted: "Yes",
      'it\\'s': 'fine',
    }`)
    expect(result).toEqual({
      ok: true,
      rows: [
        { key: 'welcome.title', source_text: 'Welcome' },
        { key: 'cta', source_text: 'Go' },
        { key: 'unquoted', source_text: 'Yes' },
        { key: "it's", source_text: 'fine' },
      ],
      map: { 'welcome.title': 'Welcome', cta: 'Go', unquoted: 'Yes', "it's": 'fine' },
    })
  })

  it('does not let a __proto__ key pollute prototypes', () => {
    const protoNames = Object.getOwnPropertyNames(Object.prototype)
    const nested = parseFlatI18nJson('{ "__proto__": { "polluted": true }, "ok": "yes" }')
    expect(nested.ok).toBe(false)
    if (!nested.ok) expect(nested.error).toMatch(/object/)
    expect(Object.getOwnPropertyNames(Object.prototype)).toEqual(protoNames)
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()

    const flat = parseFlatI18nJson('{ "__proto__": "safe", "title": "Hi" }')
    expect(Object.getOwnPropertyNames(Object.prototype)).toEqual(protoNames)
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
    expect(flat.ok).toBe(true)
    if (!flat.ok) return
    expect(flat.rows).toEqual([
      { key: '__proto__', source_text: 'safe' },
      { key: 'title', source_text: 'Hi' },
    ])
    expect(Object.getOwnPropertyDescriptor(flat.map, '__proto__')?.value).toBe('safe')
    expect(flat.map.title).toBe('Hi')
    expect(Object.getPrototypeOf(flat.map)).toBe(Object.prototype)
    const copy: { polluted?: boolean } = {}
    Object.assign(copy, flat.map)
    expect(copy.polluted).toBeUndefined()
    expect(JSON.parse(JSON.stringify(flat.map))).toEqual(
      JSON.parse('{"__proto__":"safe","title":"Hi"}'),
    )
  })

  it('warns on duplicate keys without dropping the later value', () => {
    const result = parseFlatI18nJson(`{
      "a": "1",
      a: "2",
      'a': "3",
      "b": "ok",
      "b": "later",
      "note": "say \\"a\\": inside",
      // "a": "hidden"
      /* "b": "hidden" */
    }`)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows).toEqual([
      { key: 'a', source_text: '3' },
      { key: 'b', source_text: 'later' },
      { key: 'note', source_text: 'say "a": inside' },
    ])
    expect(result.map).toEqual({ a: '3', b: 'later', note: 'say "a": inside' })
    expect(JSON.stringify(result.map)).toBe(
      '{"a":"3","b":"later","note":"say \\"a\\": inside"}',
    )
    expect(result.warning).toBe('Duplicate keys ("a", "b"): the later value is used.')
  })

  it.each([
    ['LF', '\n'],
    ['CR', '\r'],
    ['CRLF', '\r\n'],
    ['U+2028', '\u2028'],
    ['U+2029', '\u2029'],
  ])('warns on duplicates after a line comment ended by %s', (_, terminator) => {
    const result = parseFlatI18nJson(`{a:'one',// note${terminator}a:'two'}`)
    expect(result).toEqual({
      ok: true,
      rows: [{ key: 'a', source_text: 'two' }],
      map: { a: 'two' },
      warning: 'Duplicate keys ("a"): the later value is used.',
    })
  })

  it.each([
    ['中文', '中文', '中文'],
    ['café', '"café"', 'café'],
    ['e\u0301', 'e\u0301', 'e\u0301'],
  ])('warns on duplicate Unicode key %s', (key, first, second) => {
    const result = parseFlatI18nJson(`{${first}:'one',${second}:'two'}`)
    expect(result).toEqual({
      ok: true,
      rows: [{ key, source_text: 'two' }],
      map: { [key]: 'two' },
      warning: `Duplicate keys (${JSON.stringify(key)}): the later value is used.`,
    })
  })

  it('does not warn on distinct Unicode keys sharing an ASCII suffix', () => {
    expect(parseFlatI18nJson("{éname:'one',中name:'two'}")).toEqual({
      ok: true,
      rows: [
        { key: 'éname', source_text: 'one' },
        { key: '中name', source_text: 'two' },
      ],
      map: { éname: 'one', 中name: 'two' },
    })
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
