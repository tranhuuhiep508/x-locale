import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QaIssue } from '@/lib/api/types'
import { QA_APPLY_FOOTER, QA_SAVE_FOOTER, QaIssueBadge, QaLocaleBadge, describedByFor, type QaBadgeIssue } from './qa-issue-view'
import type { QaView } from './qa-issues'

function issue(overrides: Partial<QaIssue> & Pick<QaIssue, 'code' | 'severity' | 'message'>): QaBadgeIssue {
  return { start: null, end: null, detail: null, ...overrides }
}

const missing = issue({
  code: 'placeholder_missing',
  severity: 'error',
  message: 'Missing placeholder {name} (source has 1, translation has 0).',
})
const length = issue({
  code: 'length',
  severity: 'warning',
  message: 'Translation is 108 characters, past the advisory limit of 96.',
})
const plural = issue({
  code: 'icu_plural',
  severity: 'error',
  message: 'Plural {count} is missing category one for locale ru.',
})

function renderBadge(issues: QaBadgeIssue[], footer = QA_SAVE_FOOTER, label = 'en') {
  render(<QaIssueBadge label={label} issues={issues} footer={footer} />)
}

function badgeButton(label: string) {
  return screen.getByRole('button', { name: new RegExp(`QA for ${label}`) })
}

function popoverOpen() {
  return document.querySelector('[data-slot="popover-content"]')?.getAttribute('data-state') === 'open'
}

beforeEach(() => {
  class PointerEventPolyfill extends MouseEvent {
    pointerType: string
    constructor(type: string, params: MouseEventInit & { pointerType?: string } = {}) {
      super(type, params)
      this.pointerType = params.pointerType ?? ''
    }
  }
  vi.stubGlobal('PointerEvent', PointerEventPolyfill)
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
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('QA badge state', () => {
  it('shows a grey clean badge and no popover trigger', () => {
    renderBadge([])
    const badge = screen.getByText('No QA issues')
    expect(badge.closest('[data-slot="badge"]')?.getAttribute('data-variant')).toBe('outline')
    expect(badge.className).toContain('text-muted-foreground')
    expect(screen.queryByRole('button', { name: /QA for/ })).toBeNull()
  })

  it('uses one red badge for errors, including a missing plural', () => {
    renderBadge([plural])
    const button = badgeButton('en')
    expect(button.textContent).toContain('1 error')
    expect(button.getAttribute('data-variant')).toBe('destructive')
    expect(screen.queryByText('1 warning')).toBeNull()
  })

  it('uses one amber badge when every issue is a warning', () => {
    renderBadge([length, { ...length, code: 'length_ratio', message: 'Length ratio is high.' }])
    const button = badgeButton('en')
    expect(button.textContent).toContain('2 warnings')
    expect(button.getAttribute('data-variant')).toBe('outline')
    expect(button.className).toContain('border-amber-500/30')
    expect(button.className).not.toContain('bg-destructive/10')
  })

  it('collapses mixed severities into one red badge', () => {
    renderBadge([missing, { ...missing, code: 'placeholder_extra', message: 'Extra placeholder.' }, length])
    const button = badgeButton('en')
    expect(button.textContent).toContain('3 issues')
    expect(button.getAttribute('data-variant')).toBe('destructive')
    expect(screen.queryByText('2 errors')).toBeNull()
    expect(screen.queryByText('1 warning')).toBeNull()
    expect(screen.getAllByRole('button', { name: /QA for en/ })).toHaveLength(1)
  })
})

describe('QA badge popover', () => {
  it('opens on hover and closes after a short delay', async () => {
    vi.useFakeTimers()
    renderBadge([missing, length])
    const button = badgeButton('en')
    fireEvent.pointerOver(button, { pointerType: 'mouse' })
    expect(popoverOpen()).toBe(true)
    expect(screen.getByText(missing.message)).toBeTruthy()
    expect(screen.getByText('placeholder_missing')).toBeTruthy()
    expect(screen.getByText(QA_SAVE_FOOTER)).toBeTruthy()
    expect(screen.getByText('1 error · 1 warning')).toBeTruthy()

    fireEvent.pointerOut(button, { pointerType: 'mouse' })
    expect(popoverOpen()).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(149) })
    expect(popoverOpen()).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(popoverOpen()).toBe(false)
  })

  it('stays open while the pointer is over the popover', async () => {
    vi.useFakeTimers()
    renderBadge([length], QA_APPLY_FOOTER)
    const button = badgeButton('en')
    fireEvent.pointerOver(button, { pointerType: 'mouse' })
    const content = document.querySelector('[data-slot="popover-content"]')
    expect(content).toBeTruthy()
    fireEvent.pointerOut(button, { pointerType: 'mouse' })
    fireEvent.pointerOver(content as Element, { pointerType: 'mouse' })
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(popoverOpen()).toBe(true)
    expect(screen.getByText(QA_APPLY_FOOTER)).toBeTruthy()
    fireEvent.pointerOut(content as Element, { pointerType: 'mouse' })
    await act(async () => { await vi.advanceTimersByTimeAsync(150) })
    expect(popoverOpen()).toBe(false)
  })

  it('opens on keyboard focus and stays open until blur', async () => {
    vi.useFakeTimers()
    renderBadge([missing])
    const button = badgeButton('en')
    act(() => { button.focus() })
    expect(popoverOpen()).toBe(true)
    fireEvent.pointerOut(button, { pointerType: 'mouse' })
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(popoverOpen()).toBe(true)
    act(() => { button.blur() })
    await act(async () => { await vi.advanceTimersByTimeAsync(150) })
    expect(popoverOpen()).toBe(false)
  })

  it('ignores touch hover', () => {
    renderBadge([missing, length])
    fireEvent.pointerOver(badgeButton('en'), { pointerType: 'touch' })
    expect(popoverOpen()).toBe(false)
  })

  it('stays open when a touch tap focuses the badge before click', async () => {
    const { events } = renderTracked([missing, length])
    const button = badgeButton('en')
    await userEvent.setup({ delay: null }).pointer([
      { keys: '[TouchA>]', target: button },
      { keys: '[/TouchA]' },
    ])
    expect(events.indexOf('pointerdown')).toBeGreaterThanOrEqual(0)
    expect(events.indexOf('focus')).toBeGreaterThan(events.indexOf('pointerdown'))
    expect(events.indexOf('click')).toBeGreaterThan(events.indexOf('focus'))
    expect(popoverOpen()).toBe(true)
    expect(screen.getByText(QA_SAVE_FOOTER)).toBeTruthy()
  })

  it('stays open when clicked after hover', async () => {
    const { events } = renderTracked([missing])
    const button = badgeButton('en')
    const user = userEvent.setup({ delay: null })
    await user.hover(button)
    expect(popoverOpen()).toBe(true)
    await user.click(button)
    expect(events.indexOf('click')).toBeGreaterThan(events.indexOf('focus'))
    expect(popoverOpen()).toBe(true)
    await user.keyboard('{Escape}')
    expect(popoverOpen()).toBe(false)
  })

  it('opens on Tab and closes on Escape', async () => {
    render(
      <>
        <button type="button">Before</button>
        <QaIssueBadge label="en" issues={[missing]} footer={QA_SAVE_FOOTER} />
      </>,
    )
    const user = userEvent.setup({ delay: null })
    await user.tab()
    expect(document.activeElement?.textContent).toBe('Before')
    expect(popoverOpen()).toBe(false)
    await user.tab()
    expect(document.activeElement).toBe(badgeButton('en'))
    expect(popoverOpen()).toBe(true)
    await user.keyboard('{Escape}')
    expect(popoverOpen()).toBe(false)
    await user.click(badgeButton('en'))
    expect(popoverOpen()).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Before' }))
    expect(popoverOpen()).toBe(false)
  })
})

