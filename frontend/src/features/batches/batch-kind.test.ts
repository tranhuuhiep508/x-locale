import { describe, expect, it } from 'vitest'
import { batchKindName, opensBatchWorkspace } from './batch-kind'

describe('batch kinds', () => {
  it('opens the workspace only for CLI push and import batches', () => {
    expect(['cli_push', 'import', 'excel_import'].every(opensBatchWorkspace)).toBe(true)
    expect(['translate', 'batch', 'revert', null, undefined].some(opensBatchWorkspace)).toBe(false)
  })

  it('names each workspace batch kind', () => {
    expect(batchKindName('cli_push')).toBe('CLI push')
    expect(batchKindName('import')).toBe('Import')
    expect(batchKindName('excel_import')).toBe('Excel import')
  })
})
