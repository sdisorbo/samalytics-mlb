'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface TeamSide {
  abbr: string
  score: number | null
  winProb: number
}

interface Game {
  gamePk: number
  gameTime: string
  state: string
  inning: number | null
  inningHalf: string | null
  away: TeamSide
  home: TeamSide
}

function logoUrl(abbr: string): string {
  return `https://a.espncdn.com/i/teamlogos/mlb/500/${abbr.toLowerCase()}.png`
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  } catch {
    return iso
  }
}

function WinProbBadge({ prob, side }: { prob: number; side: 'away' | 'home' }) {
  const isStrong = prob >= 60
  const isWeak   = prob <= 40
  const color = isStrong
    ? 'text-emerald-600 dark:text-emerald-400'
    : isWeak
    ? 'text-rose-600 dark:text-rose-400'
    : 'text-538-muted'

  return (
    <span className={`text-xs font-bold tabular-nums ${color}`}>
      {prob}%
    </span>
  )
}

function GameCard({ game }: { game: Game }) {
  return (
    <Link
      href={`/analysis/game/${game.gamePk}`}
      className="block bg-surface border border-538-border rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow group"
    >
      {/* Away row */}
      <div className="flex items-center gap-2 mb-3">
        <img
          src={logoUrl(game.away.abbr)}
          alt={game.away.abbr}
          width={28}
          height={28}
          className="object-contain"
        />
        <span className="font-bold text-sm text-538-text tracking-wide flex-1">
          {game.away.abbr}
        </span>
        <WinProbBadge prob={game.away.winProb} side="away" />
      </div>

      {/* Divider with time */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 h-px bg-538-border" />
        <span className="text-[11px] font-semibold text-538-muted uppercase tracking-wider">
          {formatTime(game.gameTime)}
        </span>
        <div className="flex-1 h-px bg-538-border" />
      </div>

      {/* Home row */}
      <div className="flex items-center gap-2">
        <img
          src={logoUrl(game.home.abbr)}
          alt={game.home.abbr}
          width={28}
          height={28}
          className="object-contain"
        />
        <span className="font-bold text-sm text-538-text tracking-wide flex-1">
          {game.home.abbr}
        </span>
        <WinProbBadge prob={game.home.winProb} side="home" />
      </div>

      {/* Win prob bar */}
      <div className="mt-3 h-1.5 rounded-full overflow-hidden bg-538-border">
        <div
          className="h-full rounded-full bg-538-orange transition-all"
          style={{ width: `${game.away.winProb}%` }}
        />
      </div>
      <div className="flex justify-between mt-0.5">
        <span className="text-[10px] text-538-muted">{game.away.abbr}</span>
        <span className="text-[10px] text-538-muted">{game.home.abbr}</span>
      </div>

      <div className="mt-3 text-[11px] font-semibold text-538-orange group-hover:underline text-right">
        Full Breakdown →
      </div>
    </Link>
  )
}

export default function CloseGamesWidget() {
  const [games, setGames]     = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)

  useEffect(() => {
    fetch('/api/today-games')
      .then((r) => {
        if (!r.ok) throw new Error('fetch failed')
        return r.json() as Promise<Game[]>
      })
      .then((all) => {
        const preview = all.filter((g) => g.state === 'Preview')
        const sorted  = preview.sort(
          (a, b) =>
            Math.abs(a.away.winProb - 50) - Math.abs(b.away.winProb - 50)
        )
        setGames(sorted.slice(0, 3))
        setLoading(false)
      })
      .catch(() => {
        setError(true)
        setLoading(false)
      })
  }, [])

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 bg-538-border/30 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  if (error || games.length === 0) {
    return (
      <div className="bg-surface border border-538-border rounded-xl p-4 text-center">
        <p className="text-538-muted text-sm">No upcoming games available.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {games.map((g) => (
        <GameCard key={g.gamePk} game={g} />
      ))}
    </div>
  )
}
