import type { TagCreateForm } from '@/lib/schemas'
import { TAG_PRESET_COLORS } from '@/features/strings/catalog-create'
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
        <FieldLabel>Color</FieldLabel>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={form.color}
            onChange={(e) => onChange({ ...form, color: e.target.value })}
            className="h-9 w-9 cursor-pointer rounded border border-input p-0.5"
          />
          <div className="flex flex-wrap gap-1">
            {TAG_PRESET_COLORS.map((c) => (
              <Button
                key={c}
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => onChange({ ...form, color: c })}
                className="size-6 rounded-full border-2 p-0 transition-transform hover:scale-110"
                style={{
                  backgroundColor: c,
                  borderColor: form.color === c ? 'var(--primary)' : 'transparent',
                }}
                aria-label={`Select color ${c}`}
              />
            ))}
          </div>
        </div>
        <div
          className="mt-1 flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-medium"
          style={{ backgroundColor: form.color + '22', color: form.color }}
        >
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: form.color }} />
          {form.name || 'Preview'}
        </div>
      </Field>
    </FieldGroup>
  )
}
