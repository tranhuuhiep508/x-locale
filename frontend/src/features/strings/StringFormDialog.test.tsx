import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { modulesApi, tagsApi } from '@/lib/api/catalog'
import { ApiError } from '@/lib/api/client'
import { stringsApi } from '@/lib/api/strings'
import type { Module, StringEntry, Tag, TranslationMemoryMatch, EditorProposal } from '@/lib/api/types'
import { TooltipProvider } from '@/components/ui/tooltip'
import StringFormDialog from './StringFormDialog'

// Observe field-level deltas independently of the editor transport envelope.
const savedCreates = vi.fn()
const savedUpdates = vi.fn()

const toast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}

vi.mock('@/lib/toast', () => ({
  useToast: () => toast,
}))

vi.mock('@/lib/api/catalog', () => ({
  modulesApi: { create: vi.fn() },
  tagsApi: { create: vi.fn() },
}))

vi.mock('@/features/strings/StringHistoryPanel', () => ({
  StringHistoryPanel: ({ onRestored }: { onRestored: () => void }) => (
    <button type="button" onClick={onRestored}>Restore previous version</button>
  ),
}))

vi.mock('@/lib/api/strings', () => ({
  stringsApi: {
    editorSave: vi.fn(),
    editorPreview: vi.fn(),
    translatePreview: vi.fn(),
    translateMemory: vi.fn().mockImplementation((_project, body) => Promise.resolve({ source_text: body.source_text, matches: {} })),
    translateQa: vi.fn().mockResolvedValue({ locale: 'en', issues: [] }),
    get: vi.fn(),
    batch: vi.fn(),
  },
}))

const createdModule: Module = {
  id: 'mod-new',
  slug: 'auth',
  name: 'Auth',
  description: null,
  translation_context: null,
  position: 0,
  string_count: 0,
}

const createdTag: Tag = {
  id: 'tag-new',
  name: 'ios',
  color: '#2563eb',
  string_count: 0,
}

function polyfillPointer() {
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: () => false,
  })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: () => {},
  })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: () => {},
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => {},
  })
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
}

const PUBLISHED_KEY_CONFLICT =
  "Key 'save' is already in the public export. Rename it, or publish the other string's removal, before publishing."

function draftEntry(): StringEntry {
  return {
    id: 'str-1',
    key: 'note',
    source_text: 'Ghi chú',
    description: null,
    status: 'draft',
    pending_delete: false,
    deleted_at: null,
    has_unpublished_changes: false,
    published_at: null,
    published_key: null,
    published_source_text: null,
    published_module_id: null,
    published_module_slug: null,
    module_id: null,
    module_slug: null,
    tags: [],
    created_at: null,
    created_by_type: null,
    created_by_label: null,
    updated_at: null,
    updated_by_type: null,
    updated_by_label: null,
    translations: [],
  }
}

function projectedEntry(proposal: EditorProposal, result: Partial<StringEntry> = {}): StringEntry {
  return {
    ...draftEntry(), ...proposal.values,
    translations: Object.entries(proposal.values.translations ?? {}).map(([locale, value]) => ({
      id: `t-${locale}`, locale, value, published_value: null, confidence: null, updated_at: null,
    })),
    ...result,
  }
}

function renderDialog(
  overrides: {
    onClose?: () => void
    onSuccess?: () => void
    modules?: Module[]
    tags?: Tag[]
    entry?: StringEntry | null
    targetLocales?: string[]
  } = {},
) {
  const onClose = overrides.onClose ?? vi.fn()
  const onSuccess = overrides.onSuccess ?? vi.fn()
  const onSaved = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}><TooltipProvider>{children}</TooltipProvider></QueryClientProvider>
  )
  render(
    <StringFormDialog
      projectId="proj-1"
      entry={overrides.entry}
      modules={overrides.modules ?? []}
      tags={overrides.tags ?? []}
      targetLocales={overrides.targetLocales ?? ['en']}
      onClose={onClose}
      onSuccess={onSuccess}
      onSaved={onSaved}
    />,
    { wrapper },
  )
  return { onClose, onSuccess, onSaved }
}

const memoryMatch: TranslationMemoryMatch = {
  string_id: 'origin', key: 'published.greeting', module_id: null, module_slug: 'account',
  matched_source_text: 'Ghi chú', translation: 'Published note', similarity: 1, exact: true, issues: [],
}

