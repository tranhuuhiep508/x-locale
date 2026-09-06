import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { LocaleChip } from '@/components/brand/LocaleChip'
import { Wordmark } from '@/components/brand/Wordmark'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}))

const languages = [
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
]

describe('brand', () => {
  it('shows the x-locale wordmark', () => {
    render(<Wordmark />)
    expect(screen.getByText('x-locale')).toBeTruthy()
  })

  it('renders native script and ISO code', () => {
    render(<LocaleChip code="vi" languages={languages} />)
    expect(screen.getByText('Tiếng Việt')).toBeTruthy()
    expect(screen.getByText('vi')).toBeTruthy()
  })

  it('sets dir=rtl on Arabic chips', () => {
    render(<LocaleChip code="ar" languages={languages} />)
    expect(screen.getByText('العربية').getAttribute('dir')).toBe('rtl')
    expect(screen.getByText('العربية').getAttribute('lang')).toBe('ar')
  })
})
