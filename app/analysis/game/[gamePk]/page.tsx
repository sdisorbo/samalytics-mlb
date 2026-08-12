'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
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
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    })
  } catch {
    return iso
  }
}

function keyFactors(game: Game): string[] {
  const diff = Math.abs(game.away.winProb - game.home.winProb)
  const favored = game.away.winProb > game.home.winProb ? game.away.abbr : game.home.abbr
  const underdog = game.away.winProb > game.home.winProb ? game.home.abbr : game.away.abbr
  const favProb  = Math.max(game.away.winProb, game.home.winProb)

  if (diff > 20) {
    return [
      `Significant advantage for ${favored} — our model gives them a ${favProb}% win probability.`,
      `${underdog} will need to outperform their season averages to pull off the upset.`,
      `Watch the starting pitcher matchup: the gap in staff performance is a major driver of this spread.`,
    ]
  } else if (diff > 10) {
    return [
      `Slight edge to ${favored} at ${favProb}% — this game is closer than the line suggests.`,
      `Both lineups are capable of generating runs, making bullpen performance a potential tiebreaker.`,
      `A single big inning could swing the outcome given how evenly matched these offenses are.`,
    ]
  } else {
    return [
      `Near 50/50 matchup — neither team holds a meaningful edge in our win probability model.`,
      `Game-time conditions, lineup decisions, and early-inning performance will likely decide this one.`,
      `Both teams sit within a few points of each other in season-long metrics; expect a competitive nine innings.`,
    ]
  }
}