function renderTracked(issues: QaBadgeIssue[]) {
  const events: string[] = []
  const { container } = render(<QaIssueBadge label="en" issues={issues} footer={QA_SAVE_FOOTER} />)
  container.addEventListener('pointerdown', () => { events.push('pointerdown') })
  container.addEventListener('mousedown', () => { events.push('mousedown') })
  container.addEventListener('focusin', () => { events.push('focus') })
  container.addEventListener('pointerup', () => { events.push('pointerup') })
  container.addEventListener('mouseup', () => { events.push('mouseup') })
  container.addEventListener('click', () => { events.push('click') })
  return { events }
}

describe('QA live region', () => {
  const ready: QaView = { status: 'ready', issues: [missing], stale: false }
  const clean: QaView = { status: 'ready', issues: [], stale: false }
  const failed: QaView = { status: 'failed', issues: [], stale: false }
  const checking: QaView = { status: 'checking', issues: [], stale: false }

  function field(view: QaView) {
    return (
      <>
        <textarea aria-label="en" aria-describedby={describedByFor(view, 'qa-en')} />
        <QaLocaleBadge view={view} locale="en" footer={QA_SAVE_FOOTER} id="qa-en" />
      </>
    )
  }

  it('announces issue changes for the textarea', () => {
    const { rerender } = render(field(ready))
    const region = document.getElementById('qa-en')
    expect(region?.getAttribute('aria-live')).toBe('polite')
    expect(region?.className).toContain('sr-only')
    expect(region?.textContent).toContain(missing.message)
    expect(region?.textContent).toContain('placeholder_missing')
    expect(screen.getByLabelText('en').getAttribute('aria-describedby')).toBe('qa-en')

    rerender(field(clean))
    expect(document.getElementById('qa-en')?.textContent).toContain('No QA issues')

    rerender(field(failed))
    expect(document.getElementById('qa-en')?.textContent).toContain('QA check failed.')
    expect(screen.getByText('QA failed')).toBeTruthy()

    rerender(field(checking))
    expect(describedByFor(checking, 'qa-en')).toBeUndefined()
    expect(document.getElementById('qa-en')).toBeNull()
  })
})
