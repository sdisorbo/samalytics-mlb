'use client'

import React, { useEffect, useState } from 'react'

interface TeamSlot {
  abbr: string
  score: number | null
  winProb: number
}

interface Game {
  gamePk: number
  gameTime: string   // ISO
  state: 'Preview' | 'Live' | 'Final' | string
  inning: number | null
  inningHalf: string | null
  away: TeamSlot
  home: TeamSlot
}

// ESPN logo CDN — works for all 30 MLB teams using their lowercase abbreviation.
// A tiny lookup handles the handful that differ from the MLB Stats API abbreviation.
const ESPN_ABBR: Record<string, string> = {
  ARI: 'ari',
  AZ:  'ari',   // MLB Stats API sometimes returns 'AZ' for Arizona
  WSH: 'wsh',
  CWS: 'cws',
  TBR: 'tb',
  TB:  'tb',
  KCR: 'kc',
  KC:  'kc',
  SDP: 'sd',
  SD:  'sd',
  SFG: 'sf',
  SF:  'sf',
}

function logoUrl(abbr: string): string {
  const key = ESPN_ABBR[abbr] ?? abbr.toLowerCase()
  return `https://a.espncdn.com/i/teamlogos/mlb/500/${key}.png`
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    })
  } catch {
    return ''
  }
}

export default function GameTicker() {
  const [games, setGames] = useState<Game[]>([])

  useEffect(() => {
    fetch('/api/today-games')
      .then(r => r.json())
      .then((data: Game[]) => setGames(data))
      .catch(() => {})

    // Refresh every 90 seconds so live scores update
    const id = setInterval(() => {
      fetch('/api/today-games')
        .then(r => r.json())
        .then((data: Game[]) => setGames(data))
        .catch(() => {})
    }, 90_000)
    return () => clearInterval(id)
  }, [])

  if (games.length === 0) return null

  return (
    <div
      className="border-t border-538-border overflow-x-auto"
      style={{
        backgroundColor: 'var(--color-surface)',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      } as React.CSSProperties}
    >
      <div className="flex items-stretch min-w-max">
        {games.map((g) => {
          const isLive  = g.state === 'Live'
          const isFinal = g.state === 'Final'

          return (
            <div
              key={g.gamePk}
              className="flex items-center gap-2.5 px-4 py-1 last:border-r-0"
              style={{ borderRight: '1px solid var(--color-border)' }}
            >
              {/* Away */}
              <TeamChip slot={g.away} isLive={isLive} isFinal={isFinal} />

              {/* Game status */}
              <div className="flex flex-col items-center" style={{ minWidth: '2.75rem' }}>
                {isLive ? (
                  <>
                    <span className="font-bold leading-none" style={{ fontSize: '0.6rem', color: 'var(--color-orange)' }}>
                      {g.inningHalf === 'Top' ? '▲' : '▼'}{g.inning}
                    </span>
                    <span className="text-538-muted leading-none mt-0.5" style={{ fontSize: '0.55rem' }}>LIVE</span>
                  </>
                ) : isFinal ? (
                  <span className="text-538-muted font-semibold" style={{ fontSize: '0.6rem' }}>FINAL</span>
                ) : (
                  <span className="text-538-muted text-center leading-tight" style={{ fontSize: '0.6rem' }}>
                    {fmtTime(g.gameTime)}
                  </span>
                )}
              </div>

              {/* Home */}
              <TeamChip slot={g.home} isLive={isLive} isFinal={isFinal} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TeamChip({
  slot,
  isLive,
  isFinal,
}: {
  slot: TeamSlot
  isLive: boolean
  isFinal: boolean
}) {
  return (
    <div className="flex items-center gap-1.5">
      {/* Logo */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoUrl(slot.abbr)}
        alt={slot.abbr}
        width={18}
        height={18}
        className="object-contain shrink-0"
        style={{ width: 18, height: 18 }}
      />

      {/* Abbr */}
      <span className="font-bold text-538-text" style={{ fontSize: '0.7rem' }}>
        {slot.abbr}
      </span>

      {/* Score (live / final only) */}
      {(isLive || isFinal) && slot.score !== null && (
        <span className="font-bold text-538-text" style={{ fontSize: '0.7rem' }}>
          {slot.score}
        </span>
      )}

      {/* Win % — green if favourite, red if underdog, muted if even */}
      <span
        style={{
          fontSize: '0.6rem',
          color: slot.winProb > 50
            ? 'var(--color-green)'
            : slot.winProb < 50
            ? 'var(--color-red)'
            : 'var(--color-muted)',
          fontWeight: slot.winProb !== 50 ? 600 : 400,
        }}
      >
        {slot.winProb}%
      </span>
    </div>
  )
}
