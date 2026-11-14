import { slugify } from '@/lib/utils'

/** Atmosphere swatches. Stored strings are the Daylight sRGB; `--tag-*` remaps Nightfall. */
export const TAG_TONES = ['haze', 'azure', 'navy', 'ember', 'gold', 'kelp', 'dusk', 'tide'] as const

export type TagTone = (typeof TAG_TONES)[number]

export const TAG_DAYLIGHT: Record<TagTone, string> = {
  haze: '#65707b',
  azure: '#0076c2',
  navy: '#1d4682',
  ember: '#ca322e',
  gold: '#bb7e00',
  kelp: '#2f6b4e',
  dusk: '#814ea4',
  tide: '#008388',
}

export const TAG_PRESET_COLORS = TAG_TONES.map((tone) => TAG_DAYLIGHT[tone])

/** Tailwind presets saved before the atmosphere set. Orange shares gold: both are the warm swatch. `#ca8a10` is the previous daylight gold. */
const LEGACY_TAG_TONE: Record<string, TagTone> = {
  '#64748b': 'haze',
  '#2563eb': 'azure',
  '#e11d48': 'ember',
  '#f59e0b': 'gold',
  '#f97316': 'gold',
  '#ca8a10': 'gold',
  '#10b981': 'kelp',
  '#9333ea': 'dusk',
  '#0d9488': 'tide',
}

const TONE_BY_STORED = new Map<string, TagTone>([
  ...TAG_TONES.map((tone) => [TAG_DAYLIGHT[tone], tone] as const),
  ...Object.entries(LEGACY_TAG_TONE),
])

/** CSS color for a stored tag. Unknown picker colors stay as saved. */
export function tagSwatchColor(color: string): string {
  const tone = TONE_BY_STORED.get(color.trim().toLowerCase())
  return tone ? `var(--tag-${tone})` : color
}

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
