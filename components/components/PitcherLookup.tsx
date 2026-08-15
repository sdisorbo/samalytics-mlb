'use client'

import { useEffect, useState, useCallback } from 'react'
import PitcherBreakdown from './PitcherBreakdown'
import type { GameBreakdown } from '@/lib/pitcherGame'

// ── Team list ─────────────────────────────────────────────────────────────────

const MLB_TEAMS = [
  { abbr: 'ARI', name: 'Arizona Diamondbacks' },
  { abbr: 'ATL', name: 'Atlanta Braves' },
  { abbr: 'BAL', name: 'Baltimore Orioles' },
  { abbr: 'BOS', name: 'Boston Red Sox' },
  { abbr: 'CHC', name: 'Chicago Cubs' },
  { abbr: 'CWS', name: 'Chicago White Sox' },
  { abbr: 'CIN', name: 'Cincinnati Reds' },
  { abbr: 'CLE', name: 'Cleveland Guardians' },
  { abbr: 'COL', name: 'Colorado Rockies' },
  { abbr: 'DET', name: 'Detroit Tigers' },
  { abbr: 'HOU', name: 'Houston Astros' },
  { abbr: 'KC',  name: 'Kansas City Royals' },
  { abbr: 'LAA', name: 'Los Angeles Angels' },
  { abbr: 'LAD', name: 'Los Angeles Dodgers' },
  { abbr: 'MIA', name: 'Miami Marlins' },
  { abbr: 'MIL', name: 'Milwaukee Brewers' },
  { abbr: 'MIN', name: 'Minnesota Twins' },
  { abbr: 'NYM', name: 'New York Mets' },
  { abbr: 'NYY', name: 'New York Yankees' },
  { abbr: 'OAK', name: 'Oakland Athletics' },
  { abbr: 'PHI', name: 'Philadelphia Phillies' },
  { abbr: 'PIT', name: 'Pittsburgh Pirates' },
  { abbr: 'SD',  name: 'San Diego Padres' },
  { abbr: 'SEA', name: 'Seattle Mariners' },
  { abbr: 'SF',  name: 'San Francisco Giants' },
  { abbr: 'STL', name: 'St. Louis Cardinals' },
  { abbr: 'TB',  name: 'Tampa Bay Rays' },
  { abbr: 'TEX', name: 'Texas Rangers' },
  { abbr: 'TOR', name: 'Toronto Blue Jays' },
  { abbr: 'WSH', name: 'Washington Nationals' },
]

function logoUrl(abbr: string) {
  return `https://a.espncdn.com/i/teamlogos/mlb/500/${abbr.toLowerCase()}.png`
}

function yesterdayStr() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toLocaleDateString('en-CA') // YYYY-MM-DD
}

