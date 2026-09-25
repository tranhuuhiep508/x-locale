import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { modulesApi, tagsApi } from '@/lib/api/catalog'
import { stringsApi } from '@/lib/api/strings'
import type { Module, Tag } from '@/lib/api/types'
import StringFormDialog from './StringFormDialog'

vi.mock('@/lib/toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
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

function renderDialog(
  overrides: {
    onClose?: () => void
    onSuccess?: () => void
    modules?: Module[]
    tags?: Tag[]
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
  })

  it('preserves entered values after a failed save and allows retry', async () => {
    vi.mocked(stringsApi.create)
      .mockRejectedValueOnce(new Error('Temporary save failure'))
      .mockResolvedValueOnce({} as never)
    const { onClose, onSuccess } = renderDialog()
    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'retry.key' } })
    fireEvent.change(screen.getByLabelText('Source text'), { target: { value: 'Retry source' } })

    fireEvent.click(screen.getByRole('button', { name: 'Create string' }))
    await waitFor(() => expect(stringsApi.create).toHaveBeenCalledTimes(1))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Create string' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByLabelText('Key')).toHaveProperty('value', 'retry.key')
    expect(screen.getByLabelText('Source text')).toHaveProperty('value', 'Retry source')
    expect(onClose).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Create string' }))
    await waitFor(() => expect(stringsApi.create).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
  })

  it('keeps Add string open and selects a module created from New', async () => {
    const { onClose, onSuccess } = renderDialog()

    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'auth.login' } })
    fireEvent.change(screen.getByLabelText('Source text'), { target: { value: 'Log in' } })

    fireEvent.click(screen.getAllByRole('button', { name: 'New' })[0])
    fireEvent.change(await screen.findByLabelText('Slug'), { target: { value: 'auth' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Auth' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(modulesApi.create).toHaveBeenCalledWith('proj-1', {
        slug: 'auth',
        name: 'Auth',
        description: '',
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
