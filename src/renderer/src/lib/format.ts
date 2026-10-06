import type { Address } from '../../../shared/types'

const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

const timeFmt = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit' })
const monthDayFmt = new Intl.DateTimeFormat('ko-KR', { month: 'short', day: 'numeric' })
const fullDateFmt = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric' })
const longFmt = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit'
})

export function listDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  if (sameDay(d, now)) return timeFmt.format(d)
  if (d.getFullYear() === now.getFullYear()) return monthDayFmt.format(d)
  return fullDateFmt.format(d)
}

export function longDate(ts: number): string {
  return longFmt.format(new Date(ts))
}

export function relative(ts: number): string {
  const diff = (Date.now() - ts) / 1000
  if (diff < 60) return '방금 전'
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
  return `${Math.floor(diff / 86400)}일 전`
}

export function fileSize(n: number): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function displayName(a: Address): string {
  return a.name || a.email
}

export function formatAddr(a: Address): string {
  return a.name ? `${a.name} <${a.email}>` : a.email
}

export function initials(a: Address): string {
  const s = (a.name || a.email).trim()
  return s ? s[0].toUpperCase() : '?'
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function avatarColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 55% 45%)`
}
