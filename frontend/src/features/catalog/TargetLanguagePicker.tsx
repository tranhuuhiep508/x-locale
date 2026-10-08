import { useState } from 'react'
import { Check, Search } from 'lucide-react'
import type { Language } from '@/lib/api/types'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export function TargetLanguagePicker({
  languages,
  value,
  onChange,
  disabled = false,
}: {
  languages: Language[]
  value: string[]
  onChange: (value: string[]) => void
  disabled?: boolean
}) {
  const [search, setSearch] = useState('')
  const query = search.trim().toLowerCase()
  const filtered = languages.filter((language) =>
    `${language.name} ${language.code}`.toLowerCase().includes(query)
  )

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search target languages"
            placeholder="Find a language…"
            value={search}
            disabled={disabled}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.preventDefault()
            }}
          />
        </InputGroup>
        <span className="text-xs tabular-nums text-muted-foreground">{value.length} selected</span>
      </div>
      <div className="max-h-56 overflow-y-auto rounded-lg border p-2">
        <ToggleGroup
          type="multiple"
          aria-label="Target languages"
          value={value}
          disabled={disabled}
          onValueChange={onChange}
          className="grid w-full grid-cols-1 gap-1 sm:grid-cols-2"
        >
          {filtered.map((language) => (
            <ToggleGroupItem
              key={language.code}
              value={language.code}
              className="h-9 min-w-0 justify-start gap-2 px-2"
              title={`${language.name} (${language.code})`}
            >
              <span className="min-w-0 flex-1 truncate text-left">{language.name}</span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {language.code}
              </span>
              {value.includes(language.code) ? <Check aria-hidden="true" /> : null}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {filtered.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">No languages match your search.</p>
        ) : null}
      </div>
    </div>
  )
}
