import type { ModuleCreateForm } from '@/lib/schemas'
import { moduleSlugFromName } from '@/features/strings/catalog-create'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { TranslationContextField } from '@/features/catalog/TranslationContextField'

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
  function handleNameChange(nextName: string) {
    const canAutoFillSlug =
      !slugDisabled && (form.slug === '' || form.slug === moduleSlugFromName(form.name))
    onChange({
      ...form,
      name: nextName,
      slug: canAutoFillSlug ? moduleSlugFromName(nextName) : form.slug,
    })
  }

  return (
    <FieldGroup>
      <Field data-invalid={errors.name ? 'true' : undefined}>
        <FieldLabel htmlFor={`${idPrefix}_name`}>Name</FieldLabel>
        <Input
          id={`${idPrefix}_name`}
          placeholder="Common strings"
          value={form.name}
          onChange={(e) => handleNameChange(e.target.value)}
          aria-invalid={errors.name ? true : undefined}
        />
        <FieldError>{errors.name}</FieldError>
      </Field>
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
        <FieldDescription>
          {slugDisabled ? (
            'Slug is locked after creation so export paths stay stable.'
          ) : (
            <>
              Namespace identifier for modular exports (
              <code className="font-mono text-xs text-foreground">
                {form.slug.trim() || 'common'}.json
              </code>
              ).
            </>
          )}
        </FieldDescription>
        <FieldError>{errors.slug}</FieldError>
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
      <TranslationContextField
        id={`${idPrefix}_translation_context`}
        value={form.translation_context ?? ''}
        error={errors.translation_context}
        onChange={(translation_context) => onChange({ ...form, translation_context })}
      />
    </FieldGroup>
  )
}