function seasonStartStr() {
  return '2025-03-18'
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface StarterOption {
  id: number
  name: string
  teamAbbr: string
  line: string
  role: 'SP' | 'RP'
  gamePk: number
  opponentAbbr: string
}

interface StartersResponse {
  games: {
    gamePk: number
    awayTeam: string
    homeTeam: string
    state: string
    starters: { id: number; name: string; teamAbbr: string; line: string; role: 'SP' | 'RP' }[]
  }[]
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PitcherLookup() {
  const [team, setTeam]           = useState('')
  const [date, setDate]           = useState(yesterdayStr())
  const [starters, setStarters]   = useState<StarterOption[]>([])
  const [pitcherId, setPitcherId] = useState<number | null>(null)
  const [gamePk, setGamePk]       = useState<number | null>(null)

  const [loadingStarters, setLoadingStarters] = useState(false)
  const [startersError, setStartersError]     = useState('')
  const [breakdown, setBreakdown]             = useState<GameBreakdown | null>(null)
  const [loadingBreakdown, setLoadingBreakdown] = useState(false)

  // Fetch starters whenever team+date change
  const fetchStarters = useCallback(async () => {
    if (!team || !date) return
    setStarters([])
    setPitcherId(null)
    setGamePk(null)
    setBreakdown(null)
    setStartersError('')
    setLoadingStarters(true)

    try {
      const res  = await fetch(`/api/pitcher-game/starters?team=${team}&date=${date}`)
      const data: StartersResponse = await res.json()

      const options: StarterOption[] = []
      for (const game of data.games ?? []) {
        for (const s of game.starters) {
          const oppAbbr = s.teamAbbr === game.awayTeam ? game.homeTeam : game.awayTeam
          options.push({ id: s.id, name: s.name, teamAbbr: s.teamAbbr, line: s.line, role: s.role, gamePk: game.gamePk, opponentAbbr: oppAbbr })
        }
      }

      if (options.length === 0) {
        setStartersError('No completed games found for this team on that date.')
      } else {
        setStarters(options)
        // Auto-select the SP when there's only one pitcher total
        if (options.length === 1) {
          setPitcherId(options[0].id)
          setGamePk(options[0].gamePk)
        }
      }
    } catch {
      setStartersError('Failed to load games. Try a different date.')
    } finally {
      setLoadingStarters(false)
    }
  }, [team, date])

  useEffect(() => {
    if (team && date) fetchStarters()
  }, [fetchStarters, team, date])

  // Fetch breakdown whenever pitcher is selected
  useEffect(() => {
    if (!gamePk || !pitcherId) return
    setBreakdown(null)
    setLoadingBreakdown(true)
    fetch(`/api/pitcher-game?gamePk=${gamePk}&pitcherId=${pitcherId}`)
      .then(r => r.json())
      .then(setBreakdown)
      .catch(() => setBreakdown(null))
      .finally(() => setLoadingBreakdown(false))
  }, [gamePk, pitcherId])

  const selectedStarter = starters.find(s => s.id === pitcherId)

  return (
    <div className="space-y-4">
      {/* Selector card */}
      <div className="bg-surface border border-538-border rounded-xl overflow-hidden">
        <div className="h-1 w-full" style={{ backgroundColor: '#3D405B' }} />
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: '#3D405B' }}>
              Pitcher Lookup
            </span>
            <span className="text-[11px] text-538-muted">Select any team, date &amp; starter</span>
          </div>

          <div className="flex flex-wrap gap-3 items-end">
            {/* Team selector */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-538-muted">Team</label>
              <div className="relative">
                {team && (
                  <img
                    src={logoUrl(team)}
                    alt={team}
                    width={18}
                    height={18}
                    className="absolute left-2 top-1/2 -translate-y-1/2 object-contain pointer-events-none"
                  />
                )}
                <select
                  value={team}
                  onChange={e => setTeam(e.target.value)}
                  className="bg-surface border border-538-border rounded-lg text-sm text-538-text px-3 py-2 pr-8 appearance-none cursor-pointer hover:border-538-orange/50 focus:outline-none focus:ring-1 focus:ring-538-orange/50"
                  style={{ paddingLeft: team ? '2rem' : '0.75rem', minWidth: 200 }}
                >
                  <option value="">Select team…</option>
                  {MLB_TEAMS.map(t => (
                    <option key={t.abbr} value={t.abbr}>{t.abbr} — {t.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Date picker */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-538-muted">Date</label>
              <input
                type="date"
                value={date}
                min={seasonStartStr()}
                max={yesterdayStr()}
                onChange={e => setDate(e.target.value)}
                className="bg-surface border border-538-border rounded-lg text-sm text-538-text px-3 py-2 cursor-pointer hover:border-538-orange/50 focus:outline-none focus:ring-1 focus:ring-538-orange/50"
              />
            </div>

            {/* Pitcher selector — shown once pitchers are loaded */}
            {starters.length > 1 && (
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-538-muted">Pitcher</label>
                <select
                  value={pitcherId ?? ''}
                  onChange={e => {
                    const id = parseInt(e.target.value, 10)
                    const s = starters.find(x => x.id === id)
                    if (s) { setPitcherId(id); setGamePk(s.gamePk) }
                  }}
                  className="bg-surface border border-538-border rounded-lg text-sm text-538-text px-3 py-2 appearance-none cursor-pointer hover:border-538-orange/50 focus:outline-none focus:ring-1 focus:ring-538-orange/50"
                  style={{ minWidth: 260 }}
                >
                  <option value="">Select pitcher…</option>
                  {starters.map(s => (
                    <option key={s.id} value={s.id}>{s.role} — {s.name} ({s.line})</option>
                  ))}
                </select>
              </div>
            )}

            {/* Loading spinner */}
            {loadingStarters && (
              <div className="flex items-center gap-2 text-sm text-538-muted pb-2">
                <div className="w-4 h-4 border-2 border-538-border border-t-538-orange rounded-full animate-spin" />
                Loading…
              </div>
            )}

            {/* Auto-selected single pitcher badge */}
            {starters.length === 1 && selectedStarter && !loadingBreakdown && (
              <div className="flex items-center gap-2 pb-1">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-538-border text-538-muted">{selectedStarter.role}</span>
                <span className="text-sm font-semibold text-538-text">{selectedStarter.name}</span>
                <span className="text-[11px] text-538-muted">{selectedStarter.line}</span>
              </div>
            )}
          </div>

          {/* Error state */}
          {startersError && !loadingStarters && (
            <p className="text-sm text-538-muted">{startersError}</p>
          )}
        </div>
      </div>

      {/* Breakdown */}
      {loadingBreakdown && (
        <div className="bg-surface border border-538-border rounded-xl overflow-hidden">
          <div className="h-1 w-full" style={{ backgroundColor: '#3D405B' }} />
          <div className="p-4 space-y-3">
            <div className="h-4 w-48 bg-538-border/30 rounded animate-pulse" />
            <div className="h-24 bg-538-border/30 rounded-xl animate-pulse" />
            <div className="h-64 bg-538-border/30 rounded-xl animate-pulse" />
          </div>
        </div>
      )}

      {breakdown && !loadingBreakdown && (
        <PitcherBreakdown data={breakdown} accentColor="#3D405B" label="Game Breakdown" />
      )}
    </div>
  )
}
