import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QaIssue } from '@/lib/api/types'
import { QA_APPLY_FOOTER, QA_SAVE_FOOTER, QaIssueBadge, type QaBadgeIssue } from './qa-issue-view'

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

  it('ignores touch hover and opens on tap', () => {
    renderBadge([missing, length])
    const button = badgeButton('en')
    fireEvent.pointerOver(button, { pointerType: 'touch' })
    expect(popoverOpen()).toBe(false)
    fireEvent.click(button)
    expect(popoverOpen()).toBe(true)
    expect(screen.getByText(QA_SAVE_FOOTER)).toBeTruthy()
    expect(screen.getByLabelText('Error')).toBeTruthy()
    expect(screen.getByLabelText('Warning')).toBeTruthy()
  })
})
