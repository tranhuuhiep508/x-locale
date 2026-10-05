import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TargetLanguagePicker } from './TargetLanguagePicker'

const languages = [
  { code: 'en', name: 'English' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'zh-TW', name: 'Chinese (Traditional)' },
]

function Picker({ initial = [] }: { initial?: string[] }) {
  const [value, setValue] = useState(initial)
  return <TargetLanguagePicker languages={languages} value={value} onChange={setValue} />
}

describe('target language selection', () => {
  it('keeps hidden selections when selecting and deselecting search results', () => {
    render(<Picker initial={['en']} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search target languages' }), {
      target: { value: 'Vietnamese' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Vietnamese/ }))
    expect(screen.getByText('2 selected')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Vietnamese/ }))
    expect(screen.getByText('1 selected')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    expect(screen.getByRole('button', { name: /English/ }).getAttribute('aria-pressed')).toBe(
      'true'
    )
    expect(screen.getByRole('button', { name: /Vietnamese/ }).getAttribute('aria-pressed')).toBe(
      'false'
    )
  })

  it('searches locale codes and recovers from an empty search result', () => {
    render(<Picker />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'zh-tw' } })
    expect(screen.getByRole('button', { name: /Chinese \(Traditional\)/ })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'unknown' } })
    expect(screen.getByText('No languages match your search.')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } })
    expect(screen.getByRole('button', { name: /English/ })).toBeTruthy()
  })
})
