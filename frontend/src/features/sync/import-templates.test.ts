import { describe, expect, it } from 'vitest'
import {
  DEMO_JSON_TEMPLATE,
  demoJsonFilename,
  demoJsonText,
} from './import-templates'

describe('import templates', () => {
  it('keeps dotted app keys as JSON property names', () => {
    expect(DEMO_JSON_TEMPLATE['common.save']).toBe('Lưu')
    expect(demoJsonText()).toContain('"common.save"')
    expect(demoJsonFilename('vi')).toBe('vi.json')
  })
})
