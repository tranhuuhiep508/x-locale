import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { modulesApi, tagsApi } from '@/lib/api/catalog'
import { ApiError } from '@/lib/api/client'
import { stringsApi } from '@/lib/api/strings'
import type { Module, StringEntry, Tag } from '@/lib/api/types'
import { TooltipProvider } from '@/components/ui/tooltip'
import StringFormDialog from './StringFormDialog'

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

vi.mock('@/lib/api/strings', () => ({
  stringsApi: {
    create: vi.fn(),
    update: vi.fn(),
    translatePreview: vi.fn(),
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

function publishedKeyConflict() {
  return new ApiError(409, PUBLISHED_KEY_CONFLICT, {
    detail: {
      code: 'published_key_conflict',
      message: PUBLISHED_KEY_CONFLICT,
      key: 'save',
    },
  })
}

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
    />,
    { wrapper },
  )
  return { onClose, onSuccess }
}

describe('StringFormDialog inline catalog create', () => {
  beforeEach(() => {
    polyfillPointer()
    vi.mocked(modulesApi.create).mockReset().mockResolvedValue(createdModule)
    vi.mocked(tagsApi.create).mockReset().mockResolvedValue(createdTag)
    vi.mocked(stringsApi.create).mockReset().mockResolvedValue({} as never)
    vi.mocked(stringsApi.update).mockReset().mockResolvedValue({} as never)
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
    expect(stringsApi.create).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(screen.getByRole('combobox').textContent).toContain('Auth')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Auto-translate' }))
    await waitFor(() => expect(stringsApi.translatePreview).toHaveBeenCalledWith('proj-1', expect.objectContaining({ module_id: 'mod-new' })))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Create string' }) as HTMLButtonElement).disabled).toBe(false))

    fireEvent.click(screen.getByRole('button', { name: 'Create string' }))
    await waitFor(() => {
      expect(stringsApi.create).toHaveBeenCalledWith(
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
    fireEvent.click(screen.getByRole('button', { name: 'Auto-translate' }))
    await waitFor(() => expect(stringsApi.translatePreview).toHaveBeenLastCalledWith('proj-1', expect.objectContaining({ module_id: 'mod-new' })))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Auto-translate' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByLabelText('Module'))
    fireEvent.click(await screen.findByRole('option', { name: '— None —' }))
    fireEvent.click(screen.getByRole('button', { name: 'Auto-translate' }))
    await waitFor(() => expect(stringsApi.translatePreview).toHaveBeenLastCalledWith('proj-1', expect.objectContaining({ module_id: null })))
    expect(stringsApi.create).not.toHaveBeenCalled()
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
    expect(screen.getByRole('radio', { name: 'ios' }).getAttribute('data-state')).toBe('on')
    expect(onClose).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(stringsApi.create).not.toHaveBeenCalled()
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
    fireEvent.click(screen.getByRole('button', { name: 'Create string' }))

    await waitFor(() => {
      expect(stringsApi.create).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled()
    })
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('Published toggle published_key_conflict', () => {
  beforeEach(() => {
    polyfillPointer()
    vi.mocked(stringsApi.create).mockReset()
    vi.mocked(stringsApi.update).mockReset()
    toast.success.mockReset()
    toast.error.mockReset()
  })

  it('shows the server message on create and does not publish the string', async () => {
    vi.mocked(stringsApi.create).mockRejectedValue(publishedKeyConflict())
    const { onClose, onSuccess } = renderDialog()

    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'save' } })
    fireEvent.change(screen.getByLabelText('Source text'), { target: { value: 'Lưu' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Published' }))
    expect(screen.getByRole('switch', { name: 'Published' }).getAttribute('aria-checked')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Create string' }))

    await waitFor(() => {
      expect(stringsApi.create).toHaveBeenCalledWith(
        'proj-1',
        expect.objectContaining({ key: 'save', status: 'public' }),
      )
    })
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(PUBLISHED_KEY_CONFLICT)
    })
    expect(toast.success).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Add string')).toBeTruthy()
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('save')
    expect(screen.getByRole('switch', { name: 'Published' }).getAttribute('aria-checked')).toBe('true')
  })

  it('shows the server message on edit and leaves the saved string unpublished', async () => {
    const entry = draftEntry()
    vi.mocked(stringsApi.update).mockRejectedValue(publishedKeyConflict())
    const { onClose, onSuccess } = renderDialog({ entry })

    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'save' } })
    fireEvent.click(screen.getByRole('switch', { name: 'Published' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(stringsApi.update).toHaveBeenCalledWith(
        'proj-1',
        'str-1',
        expect.objectContaining({ key: 'save', status: 'public' }),
      )
    })
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(PUBLISHED_KEY_CONFLICT)
    })
    expect(toast.success).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Edit string')).toBeTruthy()
    expect((screen.getByLabelText('Key') as HTMLInputElement).value).toBe('save')
    expect(screen.getByRole('switch', { name: 'Published' }).getAttribute('aria-checked')).toBe('true')
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
    vi.mocked(stringsApi.update).mockReset().mockResolvedValue({} as never)
    toast.success.mockReset()
    toast.error.mockReset()
  })

  it.each(['Use latest values', 'Keep my changes'])('reviews text and confidence together before %s', async (choice) => {
    const entry = sharedEntry()
    entry.translations[0].confidence = 80
    const current = { ...entry, translations: [{ ...entry.translations[0], confidence: 95 }, entry.translations[1]] }
    vi.mocked(stringsApi.translatePreview).mockResolvedValue({
      translations: { en: 'Bob new text' }, scores: { en: 90 },
    })
    vi.mocked(stringsApi.update).mockRejectedValueOnce(staleSave(current, ['translation_scores.en']))
    renderDialog({ entry })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Bob context' } })
    fireEvent.click(screen.getByRole('button', { name: 'Auto-translate' }))
    await waitFor(() => expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('Bob new text'))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText('Another save changed this string')
    expect(screen.getByText('Your value: Bob new text')).toBeTruthy()
    expect(screen.getByText('Latest saved: Hello')).toBeTruthy()
    expect(screen.getByText('Your value: 90')).toBeTruthy()
    expect(screen.getByText('Latest saved: 95')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: choice }))
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe(choice === 'Use latest values' ? 'Hello' : 'Bob new text')
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe('Bob context')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(stringsApi.update).toHaveBeenCalledTimes(2))
    expect(stringsApi.update).toHaveBeenLastCalledWith('proj-1', 'str-1', choice === 'Use latest values' ? {
      description: 'Bob context', expected: { description: null },
    } : {
      description: 'Bob context', translations: { en: 'Bob new text' }, translation_scores: { en: 90 },
      expected: { description: null, translations: { en: 'Hello' }, translation_scores: { en: 95 } },
    })
  })

  it.each(['Use latest values', 'Keep my changes'])('preserves the chosen tag set after %s', async (choice) => {
    const a = { ...createdTag, id: 'a', name: 'A' }
    const b = { ...createdTag, id: 'b', name: 'B' }
    const c = { ...createdTag, id: 'c', name: 'C' }
    const entry = { ...sharedEntry(), tags: [a] }
    const current = { ...entry, tags: [b, c] }
    vi.mocked(stringsApi.update).mockRejectedValueOnce(staleSave(current, ['tag_ids']))
    renderDialog({ entry, tags: [a, b, c] })
    fireEvent.click(screen.getByRole('radio', { name: 'B' }))
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Bob context' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText('Another save changed this string')
    expect(stringsApi.update).toHaveBeenLastCalledWith('proj-1', 'str-1', {
      description: 'Bob context', tag_ids: ['b'], expected: { description: null, tag_ids: ['a'] },
    })
    fireEvent.click(screen.getByRole('button', { name: choice }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(stringsApi.update).toHaveBeenCalledTimes(2))
    expect(stringsApi.update).toHaveBeenLastCalledWith('proj-1', 'str-1', choice === 'Use latest values' ? {
      description: 'Bob context', expected: { description: null },
    } : {
      description: 'Bob context', tag_ids: ['b'], expected: { description: null, tag_ids: ['b', 'c'] },
    })
  })

  it('sends only a changed description and preserves all tags and locales', async () => {
    const entry = { ...sharedEntry(), tags: [createdTag, { ...createdTag, id: 'second-tag' }] }
    renderDialog({ entry, targetLocales: ['en', 'fr'] })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Bob context' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(stringsApi.update).toHaveBeenCalledWith('proj-1', 'str-1', {
      description: 'Bob context', expected: { description: null },
    }))
  })

  it('sends only the edited locale, including clearing its value', async () => {
    renderDialog({ entry: sharedEntry(), targetLocales: ['en', 'fr'] })
    fireEvent.change(screen.getByLabelText('en'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(stringsApi.update).toHaveBeenCalledWith('proj-1', 'str-1', {
      translations: { en: '' }, expected: { translations: { en: 'Hello' } },
    }))
  })

  it('does not normalize untouched metadata while saving a translation', async () => {
    const entry = { ...sharedEntry(), key: ' note ', source_text: ' Source ', description: ' Context ' }
    renderDialog({ entry })
    fireEvent.change(screen.getByLabelText('en'), { target: { value: 'New English' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(stringsApi.update).toHaveBeenCalledWith('proj-1', 'str-1', {
      translations: { en: 'New English' }, expected: { translations: { en: 'Hello' } },
    }))
  })

  it('retains input on conflict and retries against the reviewed value only', async () => {
    const current = sharedEntry()
    current.description = 'Alice context'
    current.translations[0].value = 'Alice English'
    current.translations[1].value = 'Alice French'
    vi.mocked(stringsApi.update).mockRejectedValueOnce(staleSave(current))
    const { onClose, onSuccess } = renderDialog({ entry: sharedEntry(), targetLocales: ['en', 'fr'] })
    fireEvent.change(screen.getByLabelText('en'), { target: { value: 'Bob English' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await screen.findByText('Another save changed this string')
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('Bob English')
    expect(screen.getByText('Latest saved: Alice English')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true)
    expect(onClose).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Keep my changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(stringsApi.update).toHaveBeenLastCalledWith('proj-1', 'str-1', {
      translations: { en: 'Bob English' }, expected: { translations: { en: 'Alice English' } },
    }))
  })

  it('uses latest conflicting values while keeping unrelated unsaved input', async () => {
    const current = sharedEntry()
    current.translations[0].value = 'Alice English'
    vi.mocked(stringsApi.update).mockRejectedValueOnce(staleSave(current))
    renderDialog({ entry: sharedEntry(), targetLocales: ['en', 'fr'] })
    fireEvent.change(screen.getByLabelText('en'), { target: { value: 'Bob English' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Bob context' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use latest values' }))
    expect((screen.getByLabelText('en') as HTMLTextAreaElement).value).toBe('Alice English')
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe('Bob context')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(stringsApi.update).toHaveBeenLastCalledWith('proj-1', 'str-1', {
      description: 'Bob context', expected: { description: null },
    }))
  })

  it('requires reviewing a new conflict if another editor saves again', async () => {
    const alice = sharedEntry()
    alice.translations[0].value = 'Alice English'
    const carol = sharedEntry()
    carol.translations[0].value = 'Carol English'
    vi.mocked(stringsApi.update)
      .mockRejectedValueOnce(staleSave(alice))
      .mockRejectedValueOnce(staleSave(carol))
    renderDialog({ entry: sharedEntry() })
    fireEvent.change(screen.getByLabelText('en'), { target: { value: 'Bob English' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Keep my changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
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
      expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false)
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
    fireEvent.click(screen.getByRole('button', { name: 'Auto-translate' }))
    fireEvent.click(await screen.findByRole('button', { name: /QA for en/ }))
    const popover = document.querySelector('[data-slot="popover-content"]') as HTMLElement
    expect(within(popover).getByText('Placeholder price changed from {price, number} to {price, number, percent}.')).toBeTruthy()
    expect(within(popover).getByText('Advisory only. You can still save.')).toBeTruthy()
    expect(screen.queryByText(/Missing placeholder/)).toBeNull()
    expect(stringsApi.translateQa).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