export default function GameBreakdownPage() {
  const params  = useParams()
  const gamePk  = Number(params.gamePk)

  const [game, setGame]       = useState<Game | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)

  useEffect(() => {
    if (!gamePk) return
    fetch('/api/today-games')
      .then((r) => {
        if (!r.ok) throw new Error('fetch failed')
        return r.json() as Promise<Game[]>
      })
      .then((all) => {
        const found = all.find((g) => g.gamePk === gamePk)
        setGame(found ?? null)
        setLoading(false)
      })
      .catch(() => {
        setError(true)
        setLoading(false)
      })
  }, [gamePk])

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-6 animate-pulse">
        <div className="h-8 bg-538-border/40 rounded w-40" />
        <div className="h-32 bg-538-border/30 rounded-xl" />
        <div className="h-20 bg-538-border/20 rounded-xl" />
      </div>
    )
  }

  if (error || !game) {
    return (
      <div className="max-w-2xl mx-auto text-center py-16">
        <p className="text-538-muted text-sm mb-4">Game not found or data is unavailable.</p>
        <Link href="/" className="text-538-orange text-sm font-semibold hover:underline">
          ← Back to Home
        </Link>
      </div>
    )
  }

  const factors = keyFactors(game)
  const awayFav  = game.away.winProb >= game.home.winProb
  const gameState =
    game.state === 'Final'
      ? 'Final'
      : game.state === 'Live' && game.inning
      ? `${game.inningHalf ?? ''} ${game.inning}`.trim()
      : formatTime(game.gameTime)

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Back link */}
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-538-muted hover:text-538-text transition-colors">
        <span>←</span>
        <span>Back to Home</span>
      </Link>

      {/* Big matchup header */}
      <div className="bg-surface border border-538-border rounded-xl p-6 text-center">
        <div className="flex items-center justify-center gap-6">
          {/* Away */}
          <div className="flex flex-col items-center gap-2 flex-1">
            <img
              src={logoUrl(game.away.abbr)}
              alt={game.away.abbr}
              width={64}
              height={64}
              className="object-contain"
            />
            <span className="font-black text-xl text-538-text tracking-wider">{game.away.abbr}</span>
            {game.away.score != null && (
              <span className="text-2xl font-black tabular-nums text-538-text">{game.away.score}</span>
            )}
          </div>

          {/* VS */}
          <div className="flex flex-col items-center gap-1">
            <span className="text-538-muted font-bold text-sm uppercase tracking-widest">vs</span>
            <span className="text-xs text-538-muted font-semibold">{gameState}</span>
          </div>

          {/* Home */}
          <div className="flex flex-col items-center gap-2 flex-1">
            <img
              src={logoUrl(game.home.abbr)}
              alt={game.home.abbr}
              width={64}
              height={64}
              className="object-contain"
            />
            <span className="font-black text-xl text-538-text tracking-wider">{game.home.abbr}</span>
            {game.home.score != null && (
              <span className="text-2xl font-black tabular-nums text-538-text">{game.home.score}</span>
            )}
          </div>
        </div>
      </div>

      {/* Win probability bar */}
      <div className="bg-surface border border-538-border rounded-xl p-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-538-muted mb-4">
          Win Probability
        </h3>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-bold text-538-text w-12 text-right shrink-0">{game.away.abbr}</span>
          <div className="flex-1 h-6 rounded-full overflow-hidden bg-538-border relative flex">
            {/* Away side */}
            <div
              className="h-full flex items-center justify-end pr-2 transition-all"
              style={{
                width: `${game.away.winProb}%`,
                backgroundColor: awayFav ? '#3D405B' : '#B20D30',
                minWidth: '2rem',
              }}
            >
              <span className="text-[11px] font-black text-white tabular-nums">{game.away.winProb}%</span>
            </div>
            {/* Home side */}
            <div
              className="h-full flex items-center justify-start pl-2 transition-all"
              style={{
                width: `${game.home.winProb}%`,
                backgroundColor: !awayFav ? '#3D405B' : '#B20D30',
                minWidth: '2rem',
              }}
            >
              <span className="text-[11px] font-black text-white tabular-nums">{game.home.winProb}%</span>
            </div>
          </div>
          <span className="text-xs font-bold text-538-text w-12 shrink-0">{game.home.abbr}</span>
        </div>
        <div className="flex justify-between text-[10px] text-538-muted mt-1 px-14">
          <span>Away</span>
          <span>Home</span>
        </div>
      </div>

      {/* Key factors */}
      <div className="bg-surface border border-538-border rounded-xl p-5">
        <h3 className="text-xs font-bold uppercase tracking-widest text-538-muted mb-4">
          Key Factors
        </h3>
        <ul className="space-y-3">
          {factors.map((f, i) => (
            <li key={i} className="flex items-start gap-2">
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0 mt-0.5"
                style={{ backgroundColor: '#3D405B' }}
              >
                {i + 1}
              </span>
              <p className="text-sm text-538-text leading-relaxed">{f}</p>
            </li>
          ))}
        </ul>
      </div>

      {/* Links to full team analyses */}
      <div className="grid grid-cols-2 gap-4">
        <Link
          href={`/analysis/pitching/${game.away.abbr}`}
          className="bg-surface border border-538-border rounded-xl p-4 text-center hover:shadow-md transition-shadow group"
        >
          <div className="flex items-center justify-center gap-2 mb-1">
            <img src={logoUrl(game.away.abbr)} alt={game.away.abbr} width={20} height={20} className="object-contain" />
            <span className="font-bold text-xs text-538-text">{game.away.abbr}</span>
          </div>
          <p className="text-[11px] text-538-muted group-hover:text-538-orange transition-colors">Pitching Analysis →</p>
        </Link>
        <Link
          href={`/analysis/pitching/${game.home.abbr}`}
          className="bg-surface border border-538-border rounded-xl p-4 text-center hover:shadow-md transition-shadow group"
        >
          <div className="flex items-center justify-center gap-2 mb-1">
            <img src={logoUrl(game.home.abbr)} alt={game.home.abbr} width={20} height={20} className="object-contain" />
            <span className="font-bold text-xs text-538-text">{game.home.abbr}</span>
          </div>
          <p className="text-[11px] text-538-muted group-hover:text-538-orange transition-colors">Pitching Analysis →</p>
        </Link>
      </div>
    </div>
  )
}
