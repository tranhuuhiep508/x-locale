import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { TranslationQA, TranslationQAIndicator } from './TranslationQA'

afterEach(cleanup)

it('renders diagnostic text without interpreting markup and distinguishes source errors', () => {
  const { container } = render(<TranslationQA id="qa" result={{ complete: true, issues: [
    { code: 'markup_syntax', severity: 'error', side: 'source', message: '<script>alert(1)</script>' },
    { code: 'length_short', severity: 'warning', side: 'translation', message: 'Too short' },
  ] }} />)
  expect(screen.getByText('Error: Source: <script>alert(1)</script>')).toBeTruthy()
  expect(screen.getByText('Warning: Too short')).toBeTruthy()
  expect(container.querySelector('script')).toBeNull()
  expect(screen.queryByText('No structural issues detected')).toBeNull()
})

it('does not present incomplete or unchecked results as clean', () => {
  const { rerender } = render(<TranslationQA id="qa" result={{ complete: false, issues: [] }} />)
  expect(screen.getByText('QA checks incomplete')).toBeTruthy()
  expect(screen.queryByText('No structural issues detected')).toBeNull()
  rerender(<TranslationQA id="qa" status="checking" />)
  expect(screen.getByText('Checking QA…')).toBeTruthy()
  rerender(<TranslationQA id="qa" status="unavailable" />)
  expect(screen.getByText(/QA unavailable/)).toBeTruthy()
  rerender(<TranslationQA id="qa" result={{ complete: true, issues: [] }} />)
  expect(screen.getByText('No structural issues detected')).toBeTruthy()
})

it('provides keyboard-accessible catalog details with separate error and warning counts', () => {
  render(<TranslationQAIndicator result={{ complete: true, issues: [
    { code: 'placeholder_missing', severity: 'error', side: 'translation', message: 'Missing {name}' },
    { code: 'length_long', severity: 'warning', side: 'translation', message: 'Too long' },
  ] }} />)
  expect(screen.getByLabelText('QA: 1 errors, 1 warnings').tagName).toBe('SUMMARY')
})
