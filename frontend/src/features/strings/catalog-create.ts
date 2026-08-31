import { slugify } from '@/lib/utils'

export const TAG_PRESET_COLORS = [
  '#64748b',
  '#0d9488',
  '#2563eb',
  '#9333ea',
  '#e11d48',
  '#f59e0b',
  '#10b981',
  '#f97316',
] as const

export function moduleSlugFromName(name: string): string {
  let slug = slugify(name)
  if (!slug) return ''
  if (!/^[a-z]/.test(slug)) {
    slug = `m-${slug}`
  }
  return slug.slice(0, 128)
}

export function uniqueModuleSlug(name: string, existingSlugs: Iterable<string>): string {
  const used = new Set(existingSlugs)
  const base = moduleSlugFromName(name)
  if (!base) return ''
  if (!used.has(base)) return base
  let n = 2
  while (used.has(`${base}-${n}`)) n += 1
  return `${base}-${n}`
}

export function nextTagColor(existingColors: Iterable<string>): string {
  const used = new Set([...existingColors].map((color) => color.toLowerCase()))
  return TAG_PRESET_COLORS.find((color) => !used.has(color.toLowerCase())) ?? TAG_PRESET_COLORS[0]
}
