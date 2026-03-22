'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'

const YEARS = [
  { value: '', label: '2026 (current)' },
  { value: '2025', label: '2025' },
]

export default function YearSelector({ selectedYear }: { selectedYear?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString())
    if (e.target.value === '') {
      params.delete('year')
    } else {
      params.set('year', e.target.value)
    }
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <select
      value={selectedYear ?? ''}
      onChange={handleChange}
      className="text-xs border border-538-border rounded px-2 py-1 bg-538-bg text-538-text focus:outline-none focus:ring-1 focus:ring-538-accent"
    >
      {YEARS.map(y => (
        <option key={y.value} value={y.value}>{y.label}</option>
      ))}
    </select>
  )
}
