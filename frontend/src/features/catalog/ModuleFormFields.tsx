import type { ModuleCreateForm } from '@/lib/schemas'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type FormErrors = Partial<Record<keyof ModuleCreateForm, string>>

type Props = {
  form: ModuleCreateForm
  errors: FormErrors
  onChange: (form: ModuleCreateForm) => void
  idPrefix?: string
  slugDisabled?: boolean
}

export function ModuleFormFields({
  form,
  errors,
  onChange,
  idPrefix = 'module',
  slugDisabled = false,
}: Props) {
  return (
    <FieldGroup>
      <Field data-invalid={errors.slug ? 'true' : undefined}>
        <FieldLabel htmlFor={`${idPrefix}_slug`}>Slug</FieldLabel>
        <Input
          id={`${idPrefix}_slug`}
          className="font-mono"
          placeholder="common"
          value={form.slug}
          onChange={(e) => onChange({ ...form, slug: e.target.value })}
          aria-invalid={errors.slug ? true : undefined}
          disabled={slugDisabled}
        />
        <FieldError>{errors.slug}</FieldError>
      </Field>
      <Field data-invalid={errors.name ? 'true' : undefined}>
        <FieldLabel htmlFor={`${idPrefix}_name`}>Name</FieldLabel>
        <Input
          id={`${idPrefix}_name`}
          placeholder="Common strings"
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          aria-invalid={errors.name ? true : undefined}
        />
        <FieldError>{errors.name}</FieldError>
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}_description`}>Description (optional)</FieldLabel>
        <Textarea
          id={`${idPrefix}_description`}
          placeholder="Shared UI strings used across pages"
          value={form.description ?? ''}
          onChange={(e) => onChange({ ...form, description: e.target.value })}
        />
      </Field>
    </FieldGroup>
  )
}
