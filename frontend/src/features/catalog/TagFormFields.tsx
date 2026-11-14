import { Check } from 'lucide-react'
import type { TagCreateForm } from '@/lib/schemas'
import { TAG_PRESET_COLORS, tagSwatchColor } from '@/features/strings/catalog-create'
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

type FormErrors = Partial<Record<keyof TagCreateForm, string>>

type Props = {
  form: TagCreateForm
  errors: FormErrors
  onChange: (form: TagCreateForm) => void
  idPrefix?: string
}

export function TagFormFields({ form, errors, onChange, idPrefix = 'tag' }: Props) {
  const normalizedColor = form.color.toUpperCase()

  return (
    <FieldGroup>
      <Field data-invalid={errors.name ? 'true' : undefined}>
        <FieldLabel htmlFor={`${idPrefix}_name`}>Name</FieldLabel>
        <Input
          id={`${idPrefix}_name`}
          placeholder="ios"
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          aria-invalid={errors.name ? true : undefined}
        />
        <FieldError>{errors.name}</FieldError>
      </Field>
      <Field>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor={`${idPrefix}_color`}>Color</FieldLabel>
          <span className="rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 font-mono text-2xs uppercase text-muted-foreground">
            {normalizedColor}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            id={`${idPrefix}_color`}
            type="color"
            value={form.color}
            onChange={(e) => onChange({ ...form, color: e.target.value })}
            className="size-9 shrink-0 cursor-pointer rounded-lg border border-input bg-background p-0.5"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {TAG_PRESET_COLORS.map((c) => {
              const selected = form.color.toLowerCase() === c.toLowerCase()
              return (
                <Button
                  key={c}
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onChange({ ...form, color: c })}
                  className="relative size-6 rounded-full p-0 text-sun transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring"
                  style={{
                    backgroundColor: tagSwatchColor(c),
                    boxShadow: selected
                      ? `0 0 0 2px var(--background), 0 0 0 4px ${tagSwatchColor(c)}`
                      : undefined,
                  }}
                  aria-label={`Select color ${c}`}
                  aria-pressed={selected}
                >
                  {selected ? <Check className="size-3 stroke-[3]" /> : null}
                </Button>
              )
            })}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5">
          <span className="eyebrow text-3xs">Preview</span>
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/80 bg-muted/45 px-2 py-0.5 text-xs font-medium text-foreground wrap-anywhere">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: tagSwatchColor(form.color) }}
              aria-hidden="true"
            />
            {form.name.trim() || 'Preview'}
          </span>
        </div>
      </Field>
    </FieldGroup>
  )
}
