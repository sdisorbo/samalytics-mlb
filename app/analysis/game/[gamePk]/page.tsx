'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import GameBreakdown from '@/components/GameBreakdown'

interface GameMeta {
  awayAbbr: string; homeAbbr: string
  awayName: string; homeName: string
  awayScore: number | null; homeScore: number | null
  gameState: string
}

export default function GameBreakdownPage() {
  const params = useParams()
  const router = useRouter()
  const gamePk = Number(params.gamePk)

  const [meta, setMeta] = useState<GameMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!gamePk) return
    fetch(`/api/live-game/${gamePk}`)
      .then(r => { if (!r.ok) throw new Error('not found'); return r.json() as Promise<GameMeta> })
      .then(d => { setMeta(d); setLoading(false) })
      .catch(() => { setError(true); setLoading(false) })
  }, [gamePk])

  if (loading) {
    return (
      <div className="max-w-screen-lg mx-auto px-4 py-8 space-y-4 animate-pulse">
        <div className="h-5 bg-538-border/40 rounded w-32" />
        <div className="h-48 bg-538-border/30 rounded-xl" />
      </div>
    )
  }

  if (error || !meta) {
    return (
      <div className="max-w-screen-lg mx-auto px-4 py-16 text-center">
        <p className="text-538-muted text-sm mb-4">Game data unavailable.</p>
        <Link href="/" className="text-538-orange text-sm font-semibold hover:underline">← Back to Home</Link>
      </div>
    )
  }

  return (
    <div className="max-w-screen-lg mx-auto px-4 py-8">
      <GameBreakdown
        gamePk={gamePk}
        awayTeamName={meta.awayName}
        homeTeamName={meta.homeName}
        awayTeamAbbr={meta.awayAbbr}
        homeTeamAbbr={meta.homeAbbr}
        awayScore={meta.awayScore}
        homeScore={meta.homeScore}
        gameStatus={meta.gameState}
        onClose={() => router.back()}
      />
    </div>
  )
}
