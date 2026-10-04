import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ActivityChange } from '@/lib/api/types'
import { ChangeLine } from './StringHistoryPanel'

describe('restoration confirmation transitions', () => {
  it.each([
    ['translation', 'fr', 'translation', 'FR'],
    ['description', null, 'field', 'Description'],
    ['module_id', null, 'field', 'Module'],
    ['tags', null, 'tags', 'Tags'],
  ] as const)('shows clearing and setting %s on both sides', (field, locale, kind, label) => {
    const change: ActivityChange = {
      field,
      locale,
      kind,
      scope: 'draft',
      before: 'Old',
      after: null,
    }
    expect(renderToStaticMarkup(<ChangeLine change={change} preview />)).toContain(
      `${label}</span> “Old” → “—”`
    )
    expect(
      renderToStaticMarkup(<ChangeLine change={{ ...change, before: '', after: 'New' }} preview />)
    ).toContain('“—” → “New”')
    expect(renderToStaticMarkup(<ChangeLine change={change} wrap />)).not.toContain('→')
  })
})