beforeEach(() => {
  savedCreates.mockReset().mockResolvedValue({})
  savedUpdates.mockReset().mockResolvedValue({})
  vi.mocked(stringsApi.editorSave).mockReset().mockImplementation(async (project, request) => {
    const proposed = request.proposal
    const result = proposed.mode === 'create'
      ? await savedCreates(project, proposed.values)
      : await savedUpdates(project, proposed.string_id, proposed.values)
    return projectedEntry(proposed, result)
  })
  vi.mocked(stringsApi.editorPreview).mockReset().mockImplementation(async (_project, proposed) => ({
    entry: projectedEntry(proposed), fingerprint: 'reviewed',
  }))
  toast.success.mockReset()
  toast.error.mockReset()
  vi.mocked(stringsApi.translateMemory).mockReset().mockImplementation((_project, body) => Promise.resolve({ source_text: body.source_text, matches: {} }))
})

async function generateAi() {
  const auto = screen.queryByRole('button', { name: 'Auto-translate' })
  if (auto) {
    await waitFor(() => expect((auto as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(auto)
  }
  const generate = await screen.findByRole('button', { name: /^Generate .*AI$/ })
  await waitFor(() => expect((generate as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(generate)
}

describe('translation memory in the editor', () => {
  beforeEach(() => {
    polyfillPointer()
    vi.mocked(savedUpdates).mockReset().mockResolvedValue({} as never)
    vi.mocked(stringsApi.translatePreview).mockReset().mockResolvedValue({ translations: { ja: 'AI Japanese' }, scores: { ja: 88 } })
  })

  it.each(['', 'Historical translation'])('clears memory selection when History restores %j with the same source', async (restoredText) => {
    vi.mocked(stringsApi.translateMemory).mockResolvedValue({ source_text: 'Ghi chú', matches: { en: [memoryMatch] } })
    vi.mocked(stringsApi.get).mockResolvedValue({
      ...draftEntry(),
      translations: [{ id: 't-en', locale: 'en', value: restoredText, confidence: null, published_value: null, updated_at: null }],
    })
    vi.mocked(stringsApi.translatePreview).mockResolvedValue({ translations: { en: 'Generated after restore' }, scores: {} })
    renderDialog({ entry: draftEntry() })
    await screen.findByText('Exact match')
    fireEvent.click(screen.getByRole('button', { name: 'Use en match from published.greeting' }))
    expect((screen.getByRole('button', { name: /^Generate .*AI$/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: 'History' }))
    fireEvent.click(screen.getByRole('button', { name: 'Restore previous version' }))
    await waitFor(() => expect(stringsApi.get).toHaveBeenCalledWith('proj-1', 'str-1'))
    fireEvent.click(screen.getByRole('radio', { name: 'Details' }))
    await waitFor(() => expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe(restoredText))
    fireEvent.click(screen.getByRole('button', { name: /^Generate .*AI$/ }))
    await waitFor(() => expect(stringsApi.translatePreview).toHaveBeenCalledWith('proj-1', expect.objectContaining({ locales: ['en'] })))
    await waitFor(() => expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('Generated after restore'))
  })

  it('offers memory on open, saves explicitly, and skips just the selected AI locale', async () => {
    vi.mocked(stringsApi.translateMemory).mockResolvedValue({ source_text: 'Ghi chú', matches: { en: [memoryMatch] } })
    renderDialog({ entry: draftEntry(), targetLocales: ['en', 'ja'] })
    await screen.findByText('Exact match')
    expect(stringsApi.translatePreview).not.toHaveBeenCalled()
    expect(await screen.findByText('Exact match')).toBeTruthy()
    expect(screen.getByText('account', { exact: false })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use en match from published.greeting' }))
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('Published note')
    expect(savedUpdates).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /^Generate .*AI$/ }))
    await waitFor(() => expect(stringsApi.translatePreview).toHaveBeenCalledWith('proj-1', expect.objectContaining({ locales: ['ja'] })))
    await waitFor(() => expect((screen.getByLabelText('ja') as HTMLTextAreaElement).value).toBe('AI Japanese'))
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(savedUpdates).toHaveBeenCalledWith('proj-1', 'str-1', expect.objectContaining({
      translations: { en: 'Published note', ja: 'AI Japanese' }, translation_scores: { ja: 88 },
      expected: expect.objectContaining({ source_text: 'Ghi chú' }),
    })))
  })

  it('shows QA errors before Use and allows a memory-only save without confidence', async () => {
    const issue = { code: 'placeholder_missing', severity: 'error' as const, message: 'Missing placeholder {name}', start: null, end: null, detail: null }
    vi.mocked(stringsApi.translateMemory).mockResolvedValue({ source_text: 'Ghi chú', matches: { en: [{ ...memoryMatch, issues: [issue] }] } })
    const entry = { ...draftEntry(), translations: [{ id: 't', locale: 'en', value: 'Old AI text', confidence: 90, published_value: null, updated_at: null }] }
    renderDialog({ entry })
    await screen.findByText('Exact match')
    expect(await screen.findByRole('button', { name: /en match from published.greeting.*1 error/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use en match from published.greeting' }))
    expect((screen.getByRole('button', { name: /^Generate .*AI$/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(savedUpdates).toHaveBeenCalledWith('proj-1', 'str-1', {
      translations: { en: 'Published note' }, translation_scores: { en: null },
      expected: { source_text: 'Ghi chú', translations: { en: 'Old AI text' }, translation_scores: { en: 90 } },
    }))
    expect(stringsApi.translatePreview).not.toHaveBeenCalled()
  })

  it('refreshes memory automatically after source edits settle', async () => {
    vi.mocked(stringsApi.translateMemory).mockResolvedValue({ source_text: 'Ghi chú', matches: { en: [memoryMatch] } })
    renderDialog({ entry: draftEntry() })
    await screen.findByText('Exact match')
    fireEvent.change(screen.getByLabelText('Source text'), { target: { value: 'New source' } })
    fireEvent.change(screen.getByLabelText('Source text'), { target: { value: 'New source text' } })
    expect(stringsApi.translateMemory).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Exact match')).toBeTruthy()
    expect((screen.getByRole('button', { name: /^Generate .*AI$/ }) as HTMLButtonElement).disabled).toBe(false)
    const use = screen.getByRole('button', { name: 'Use en match from published.greeting' }) as HTMLButtonElement
    const exact = screen.getByRole('button', { name: 'Use 1 exact' }) as HTMLButtonElement
    expect(use.disabled).toBe(true)
    expect(exact.disabled).toBe(true)
    fireEvent.click(use)
    fireEvent.click(exact)
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('')
    vi.mocked(stringsApi.translateMemory).mockResolvedValue({ source_text: 'New source text', matches: {} })
    await waitFor(() => expect(stringsApi.translateMemory).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('Exact match')).toBeNull())
    expect((screen.getByRole('button', { name: /^Generate .*AI$/ }) as HTMLButtonElement).disabled).toBe(false)
    expect(stringsApi.translatePreview).not.toHaveBeenCalled()
    expect(stringsApi.translateMemory).toHaveBeenLastCalledWith('proj-1', expect.objectContaining({ source_text: 'New source text', expected_source_text: 'Ghi chú' }))
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
  })

  it('retries a failed lookup without blocking AI', async () => {
    vi.mocked(stringsApi.translateMemory)
      .mockRejectedValueOnce(new Error('Memory unavailable'))
      .mockResolvedValue({ source_text: 'Ghi chú', matches: { en: [memoryMatch] } })
    renderDialog({ entry: draftEntry() })
    expect(await screen.findByText('Could not load published translations.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^Generate .*AI$/ }))
    await waitFor(() => expect(stringsApi.translatePreview).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await screen.findByText('Exact match')
    expect(stringsApi.translateMemory).toHaveBeenCalledTimes(2)
  })

  it('uses all exact locales and undoes their text and confidence without changing description', async () => {
    const entry = { ...draftEntry(), translations: [{ id: 't', locale: 'en', value: 'Old AI', confidence: 90, published_value: null, updated_at: null }] }
    vi.mocked(stringsApi.translateMemory).mockResolvedValue({ source_text: entry.source_text, matches: { en: [memoryMatch], ja: [{ ...memoryMatch, translation: 'Published Japanese' }] } })
    renderDialog({ entry, targetLocales: ['en', 'ja'] })
    fireEvent.click(await screen.findByRole('button', { name: 'Use 2 exact' }))
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('Published note')
    expect((screen.getByLabelText('ja') as HTMLTextAreaElement).value).toBe('Published Japanese')
    expect((screen.getByRole('button', { name: 'Generate 0 with AI' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Keep this context' } })
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('Old AI')
    expect((screen.getByLabelText('ja') as HTMLTextAreaElement).value).toBe('')
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('Keep this context')
    expect(screen.getByLabelText(/Model estimate 90\/100/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Generate with AI' }) as HTMLButtonElement).disabled).toBe(false)
  })

})

describe('StringFormDialog inline catalog create', () => {
  beforeEach(() => {
    polyfillPointer()
    vi.mocked(modulesApi.create).mockReset().mockResolvedValue(createdModule)
    vi.mocked(tagsApi.create).mockReset().mockResolvedValue(createdTag)
    vi.mocked(savedCreates).mockReset().mockResolvedValue({} as never)
    vi.mocked(savedUpdates).mockReset().mockResolvedValue({} as never)
    vi.mocked(stringsApi.translatePreview).mockReset().mockResolvedValue({ translations: { en: 'Hello' }, scores: {} })
    toast.success.mockReset()
    toast.error.mockReset()
  })

  it('keeps Add string open and selects a module created from New', async () => {
    const { onClose, onSuccess } = renderDialog()

    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'auth.login' } })
    fireEvent.change(screen.getByLabelText('Source text'), { target: { value: 'Log in' } })

    fireEvent.click(screen.getAllByRole('button', { name: 'New' })[0])
    fireEvent.change(await screen.findByLabelText('Slug'), { target: { value: 'auth' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Auth' } })
    fireEvent.change(screen.getByLabelText('Translation context (optional)'), { target: { value: 'Use product terms' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(modulesApi.create).toHaveBeenCalledWith('proj-1', {
        slug: 'auth',
        name: 'Auth',
        description: '',
        translation_context: 'Use product terms',
      })
    })
    await waitFor(() => {
      expect(screen.queryByText('New module')).toBeNull()
    })

    expect(screen.getByText('Add string')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(savedCreates).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(screen.getByLabelText('Module').textContent).toContain('Auth')
    })

    await generateAi()
    await waitFor(() => expect(stringsApi.translatePreview).toHaveBeenCalledWith('proj-1', expect.objectContaining({ module_id: 'mod-new' })))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save as draft' }) as HTMLButtonElement).disabled).toBe(false))

    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => {
      expect(savedCreates).toHaveBeenCalledWith(
        'proj-1',
        expect.objectContaining({
          key: 'auth.login',
          source_text: 'Log in',
          module_id: 'mod-new',
        }),
      )
    })

    document.body.tabIndex = -1
    document.body.focus()
    fireEvent.focusIn(document.body)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('previews with the current module selection and explicit null when unassigned', async () => {
    renderDialog({ modules: [createdModule] })
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'greeting' } })
    fireEvent.change(screen.getByLabelText('Source text'), { target: { value: 'Hello' } })
    fireEvent.click(screen.getByLabelText('Module'))
    fireEvent.click(await screen.findByRole('option', { name: 'Auth' }))
    await generateAi()
    await waitFor(() => expect(stringsApi.translatePreview).toHaveBeenLastCalledWith('proj-1', expect.objectContaining({ module_id: 'mod-new' })))
    await waitFor(() => expect((screen.getByRole('button', { name: /^Generate .*AI$/ }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByLabelText('Module'))
    fireEvent.click(await screen.findByRole('option', { name: '— None —' }))
    await generateAi()
    await waitFor(() => expect(stringsApi.translatePreview).toHaveBeenLastCalledWith('proj-1', expect.objectContaining({ module_id: null })))
    expect(savedCreates).not.toHaveBeenCalled()
  })

  it('keeps Add string open and selects a tag created from New', async () => {
    const { onClose, onSuccess } = renderDialog()

    fireEvent.click(screen.getAllByRole('button', { name: 'New' })[1])
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'ios' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(tagsApi.create).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(screen.queryByText('New tag')).toBeNull()
    })

    expect(screen.getByText('Add string')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByLabelText('Tag').textContent).toContain('ios')
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(savedCreates).not.toHaveBeenCalled()
  })

  it('selects and clears a tag via the dropdown', async () => {
    const a = { ...createdTag, id: 'a', name: 'Alpha' }
    renderDialog({ tags: [a] })

    fireEvent.click(screen.getByLabelText('Tag'))
    fireEvent.click(await screen.findByRole('option', { name: 'Alpha' }))
    expect(screen.getByLabelText('Tag').textContent).toContain('Alpha')

    fireEvent.click(screen.getByLabelText('Tag'))
    fireEvent.click(await screen.findByRole('option', { name: '— None —' }))
    expect(screen.getByLabelText('Tag').textContent).toContain('— None —')
  })

  it('closes only the popover when New is cancelled', async () => {
    const { onClose } = renderDialog()

    fireEvent.click(screen.getAllByRole('button', { name: 'New' })[0])
    expect(await screen.findByText('New module')).toBeTruthy()
    const popover = screen.getByText('New module').closest('[data-slot="popover-content"]')
    expect(popover).toBeTruthy()
    fireEvent.click(within(popover as HTMLElement).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByText('New module')).toBeNull()
    })
    expect(screen.getByText('Add string')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('still saves the string from Create string', async () => {
    const { onClose, onSuccess } = renderDialog()

    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'home.title' } })
    fireEvent.change(screen.getByLabelText('Source text'), { target: { value: 'Home' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))

    await waitFor(() => {
      expect(savedCreates).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled()
    })
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('editor publication collisions', () => {
  it.each([false, true])('uses the structured key and preserves entered values (edit=%s)', async (edit) => {
    vi.mocked(stringsApi.editorSave).mockRejectedValue(new ApiError(409, 'Unhelpful message', {
      detail: { code: 'published_key_conflict', key: 'save' },
    }))
    const { onClose, onSuccess } = renderDialog({ entry: edit ? draftEntry() : null })
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'save' } })
    fireEvent.change(screen.getByLabelText('Source text'), { target: { value: 'Lưu' } })
    fireEvent.click(screen.getByRole('button', { name: edit ? 'Publish changes' : 'Create and publish' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(PUBLISHED_KEY_CONFLICT))
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Back to editing' }))
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('save')
    expect(screen.queryByRole('switch', { name: 'Published' })).toBeNull()
  })
})

describe('StringFormDialog stale saves', () => {
  function sharedEntry(): StringEntry {
    return {
      ...draftEntry(),
      translations: ['en', 'fr'].map((locale) => ({
        id: `t-${locale}`, locale, value: locale === 'en' ? 'Hello' : 'Bonjour',
        confidence: null, published_value: null, updated_at: null,
      })),
    }
  }

  function staleSave(current: StringEntry, fields = ['translations.en']) {
    return new ApiError(409, 'Review the latest saved values.', {
      detail: { code: 'stale_editor_save', fields, current },
    })
  }

  beforeEach(() => {
    polyfillPointer()
    vi.mocked(savedUpdates).mockReset().mockResolvedValue({} as never)
    toast.success.mockReset()
    toast.error.mockReset()
  })

  it.each(['Use latest values', 'Keep my changes'])('updates only conflicting memory markers after %s', async (choice) => {
    const entry = sharedEntry()
    const current = { ...entry, translations: [{ ...entry.translations[0], value: '' }, entry.translations[1]] }
    vi.mocked(stringsApi.translateMemory).mockResolvedValue({
      source_text: entry.source_text,
      matches: { en: [memoryMatch], fr: [{ ...memoryMatch, translation: 'Published French' }] },
    })
    vi.mocked(stringsApi.translatePreview).mockReset().mockResolvedValue({ translations: { en: 'Generated after conflict' }, scores: {} })
    vi.mocked(savedUpdates).mockRejectedValueOnce(staleSave(current))
    renderDialog({ entry, targetLocales: ['en', 'fr'] })
    for (const locale of ['en', 'fr']) {
      fireEvent.click(await screen.findByRole('button', { name: `Use ${locale} match from published.greeting` }))
    }
    expect((screen.getByRole('button', { name: /^Generate .*AI$/ }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    fireEvent.click(await screen.findByRole('button', { name: choice }))
    expect((screen.getByLabelText('fr') as HTMLTextAreaElement).value).toBe('Published French')
    const useLatest = choice === 'Use latest values'
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe(useLatest ? '' : 'Published note')
    expect((screen.getByRole('button', { name: /^Generate .*AI$/ }) as HTMLButtonElement).disabled).toBe(!useLatest)
    if (useLatest) {
      fireEvent.click(screen.getByRole('button', { name: /^Generate .*AI$/ }))
      await waitFor(() => expect(stringsApi.translatePreview).toHaveBeenCalledWith('proj-1', expect.objectContaining({ locales: ['en'] })))
      await waitFor(() => expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('Generated after conflict'))
      expect((screen.getByLabelText('fr') as HTMLTextAreaElement).value).toBe('Published French')
    } else {
      expect(stringsApi.translatePreview).not.toHaveBeenCalled()
    }
  })

  it.each(['Use latest values', 'Keep my changes'])('reviews text and confidence together before %s', async (choice) => {
    const entry = sharedEntry()
    entry.translations[0].confidence = 80
    const current = { ...entry, translations: [{ ...entry.translations[0], confidence: 95 }, entry.translations[1]] }
    vi.mocked(stringsApi.translatePreview).mockResolvedValue({
      translations: { en: 'Bob new text' }, scores: { en: 90 },
    })
    vi.mocked(savedUpdates).mockRejectedValueOnce(staleSave(current, ['translation_scores.en']))
    renderDialog({ entry })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Bob context' } })
    await generateAi()
    await waitFor(() => expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('Bob new text'))
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await screen.findByText('Another save changed this string')
    expect(screen.getByText('Your value: Bob new text')).toBeTruthy()
    expect(screen.getByText('Latest saved: Hello')).toBeTruthy()
    expect(screen.getByText('Your value: 90')).toBeTruthy()
    expect(screen.getByText('Latest saved: 95')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: choice }))
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe(choice === 'Use latest values' ? 'Hello' : 'Bob new text')
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe('Bob context')
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(savedUpdates).toHaveBeenCalledTimes(2))
    expect(savedUpdates).toHaveBeenLastCalledWith('proj-1', 'str-1', choice === 'Use latest values' ? {
      description: 'Bob context', expected: { description: null },
    } : {
      description: 'Bob context', translations: { en: 'Bob new text' }, translation_scores: { en: 90 },
      expected: { source_text: 'Ghi chú', description: null, translations: { en: 'Hello' }, translation_scores: { en: 95 } },
    })
  })

  it.each(['Use latest values', 'Keep my changes'])('preserves the chosen tag set after %s', async (choice) => {
    const a = { ...createdTag, id: 'a', name: 'A' }
    const b = { ...createdTag, id: 'b', name: 'B' }
    const c = { ...createdTag, id: 'c', name: 'C' }
    const entry = { ...sharedEntry(), tags: [a] }
    const current = { ...entry, tags: [b, c] }
    vi.mocked(savedUpdates).mockRejectedValueOnce(staleSave(current, ['tag_ids']))
    renderDialog({ entry, tags: [a, b, c] })
    fireEvent.click(screen.getByLabelText('Tag'))
    fireEvent.click(await screen.findByRole('option', { name: 'B' }))
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Bob context' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await screen.findByText('Another save changed this string')
    expect(savedUpdates).toHaveBeenLastCalledWith('proj-1', 'str-1', {
      description: 'Bob context', tag_ids: ['b'], expected: { description: null, tag_ids: ['a'] },
    })
    fireEvent.click(screen.getByRole('button', { name: choice }))
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(savedUpdates).toHaveBeenCalledTimes(2))
    expect(savedUpdates).toHaveBeenLastCalledWith('proj-1', 'str-1', choice === 'Use latest values' ? {
      description: 'Bob context', expected: { description: null },
    } : {
      description: 'Bob context', tag_ids: ['b'], expected: { description: null, tag_ids: ['b', 'c'] },
    })
  })

  it('sends only a changed description and preserves all tags and locales', async () => {
    const entry = { ...sharedEntry(), tags: [createdTag, { ...createdTag, id: 'second-tag' }] }
    renderDialog({ entry, targetLocales: ['en', 'fr'] })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Bob context' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(savedUpdates).toHaveBeenCalledWith('proj-1', 'str-1', {
      description: 'Bob context', expected: { description: null },
    }))
  })

  it('sends only the edited locale, including clearing its value', async () => {
    renderDialog({ entry: sharedEntry(), targetLocales: ['en', 'fr'] })
    fireEvent.change(screen.getByLabelText('en'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(savedUpdates).toHaveBeenCalledWith('proj-1', 'str-1', {
      translations: { en: '' }, expected: { source_text: 'Ghi chú', translations: { en: 'Hello' } },
    }))
  })

  it('does not normalize untouched metadata while saving a translation', async () => {
    const entry = { ...sharedEntry(), key: ' note ', source_text: ' Source ', description: ' Context ' }
    renderDialog({ entry })
    fireEvent.change(screen.getByLabelText('en'), { target: { value: 'New English' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(savedUpdates).toHaveBeenCalledWith('proj-1', 'str-1', {
      translations: { en: 'New English' }, expected: { source_text: ' Source ', translations: { en: 'Hello' } },
    }))
  })

  it('retains input on conflict and retries against the reviewed value only', async () => {
    const current = sharedEntry()
    current.description = 'Alice context'
    current.translations[0].value = 'Alice English'
    current.translations[1].value = 'Alice French'
    vi.mocked(savedUpdates).mockRejectedValueOnce(staleSave(current))
    const { onClose, onSuccess } = renderDialog({ entry: sharedEntry(), targetLocales: ['en', 'fr'] })
    fireEvent.change(screen.getByLabelText('en'), { target: { value: 'Bob English' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await screen.findByText('Another save changed this string')
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('Bob English')
    expect(screen.getByText('Latest saved: Alice English')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save as draft' }) as HTMLButtonElement).disabled).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep my changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(savedUpdates).toHaveBeenLastCalledWith('proj-1', 'str-1', {
      translations: { en: 'Bob English' }, expected: { source_text: 'Ghi chú', translations: { en: 'Alice English' } },
    }))
  })

  it('uses latest conflicting values while keeping unrelated unsaved input', async () => {
    const current = sharedEntry()
    current.translations[0].value = 'Alice English'
    vi.mocked(savedUpdates).mockRejectedValueOnce(staleSave(current))
    renderDialog({ entry: sharedEntry(), targetLocales: ['en', 'fr'] })
    fireEvent.change(screen.getByLabelText('en'), { target: { value: 'Bob English' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Bob context' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use latest values' }))
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('Alice English')
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe('Bob context')
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(savedUpdates).toHaveBeenLastCalledWith('proj-1', 'str-1', {
      description: 'Bob context', expected: { description: null },
    }))
  })

  it('requires reviewing a new conflict if another editor saves again', async () => {
    const alice = sharedEntry()
    alice.translations[0].value = 'Alice English'
    const carol = sharedEntry()
    carol.translations[0].value = 'Carol English'
    vi.mocked(savedUpdates)
      .mockRejectedValueOnce(staleSave(alice))
      .mockRejectedValueOnce(staleSave(carol))
    renderDialog({ entry: sharedEntry() })
    fireEvent.change(screen.getByLabelText('en'), { target: { value: 'Bob English' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Keep my changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await screen.findByText('Latest saved: Carol English')
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('Bob English')
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('StringFormDialog translation QA', () => {
  beforeEach(() => {
    polyfillPointer()
    vi.mocked(stringsApi.translateQa).mockReset().mockResolvedValue({ locale: 'en', issues: [] })
  })

  it('checks a manual edit after a pause and leaves Save enabled', async () => {
    vi.useFakeTimers()
    vi.mocked(stringsApi.translateQa).mockResolvedValue({
      locale: 'en',
      issues: [{
        code: 'placeholder_missing',
        severity: 'error',
        message: 'Missing placeholder {name} (source has 1, translation has 0).',
        start: null,
        end: null,
        detail: { token: '{name}', source_count: 1, translation_count: 0 },
      }],
    })
    try {
      renderDialog({ entry: { ...draftEntry(), source_text: 'Hello {name}' } })
      expect(screen.queryByText('No QA issues')).toBeNull()
      expect(screen.getByText('QA re-checks a translation shortly after you stop typing. It never blocks Save.')).toBeTruthy()
      fireEvent.change(screen.getByLabelText('en'), { target: { value: 'Hello' } })
      expect(screen.getByText('Checking…')).toBeTruthy()
      await act(async () => { await vi.advanceTimersByTimeAsync(499) })
      expect(stringsApi.translateQa).not.toHaveBeenCalled()
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(vi.mocked(stringsApi.translateQa).mock.calls[0][1]).toEqual({
        source_text: 'Hello {name}',
        translation: 'Hello',
        locale: 'en',
      })
      fireEvent.click(screen.getByRole('button', { name: /QA for en/ }))
      const popover = document.querySelector('[data-slot="popover-content"]') as HTMLElement
      expect(within(popover).getByText('Missing placeholder {name} (source has 1, translation has 0).')).toBeTruthy()
      expect(within(popover).getByText('Advisory only. You can still save.')).toBeTruthy()
      const field = screen.getByLabelText('en') as HTMLTextAreaElement
      expect(field.getAttribute('aria-describedby')).toBe('qa-edit-en')
      expect(document.getElementById('qa-edit-en')?.getAttribute('aria-live')).toBe('polite')
      expect(field.getAttribute('aria-invalid')).toBeNull()
      expect((screen.getByRole('button', { name: 'Save as draft' }) as HTMLButtonElement).disabled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows preview issues immediately, including a grouped placeholder change', async () => {
    vi.mocked(stringsApi.translatePreview).mockResolvedValue({
      translations: { en: 'Save {price, number, percent}' },
      scores: { en: 88 },
      issues: {
        en: [
          {
            code: 'placeholder_missing',
            severity: 'error',
            message: 'Missing placeholder {price, number} (source has 1, translation has 0).',
            start: null,
            end: null,
            detail: { token: '{price, number}', source_count: 1, translation_count: 0 },
          },
          {
            code: 'placeholder_extra',
            severity: 'error',
            message: 'Extra placeholder {price, number, percent} (source has 0, translation has 1).',
            start: null,
            end: null,
            detail: { token: '{price, number, percent}', source_count: 0, translation_count: 1 },
          },
        ],
      },
    })
    renderDialog({ entry: { ...draftEntry(), source_text: 'Save {price, number}' } })
    fireEvent.change(screen.getByLabelText('Source text'), { target: { value: 'Save {price, number}' } })
    await generateAi()
    fireEvent.click(await screen.findByRole('button', { name: /QA for en/ }))
    const popover = document.querySelector('[data-slot="popover-content"]') as HTMLElement
    expect(within(popover).getByText('Placeholder price changed from {price, number} to {price, number, percent}.')).toBeTruthy()
    expect(within(popover).getByText('Advisory only. You can still save.')).toBeTruthy()
    expect(screen.queryByText(/Missing placeholder/)).toBeNull()
    expect(stringsApi.translateQa).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Save as draft' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('compact editor save and review', () => {
  beforeEach(polyfillPointer)

  it('hands off the newly created draft to the catalog', async () => {
    const saved = { ...draftEntry(), key: 'new-key', source_text: 'New source' }
    vi.mocked(stringsApi.editorSave).mockResolvedValueOnce(saved)
    const { onSaved, onSuccess } = renderDialog()
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: saved.key } })
    fireEvent.change(screen.getByLabelText('Source text'), { target: { value: saved.source_text } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved))
    expect(onSuccess).toHaveBeenCalledTimes(1)
  })

  it('reviews complete content without writing, and Back keeps input and invalidates review', async () => {
    const complete = { ...draftEntry(), translations: [
      { id: 'en', locale: 'en', value: 'Local English', published_value: null, confidence: 90, updated_at: null },
      { id: 'fr', locale: 'fr', value: 'Other saved locale', published_value: null, confidence: null, updated_at: null },
    ] }
    vi.mocked(stringsApi.editorPreview).mockResolvedValue({ entry: complete, fingerprint: 'first' })
    renderDialog({ entry: { ...draftEntry(), translations: [] } })
    const stepper = () => screen.getByRole('group', { name: 'Translation progress' })
    expect(within(stepper()).getByText('Translate').closest('[aria-current="step"]')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('en'), { target: { value: 'Local English' } })
    expect(within(stepper()).getByText('Review').closest('[aria-current="step"]')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Publish changes' }))
    const full = await screen.findByRole('region', { name: 'Complete proposed public content' })
    expect(within(stepper()).getByText('Publish').closest('[aria-current="step"]')).toBeTruthy()
    expect(within(full).getByText('Other saved locale')).toBeTruthy()
    expect(stringsApi.editorSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Back to editing' }))
    expect(within(stepper()).getByText('Review').closest('[aria-current="step"]')).toBeTruthy()
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('Local English')
    fireEvent.change(screen.getByLabelText('en'), { target: { value: 'Revised English' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish changes' }))
    await waitFor(() => expect(stringsApi.editorPreview).toHaveBeenCalledTimes(2))
    expect(stringsApi.editorSave).not.toHaveBeenCalled()
  })

  it('submits the reviewed proposal and requires renewed confirmation after staleness', async () => {
    vi.mocked(stringsApi.editorPreview)
      .mockResolvedValueOnce({ entry: draftEntry(), fingerprint: 'first' })
      .mockResolvedValueOnce({ entry: { ...draftEntry(), source_text: 'Latest source' }, fingerprint: 'second' })
    vi.mocked(stringsApi.editorSave).mockRejectedValueOnce(new ApiError(409, 'Changed', {
      detail: { code: 'publish_fingerprint_mismatch' },
    })).mockResolvedValueOnce({ ...draftEntry(), status: 'public', published_key: 'note' })
    const { onSaved } = renderDialog({ entry: draftEntry() })
    fireEvent.click(screen.getByRole('button', { name: 'Publish changes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(stringsApi.editorPreview).toHaveBeenCalledTimes(2))
    await screen.findAllByText('Latest source')
    expect(stringsApi.editorSave).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(stringsApi.editorSave).toHaveBeenLastCalledWith('proj-1', {
      action: 'publish', fingerprint: 'second', proposal: { mode: 'update', string_id: 'str-1', values: { expected: {} } },
    }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'str-1', status: 'public' })))
  })

  it('disables publication of an in-sync public string while allowing draft saves', async () => {
    const entry = { ...draftEntry(), status: 'public' as const, published_key: 'note', published_source_text: 'Ghi chú' }
    vi.mocked(stringsApi.editorPreview).mockResolvedValue({ entry, fingerprint: 'sync' })
    renderDialog({ entry })
    fireEvent.click(screen.getByRole('button', { name: 'Publish changes' }))
    const publish = await screen.findByRole('button', { name: 'Nothing to publish' })
    expect((publish as HTMLButtonElement).disabled).toBe(true)
    expect(stringsApi.editorSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Back to editing' }))
    expect((screen.getByRole('button', { name: 'Save as draft' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('unpublishes separately without saving or discarding local edits', async () => {
    const entry = { ...draftEntry(), status: 'public' as const, published_key: 'note' }
    vi.mocked(stringsApi.batch).mockResolvedValue({ affected: 1, batch_id: 'batch' })
    vi.mocked(stringsApi.get).mockResolvedValue({ ...entry, status: 'draft' })
    renderDialog({ entry })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Unsaved context' } })
    fireEvent.click(screen.getByRole('button', { name: 'Unpublish' }))
    const confirm = await screen.findByRole('alertdialog')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Unpublish' }))
    await waitFor(() => expect(stringsApi.batch).toHaveBeenCalledWith('proj-1', { action: 'unpublish', string_ids: ['str-1'] }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe('Unsaved context')
    expect(stringsApi.editorSave).not.toHaveBeenCalled()
  })
})
