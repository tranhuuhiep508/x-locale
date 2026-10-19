import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { modulesApi, tagsApi } from '@/lib/api/catalog'
import { ApiError } from '@/lib/api/client'
import { stringsApi } from '@/lib/api/strings'
import type { Module, StringEntry, Tag } from '@/lib/api/types'
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
  } = {},
) {
  const onClose = overrides.onClose ?? vi.fn()
  const onSuccess = overrides.onSuccess ?? vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  render(
    <StringFormDialog
      projectId="proj-1"
      entry={overrides.entry}
      modules={overrides.modules ?? []}
      tags={overrides.tags ?? []}
      targetLocales={['en']}
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
