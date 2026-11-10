import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ApiError } from '@/lib/api/client'
import { stringsApi } from '@/lib/api/strings'
import type { Module, PasteReview, Project, StringEntry, Tag } from '@/lib/api/types'
import { AddManyStringsDialog } from './AddManyStringsDialog'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    search,
    onClick,
  }: {
    children: ReactNode
    to: string
    params: Record<string, string>
    search?: Record<string, string>
    onClick?: () => void
  }) => {
    const path = Object.entries(params).reduce((url, [k, v]) => url.replace('$' + k, v), to)
    const query = new URLSearchParams(search ?? {}).toString()
    return (
      <a
        href={query ? path + '?' + query : path}
        onClick={(e) => {
          e.preventDefault()
          onClick?.()
        }}
      >
        {children}
      </a>
    )
  },
}))

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/toast', () => ({ useToast: () => toast }))

vi.mock('@/lib/api/catalog', () => ({
  modulesApi: { create: vi.fn() },
  tagsApi: { create: vi.fn() },
}))

vi.mock('@/lib/api/strings', () => ({
  stringsApi: { pasteReview: vi.fn(), pasteSave: vi.fn(), translatePreviewBatch: vi.fn(), translateQa: vi.fn() },
}))

const project: Project = {
  can_change_base_language: false,
  id: 'proj-1',
  name: 'Demo App',
  slug: 'demo-app',
  base_language: 'vi',
  target_languages: ['en', 'ja'],
  layout: 'modular',
  allow_duplicate_keys: false,
  string_count: 10,
  created_at: null,
  updated_at: null,
  translation_context: null,
}

const modules: Module[] = [
  { id: 'mod-common', slug: 'common', name: 'Common', description: null, translation_context: null, position: 0, string_count: 4 },
]

const tags: Tag[] = [{ id: 'tag-ios', name: 'ios', color: '#2563eb', string_count: 0 }]

function entry(
  key: string,
  source: string,
  values: Record<string, string>,
  status: 'draft' | 'public' = 'draft'
): StringEntry {
  return {
    id: `id-${key}`,
    key,
    source_text: source,
    description: null,
    status,
    pending_delete: false,
    deleted_at: null,
    has_unpublished_changes: true,
    published_at: null,
    published_key: status === 'public' ? key : null,
    published_source_text: status === 'public' ? 'Cũ' : null,
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
    translations: Object.entries(values).map(([locale, value]) => ({
      id: null,
      updated_at: null,
      locale,
      value,
      published_value: status === 'public' ? 'Old' : null,
      confidence: null,
    })),
  }
}

const reviewed: PasteReview = {
  fingerprint: 'fp-1',
  items: [
    { key: 'save', mode: 'update', entry: entry('save', 'Lưu lại', { en: 'Save', ja: '' }, 'public') },
    { key: 'e2e_new', mode: 'create', entry: entry('e2e_new', 'Mới', { en: '', ja: '' }) },
  ],
}

const savedDraft = { action: 'draft' as const, created: 1, updated: 1, published: 0, batch_id: 'batch-1' }

function polyfillPointer() {
  for (const name of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture', 'scrollIntoView']) {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      value: name === 'hasPointerCapture' ? () => false : () => {},
    })
  }
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
}

function renderDialog() {
  const onSuccess = vi.fn()
  const onClose = vi.fn()
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <AddManyStringsDialog open projectId="proj-1" project={project} modules={modules}
          tags={tags} onClose={onClose} onSuccess={onSuccess} />
      </TooltipProvider>
    </QueryClientProvider>
  )
  return { onSuccess, onClose }
}

function paste(json: string) {
  fireEvent.change(screen.getByLabelText('JSON'), { target: { value: json } })
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
}

const textbox = (name: string) => screen.getByRole('textbox', { name }) as HTMLTextAreaElement

async function previewed() {
  vi.mocked(stringsApi.pasteReview).mockResolvedValueOnce(reviewed)
  paste('{"save": "Lưu lại", "e2e_new": "Mới"}')
  await screen.findByRole('list', { name: 'Pasted strings' })
}

