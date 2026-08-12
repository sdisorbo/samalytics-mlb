'use client'

import { useEffect, useState } from 'react'
import PitcherBreakdown from './PitcherBreakdown'
import type { GameBreakdown } from '@/lib/pitcherGame'

export default function PitcherSpotlight() {
  const [data, setData]       = useState<GameBreakdown | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/yesterday-start')
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="bg-surface border border-538-border rounded-xl overflow-hidden">
        <div className="h-1 w-full" style={{ backgroundColor: '#3D405B' }} />
        <div className="p-4 space-y-3">
          <div className="h-4 w-32 bg-538-border/30 rounded animate-pulse" />
          <div className="h-24 bg-538-border/30 rounded-xl animate-pulse" />
          <div className="h-48 bg-538-border/30 rounded-xl animate-pulse" />
        </div>
      </div>
    )
  }

  if (!data) return null

  return <PitcherBreakdown data={data} accentColor="#3D405B" label="Pitcher Spotlight" />
}
