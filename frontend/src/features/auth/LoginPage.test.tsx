import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LoginPage } from './LoginPage'

describe('LoginPage', () => {
  it('renders the login page heading and Microsoft sign-in link', () => {
    render(<LoginPage />)

    expect(screen.getByText('Welcome to your localization workspace')).toBeDefined()
    expect(screen.getByText('Continue with Microsoft')).toBeDefined()

    const link = screen.getByRole('link', { name: /continue with microsoft/i })
    expect(link.getAttribute('href')).toBe('/api/auth/login')
  })

  it('renders the interactive locale switcher tabs and updates target translation', () => {
    render(<LoginPage />)

    // Check that locale tabs exist
    expect(screen.getByText('Tiếng Việt')).toBeDefined()
    expect(screen.getByText('English')).toBeDefined()
    expect(screen.getByText('日本語')).toBeDefined()

    // Click on Japanese tab
    const jaButton = screen.getByRole('button', { name: /日本語/i })
    fireEvent.click(jaButton)

    // Japanese text should appear
    expect(screen.getByText(/迅速に翻訳し/i)).toBeDefined()
  })

  it('renders the full core main features suite including AI and draft isolation', () => {
    render(<LoginPage />)

    expect(screen.getByText('Context-Aware AI')).toBeDefined()
    expect(screen.getByText('Draft & Public')).toBeDefined()
    expect(screen.getByText('CLI & Git Sync')).toBeDefined()
    expect(screen.getByText('Audit & Revert')).toBeDefined()
  })
})