describe('AddManyStringsDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    polyfillPointer()
    vi.mocked(stringsApi.translateQa).mockResolvedValue({ locale: 'en', issues: [] })
  })

  it('previews pasted rows in place without saving anything', async () => {
    renderDialog()
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Module' }), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'Common' }))
    fireEvent.click(screen.getByRole('button', { name: 'ios' }))
    await previewed()
    expect(stringsApi.pasteReview).toHaveBeenCalledWith('proj-1', {
      module_id: 'mod-common',
      tag_ids: ['tag-ios'],
      rows: [
        { key: 'save', source_text: 'Lưu lại' },
        { key: 'e2e_new', source_text: 'Mới' },
      ],
    })
    const list = screen.getByRole('list', { name: 'Pasted strings' })
    expect(within(list).getByText('New')).toBeTruthy()
    expect(within(list).getByText('Update')).toBeTruthy()
    expect(textbox('EN translation for save').value).toBe('Save')
    expect(textbox('EN translation for e2e_new').value).toBe('')
    expect(stringsApi.pasteSave).not.toHaveBeenCalled()
  })

  it('starts with empty braces so only key/value lines are needed', async () => {
    renderDialog()
    const field = screen.getByLabelText('JSON') as HTMLTextAreaElement
    expect(field.value).toBe('{\n  \n}')
    vi.mocked(stringsApi.pasteReview).mockResolvedValueOnce(reviewed)
    fireEvent.change(field, { target: { value: '{\n  "save": "Lưu lại"\n}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await waitFor(() => expect(stringsApi.pasteReview).toHaveBeenCalled())
    expect(vi.mocked(stringsApi.pasteReview).mock.calls[0][1].rows).toEqual([
      { key: 'save', source_text: 'Lưu lại' },
    ])
  })

  it('replaces the empty braces when a whole object is pasted', () => {
    renderDialog()
    const field = screen.getByLabelText('JSON') as HTMLTextAreaElement
    fireEvent.paste(field, { clipboardData: { getData: () => '{"save": "Lưu lại"}' } })
    expect(field.value).toBe('{"save": "Lưu lại"}')
  })

  it('moves the caret inside the empty braces on focus', async () => {
    renderDialog()
    const field = screen.getByLabelText('JSON') as HTMLTextAreaElement
    field.focus()
    field.setSelectionRange(0, 0)
    await waitFor(() => expect(field.selectionStart).toBe(4))
    expect(field.selectionEnd).toBe(4)
  })

  it('keeps a select-all made right after focus', async () => {
    renderDialog()
    const field = screen.getByLabelText('JSON') as HTMLTextAreaElement
    field.focus()
    field.select()
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, field.value.length])
  })

  it('keeps the browser paste once the braces have content', () => {
    renderDialog()
    const field = screen.getByLabelText('JSON') as HTMLTextAreaElement
    fireEvent.change(field, { target: { value: '{\n  "a": "b"\n}' } })
    fireEvent.paste(field, { clipboardData: { getData: () => '{"save": "x"}' } })
    expect(field.value).toBe('{\n  "a": "b"\n}')
  })

  it.each([
    ['{not json', /Invalid JSON/],
    ['{"welcome": {"en": "Hi"}}', /must have a string value/],
    ['{}', /empty/],
    [JSON.stringify(Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, 'v']))), /up to 100/],
  ])('rejects %s without calling the API', async (json, message) => {
    renderDialog()
    paste(json)
    expect(await screen.findByText(message)).toBeTruthy()
    expect(stringsApi.pasteReview).not.toHaveBeenCalled()
  })

  it('pastes into a chosen target language', async () => {
    renderDialog()
    vi.mocked(stringsApi.pasteReview).mockResolvedValueOnce(reviewed)
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Language' }), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'EN' }))
    paste('{"save": "Save"}')
    await waitFor(() => expect(stringsApi.pasteReview).toHaveBeenCalled())
    expect(vi.mocked(stringsApi.pasteReview).mock.calls[0][1].rows).toEqual([
      { key: 'save', translations: { en: 'Save' } },
    ])
  })

  it('generates only empty translations and keeps pasted text', async () => {
    renderDialog()
    await previewed()
    vi.mocked(stringsApi.translatePreviewBatch).mockResolvedValueOnce({
      items: [
        { id: 'save', translations: { en: 'Overwritten?', ja: '保存' }, scores: { ja: 90 } },
        { id: 'e2e_new', translations: { en: 'New', ja: '新規' }, scores: {} },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate with AI' }))
    await waitFor(() => expect(textbox('JA translation for save').value).toBe('保存'))
    expect(stringsApi.translatePreviewBatch).toHaveBeenCalledWith('proj-1', {
      module_id: null,
      items: [
        { id: 'save', source_text: 'Lưu lại', locales: ['ja'] },
        { id: 'e2e_new', source_text: 'Mới', locales: ['en', 'ja'] },
      ],
    })
    expect(textbox('EN translation for save').value).toBe('Save')
    expect(textbox('EN translation for e2e_new').value).toBe('New')
    expect(stringsApi.pasteSave).not.toHaveBeenCalled()
  })

  it('checks edited translations with Smart QA without blocking save', async () => {
    renderDialog()
    await previewed()
    vi.mocked(stringsApi.translateQa).mockResolvedValue({
      locale: 'en',
      issues: [{
        code: 'placeholder_missing',
        severity: 'error',
        message: 'Missing placeholder {n}.',
        start: null,
        end: null,
        detail: null,
      }],
    })
    const editedTranslation = textbox('EN translation for e2e_new')
    fireEvent.change(editedTranslation, { target: { value: 'New' } })
    const editedRow = within(editedTranslation.closest('li')!)
    await editedRow.findByRole('button', { name: /QA for en: 1 error/ }, { timeout: 2000 })
    // Only the edited cell is checked; the untouched existing "Save" is not.
    expect(stringsApi.translateQa).toHaveBeenCalledTimes(1)
    expect(stringsApi.translateQa).toHaveBeenCalledWith('proj-1', {
      source_text: 'Mới',
      translation: 'New',
      locale: 'en',
    })
    expect(textbox('EN translation for e2e_new').getAttribute('aria-describedby')).toBe('qa-paste-e2e_new-en')
    expect((screen.getByRole('button', { name: 'Save as draft' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows QA from the preview without checking again', async () => {
    renderDialog()
    vi.mocked(stringsApi.pasteReview).mockResolvedValueOnce({
      ...reviewed,
      items: reviewed.items.map((item) =>
        item.key === 'save'
          ? {
              ...item,
              issues: {
                en: [{
                  code: 'placeholder_missing',
                  severity: 'error',
                  message: 'Missing placeholder {n}.',
                  start: null,
                  end: null,
                  detail: null,
                }],
              },
            }
          : item
      ),
    })
    paste('{"save": "Lưu lại", "e2e_new": "Mới"}')
    await screen.findByRole('list', { name: 'Pasted strings' })
    const saveRow = within(textbox('EN translation for save').closest('li')!)
    await saveRow.findByRole('button', { name: /QA for en: 1 error/ })
    await new Promise((resolve) => setTimeout(resolve, 700))
    expect(stringsApi.translateQa).not.toHaveBeenCalled()
  })

  it('uses QA returned with AI translations instead of re-checking', async () => {
    renderDialog()
    await previewed()
    vi.mocked(stringsApi.translateQa).mockClear()
    vi.mocked(stringsApi.translatePreviewBatch).mockResolvedValueOnce({
      items: [
        { id: 'save', translations: { ja: '保存' }, scores: {}, issues: { ja: [] } },
        {
          id: 'e2e_new',
          translations: { en: 'New', ja: '新規' },
          scores: {},
          issues: {
            en: [{ code: 'x', severity: 'warning', message: 'Check casing.', start: null, end: null, detail: null }],
            ja: [],
          },
        },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate with AI' }))
    expect(await screen.findByRole('button', { name: /QA for en: 1 warning/ })).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 700))
    const checked = vi.mocked(stringsApi.translateQa).mock.calls.map(([, body]) => body.translation)
    expect(checked).not.toContain('New')
    expect(checked).not.toContain('保存')
  })

  it('keeps Generate with AI available and redoes only AI cells the user has not edited', async () => {
    renderDialog()
    await previewed()
    vi.mocked(stringsApi.translatePreviewBatch).mockResolvedValueOnce({
      items: [
        { id: 'save', translations: { ja: '保存' }, scores: {} },
        { id: 'e2e_new', translations: { en: 'New', ja: '新規' }, scores: {} },
      ],
    })
    const generate = screen.getByRole('button', { name: 'Generate with AI' }) as HTMLButtonElement
    fireEvent.click(generate)
    await waitFor(() => expect(textbox('JA translation for save').value).toBe('保存'))
    await waitFor(() => expect(generate.disabled).toBe(false))

    fireEvent.change(textbox('JA translation for e2e_new'), { target: { value: 'Mine' } })
    vi.mocked(stringsApi.translatePreviewBatch).mockResolvedValueOnce({
      items: [
        { id: 'save', translations: { ja: '保存2' }, scores: {} },
        { id: 'e2e_new', translations: { en: 'New 2' }, scores: {} },
      ],
    })
    fireEvent.click(generate)
    await waitFor(() => expect(textbox('JA translation for save').value).toBe('保存2'))
    expect(vi.mocked(stringsApi.translatePreviewBatch).mock.calls[1][1].items).toEqual([
      { id: 'save', source_text: 'Lưu lại', locales: ['ja'] },
      { id: 'e2e_new', source_text: 'Mới', locales: ['en'] },
    ])
    expect(textbox('EN translation for e2e_new').value).toBe('New 2')
    expect(textbox('JA translation for e2e_new').value).toBe('Mine')
    expect(textbox('EN translation for save').value).toBe('Save')
    expect(generate.disabled).toBe(false)
  })

  it('saves as draft, stays open, and offers the saved batch in Strings', async () => {
    const { onSuccess, onClose } = renderDialog()
    await previewed()
    fireEvent.change(textbox('EN translation for e2e_new'), { target: { value: 'New' } })
    vi.mocked(stringsApi.pasteSave).mockResolvedValueOnce(savedDraft)
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    expect(await screen.findByText('Saved 2 strings as draft')).toBeTruthy()
    expect(stringsApi.pasteSave).toHaveBeenCalledWith('proj-1', {
      module_id: null,
      tag_ids: [],
      action: 'draft',
      fingerprint: 'fp-1',
      rows: [
        { key: 'save', source_text: 'Lưu lại', translations: { en: 'Save' } },
        { key: 'e2e_new', source_text: 'Mới', translations: { en: 'New' } },
      ],
    })
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    const link = screen.getByRole('link', { name: 'View in Strings' })
    expect(link.getAttribute('href')).toBe('/projects/proj-1/strings?batch_id=batch-1&batch_kind=import')
    fireEvent.click(link)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('reviews the full public state, publishes exactly the reviewed rows, then closes', async () => {
    const { onSuccess, onClose } = renderDialog()
    await previewed()
    fireEvent.change(textbox('EN translation for e2e_new'), { target: { value: 'New' } })
    vi.mocked(stringsApi.pasteReview).mockResolvedValueOnce(reviewed)
    fireEvent.click(screen.getByRole('button', { name: 'Review & publish' }))
    const publish = await screen.findByRole('button', { name: 'Publish' })
    expect(screen.queryByRole('list', { name: 'Pasted strings' })).toBeNull()
    vi.mocked(stringsApi.pasteSave).mockResolvedValueOnce({ ...savedDraft, action: 'publish', published: 2 })
    fireEvent.click(publish)
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('Saved and published 2 strings')
    const request = vi.mocked(stringsApi.pasteSave).mock.calls[0][1]
    expect(request).toMatchObject({ action: 'publish', fingerprint: 'fp-1' })
    expect(request.rows[1]).toEqual({ key: 'e2e_new', source_text: 'Mới', translations: { en: 'New' } })
  })

  it('refreshes concurrent changes before publication review while preserving user edits', async () => {
    renderDialog()
    await previewed()
    fireEvent.change(textbox('Source text for save'), { target: { value: 'My source' } })
    fireEvent.change(textbox('JA translation for save'), { target: { value: 'Mine' } })
    const refreshed: PasteReview = {
      fingerprint: 'fp-2',
      items: [
        { key: 'save', mode: 'update', entry: entry('save', 'Lưu lại', { en: 'Concurrent', ja: '' }, 'public') },
        reviewed.items[1],
      ],
    }
    vi.mocked(stringsApi.pasteReview)
      // The review projects the stale submitted EN value over the changed catalog.
      .mockResolvedValueOnce({ ...reviewed, fingerprint: 'fp-2' })
      .mockResolvedValueOnce(refreshed)

    fireEvent.click(screen.getByRole('button', { name: 'Review & publish' }))
    await waitFor(() => expect(textbox('EN translation for save').value).toBe('Concurrent'))
    expect(textbox('Source text for save').value).toBe('My source')
    expect(textbox('JA translation for save').value).toBe('Mine')
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
    expect(stringsApi.pasteSave).not.toHaveBeenCalled()
    expect(toast.info).toHaveBeenCalled()
    expect(vi.mocked(stringsApi.pasteReview).mock.calls[2][1].rows).toEqual([
      { key: 'save', source_text: 'Lưu lại' },
      { key: 'e2e_new', source_text: 'Mới' },
    ])

    vi.mocked(stringsApi.pasteReview).mockResolvedValueOnce(refreshed)
    vi.mocked(stringsApi.pasteSave).mockResolvedValueOnce({ ...savedDraft, action: 'publish', published: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'Review & publish' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))
    await waitFor(() => expect(stringsApi.pasteSave).toHaveBeenCalled())
    expect(vi.mocked(stringsApi.pasteSave).mock.calls[0][1]).toMatchObject({
      action: 'publish',
      fingerprint: 'fp-2',
      rows: [
        { key: 'save', source_text: 'My source', translations: { en: 'Concurrent', ja: 'Mine' } },
        { key: 'e2e_new', source_text: 'Mới', translations: {} },
      ],
    })
  })

  it('refreshes a stale list from the pasted rows and keeps edits', async () => {
    renderDialog()
    await previewed()
    fireEvent.change(textbox('JA translation for save'), { target: { value: 'Mine' } })
    vi.mocked(stringsApi.pasteSave).mockRejectedValueOnce(
      new ApiError(409, 'Stale', { detail: { code: 'publish_fingerprint_mismatch' } })
    )
    vi.mocked(stringsApi.pasteReview).mockResolvedValueOnce({
      fingerprint: 'fp-2',
      items: [
        { key: 'save', mode: 'update', entry: entry('save', 'Lưu lại', { en: 'Concurrent', ja: '' }, 'public') },
        reviewed.items[1],
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(textbox('EN translation for save').value).toBe('Concurrent'))
    expect(textbox('JA translation for save').value).toBe('Mine')
    expect(vi.mocked(stringsApi.pasteReview).mock.calls[1][1].rows).toEqual([
      { key: 'save', source_text: 'Lưu lại' },
      { key: 'e2e_new', source_text: 'Mới' },
    ])
    expect(toast.info).toHaveBeenCalled()
    vi.mocked(stringsApi.pasteSave).mockResolvedValueOnce(savedDraft)
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await screen.findByText('Saved 2 strings as draft')
    expect(vi.mocked(stringsApi.pasteSave).mock.calls[1][1].fingerprint).toBe('fp-2')
  })

  it('keeps edits after a failed save', async () => {
    renderDialog()
    await previewed()
    fireEvent.change(textbox('JA translation for save'), { target: { value: 'Mine' } })
    vi.mocked(stringsApi.pasteSave).mockRejectedValueOnce(new ApiError(500, 'Server error'))
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    expect(textbox('JA translation for save').value).toBe('Mine')
    expect(screen.queryByText('Saved 2 strings as draft')).toBeNull()
  })

  it('asks before discarding unsaved pasted strings', async () => {
    const { onClose } = renderDialog()
    await previewed()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    const confirm = await screen.findByRole('alertdialog', { name: 'Discard pasted strings?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep editing' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('list', { name: 'Pasted strings' })).toBeTruthy()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    fireEvent.click(
      within(await screen.findByRole('alertdialog', { name: 'Discard pasted strings?' })).getByRole(
        'button',
        { name: 'Discard' }
      )
    )
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(stringsApi.pasteSave).not.toHaveBeenCalled()
  })
})
