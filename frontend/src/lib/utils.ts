import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const HAS_TZ = /[zZ]|[+-]\d{2}:?\d{2}$/
const HAS_TIME = /T\d{2}:\d{2}| \d{2}:\d{2}/

export function parseApiDate(dateStr: string): Date {
  const trimmed = dateStr.trim()
  if (HAS_TZ.test(trimmed)) {
    return new Date(trimmed)
  }
  if (HAS_TIME.test(trimmed)) {
    return new Date(`${trimmed}Z`)
  }
  return new Date(trimmed)
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  return parseApiDate(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  return parseApiDate(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatRelativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const then = parseApiDate(dateStr).getTime()
  if (Number.isNaN(then)) return '—'
  const mins = Math.round((Date.now() - then) / 60000)
  if (Math.abs(mins) < 1) return 'just now'
  if (mins < 60 && mins > 0) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24 && hours > 0) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7 && days > 0) return `${days}d ago`
  return formatDateShort(dateStr)
}

export function dayHeading(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const date = parseApiDate(dateStr)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export function dayKey(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const date = parseApiDate(dateStr)
  if (Number.isNaN(date.getTime())) return ''
  return date.toDateString()
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function percentage(count: number, total: number): number {
  if (total === 0) return 0
  return Math.round((count / total) * 100)
}

export function pluralize(count: number, singular: string, plural?: string): string {
  if (count === 1) return `${count} ${singular}`
  return `${count} ${plural ?? singular + 's'}`
}
