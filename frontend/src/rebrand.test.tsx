import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LoginPage } from '@/features/auth/LoginPage'
import { AppHeader } from '@/components/layout/AppHeader'
import { THEME_STORAGE_KEY } from '@/lib/theme'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}))

vi.mock('@/components/layout/UserMenu', () => ({
  UserMenu: () => null,
}))

vi.mock('@/components/layout/ThemeToggle', () => ({
  ThemeToggle: () => null,
}))

const frontendRoot = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(frontendRoot, '../..')

describe('x-locale branding', () => {
  it('shows x-locale on the login page, not TMS', () => {
    render(<LoginPage />)
    expect(screen.getAllByText('x-locale').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Translation management')).toBeTruthy()
    expect(screen.queryByText('TMS')).toBeNull()
    expect(screen.queryByText('Translation Management System')).toBeNull()
  })

  it('shows x-locale in the app header, not TMS', () => {
    render(<AppHeader />)
    expect(screen.getByText('x-locale')).toBeTruthy()
    expect(screen.queryByText('TMS')).toBeNull()
  })

  it('sets the document title and theme key', () => {
    const html = readFileSync(path.join(frontendRoot, '../index.html'), 'utf8')
    expect(html).toContain('<title>x-locale — Translation Management</title>')
    expect(html).toContain('x-locale-theme:v1')
    expect(html).toContain('href="/favicon.svg"')
    expect(html).not.toContain('TMS')
    expect(html).not.toContain('tms-theme')
    expect(THEME_STORAGE_KEY).toBe('x-locale-theme:v1')
  })

  it('tells users to run locale init -k, not tms init', () => {
    const settings = readFileSync(
      path.join(frontendRoot, 'features/settings/SettingsPage.tsx'),
      'utf8',
    )
    expect(settings).toContain('locale init -k')
    expect(settings).not.toContain('tms init')
  })

  it('names the frontend package x-locale-frontend', () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'frontend/package.json'), 'utf8'))
    expect(pkg.name).toBe('x-locale-frontend')
    expect(pkg.dependencies['@fontsource/ibm-plex-sans']).toBeTruthy()
    expect(pkg.dependencies['@fontsource-variable/geist']).toBeUndefined()
  })
})
