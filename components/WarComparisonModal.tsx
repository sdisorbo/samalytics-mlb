'use client'

import { useState, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import type { PlayerWar, LegendWar } from '../lib/types'

type WarMetric = 'war' | 'off_war' | 'def_war'
type ViewMode = 'career' | 'season'

// ── Legend color palette (FiveThirtyEight-ish muted colors) ─────────────────
const LEGEND_COLORS: Record<string, string> = {
  'Aaron Judge':       '#E64A19',
  'Shohei Ohtani':     '#1565C0',
  'Barry Bonds':       '#6A1B9A',
  'Derek Jeter':       '#00695C',
  'Albert Pujols':     '#C62828',
  'David Ortiz':       '#37474F',
  'Johnny Damon':      '#F57C00',
  'Mike Trout':        '#0277BD',
  'Justin Verlander':  '#558B2F',
  'Michael Young':     '#78909C',
  'Nick Swisher':      '#A1887F',
  '__selected__':      '#E8390E',
  '__compare__':       '#1565C0',
}

function legendColor(name: string, idx: number): string {
  if (LEGEND_COLORS[name]) return LEGEND_COLORS[name]
  const fallbacks = ['#5C6BC0','#00838F','#6D4C41','#546E7A','#558B2F','#AD1457']
  return fallbacks[idx % fallbacks.length]
}

interface Props {
  player: PlayerWar
  allPlayers: PlayerWar[]
  legendWar: LegendWar
  onClose: () => void
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label, metric }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string | number
  metric: WarMetric
}) {
  if (!active || !payload?.length) return null
  const metricLabel = metric === 'war' ? 'WAR' : metric === 'off_war' ? 'oWAR' : 'dWAR'
  return (
    <div className="bg-surface border border-538-border rounded px-3 py-2 shadow text-xs">
      <p className="font-bold text-538-text mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: <span className="font-semibold">{p.value > 0 ? '+' : ''}{p.value.toFixed(1)} {metricLabel}</span>
        </p>
      ))}
    </div>
  )
}

export default function WarComparisonModal({ player, allPlayers, legendWar, onClose }: Props) {
  const [metric, setMetric] = useState<WarMetric>('war')
  const [view, setView] = useState<ViewMode>('career')
  const [comparePlayerId, setComparePlayerId] = useState<number | null>(null)
  const [visibleLines, setVisibleLines] = useState<Set<string>>(
    () => new Set(['__selected__', ...Object.keys(legendWar)])
  )

  const comparePlayer = allPlayers.find((p) => p.player_id === comparePlayerId) ?? null

  // ── Career view data ──────────────────────────────────────────────────────
  // Build { year, [name]: cumWAR } for the selected player using their bref
  // career data from legendWar if present, otherwise just the current season.
  const careerData = useMemo(() => {
    // Collect all years from all legend series.
    const yearSet = new Set<number>()
    Object.values(legendWar).forEach((seasons) => seasons.forEach((s) => yearSet.add(s.year)))

    // If the player is themselves a legend (bref_id match), include their career.
    // Otherwise, we only have their current season point.
    const playerLegendKey = Object.keys(legendWar).find(
      (k) => legendWar[k].some(() => false) // placeholder — we'll match by name below
    )
    const playerCareer = legendWar[player.name] ?? null

    if (playerCareer) {
      playerCareer.forEach((s) => yearSet.add(s.year))
    }

    const years = Array.from(yearSet).sort()

    // Cumulative WAR per legend.
    const cumMap: Record<string, Record<number, number>> = {}
    Object.entries(legendWar).forEach(([name, seasons]) => {
      let cum = 0
      const byYear: Record<number, number> = {}
      seasons.forEach((s) => { cum += s[metric]; byYear[s.year] = cum })
      // Forward-fill: for years after career end, keep last value.
      let last = 0
      years.forEach((y) => {
        if (byYear[y] !== undefined) last = byYear[y]
        byYear[y] = last
      })
      cumMap[name] = byYear
    })

    // Player's own career if they are a legend.
    if (playerCareer) {
      let cum = 0
      const byYear: Record<number, number> = {}
      playerCareer.forEach((s) => { cum += s[metric]; byYear[s.year] = cum })
      let last = 0
      years.forEach((y) => {
        if (byYear[y] !== undefined) last = byYear[y]
        byYear[y] = last
      })
      cumMap['__selected__'] = byYear
    }

    return years.map((y) => {
      const row: Record<string, number | string> = { year: y }
      Object.entries(cumMap).forEach(([name, byYear]) => {
        if (byYear[y] !== undefined) row[name] = parseFloat(byYear[y].toFixed(1))
      })
      return row
    })
  }, [legendWar, metric, player.name])

  // ── Season view data ──────────────────────────────────────────────────────
  // Show all qualified current players sorted by the selected metric, as a bar-
  // like leaderboard. We don't have game-by-game data, so we show per-player
  // single data points ranked by their WAR total — displayed as a horizontal
  // ranking chart using a simple bar approach inside Recharts.
  const seasonData = useMemo(() => {
    const pool = allPlayers
      .filter((p) => p.pa >= 50)
      .sort((a, b) => b[metric] - a[metric])
      .slice(0, 40)

    return pool.map((p, i) => ({
      rank: i + 1,
      name: p.name.split(' ').pop() ?? p.name,
      fullName: p.name,
      value: parseFloat(p[metric].toFixed(2)),
      isSelected: p.player_id === player.player_id,
      isCompare: p.player_id === comparePlayerId,
    }))
  }, [allPlayers, metric, player.player_id, comparePlayerId])

  // ── Legend toggle ─────────────────────────────────────────────────────────
  function toggleLine(name: string) {
    setVisibleLines((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const metricOptions: { value: WarMetric; label: string }[] = [
    { value: 'war', label: 'Total WAR' },
    { value: 'off_war', label: 'Offense' },
    { value: 'def_war', label: 'Defense' },
  ]

  const hasCareerData = !!legendWar[player.name]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
      <div className="bg-surface rounded-xl border border-538-border shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-538-border">
          <div>
            <h2 className="text-xl font-black text-538-text tracking-tight">{player.name}</h2>
            <p className="text-xs text-538-muted mt-0.5">
              {player.team} · {player.g} G · {player.pa} PA ·{' '}
              <span className="font-semibold text-538-text">{player.war.toFixed(1)} WAR</span>
              {' / '}
              <span className="text-538-orange">{player.off_war.toFixed(1)} oWAR</span>
              {' / '}
              <span className="text-538-muted">{player.def_war.toFixed(1)} dWAR</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-538-muted hover:text-538-text transition-colors p-1"
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Controls */}
        <div className="px-6 py-3 flex flex-wrap items-center gap-3 border-b border-538-border">
          {/* Metric toggle */}
          <div className="inline-flex rounded border border-538-border overflow-hidden">
            {metricOptions.map((opt) => (
              <button key={opt.value} onClick={() => setMetric(opt.value)}
                className={`px-3 py-1 text-xs font-semibold transition-colors ${metric === opt.value ? 'bg-538-orange text-white' : 'text-538-muted hover:text-538-text'}`}>
                {opt.label}
              </button>
            ))}
          </div>

          {/* View toggle */}
          <div className="inline-flex rounded border border-538-border overflow-hidden">
            <button onClick={() => setView('season')}
              className={`px-3 py-1 text-xs font-semibold transition-colors ${view === 'season' ? 'bg-538-orange text-white' : 'text-538-muted hover:text-538-text'}`}>
              2025 Season
            </button>
            <button onClick={() => setView('career')}
              className={`px-3 py-1 text-xs font-semibold transition-colors ${view === 'career' ? 'bg-538-orange text-white' : 'text-538-muted hover:text-538-text'}`}>
              Career (vs. Legends)
            </button>
          </div>

          {/* Season: compare player picker */}
          {view === 'season' && (
            <select
              value={comparePlayerId ?? ''}
              onChange={(e) => setComparePlayerId(e.target.value ? Number(e.target.value) : null)}
              className="text-xs border border-538-border rounded px-2 py-1 bg-surface text-538-text"
            >
              <option value="">+ Compare another player</option>
              {allPlayers
                .filter((p) => p.pa >= 50 && p.player_id !== player.player_id)
                .sort((a, b) => b.war - a.war)
                .map((p) => (
                  <option key={p.player_id ?? p.name} value={p.player_id ?? ''}>
                    {p.name} ({p.team}, {p.war.toFixed(1)} WAR)
                  </option>
                ))}
            </select>
          )}
        </div>

        {/* Chart area */}
        <div className="px-6 py-5">

          {view === 'career' && (
            <>
              {!hasCareerData && (
                <p className="text-xs text-538-muted mb-3 italic">
                  Career trajectory not available for {player.name} — showing legend comparisons only.
                </p>
              )}
              <p className="text-xs text-538-muted mb-4">
                Cumulative {metric === 'war' ? 'WAR' : metric === 'off_war' ? 'offensive WAR' : 'defensive WAR'} by season vs. historical comparisons.
                Click a name below to toggle visibility.
              </p>

              <ResponsiveContainer width="100%" height={360}>
                <LineChart data={careerData} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e5e5e5)" />
                  <XAxis dataKey="year" tick={{ fontSize: 11, fill: 'var(--color-muted)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--color-muted)' }} />
                  <Tooltip content={<CustomTooltip metric={metric} />} />
                  <ReferenceLine y={0} stroke="var(--color-border)" />

                  {/* Selected player's own career line (if they are a legend) */}
                  {hasCareerData && visibleLines.has('__selected__') && (
                    <Line
                      type="monotone" dataKey="__selected__"
                      name={player.name}
                      stroke={LEGEND_COLORS['__selected__']}
                      strokeWidth={3} dot={false}
                    />
                  )}

                  {/* Legend comparison lines */}
                  {Object.keys(legendWar)
                    .filter((name) => name !== player.name)
                    .map((name, idx) => (
                      visibleLines.has(name) && (
                        <Line
                          key={name} type="monotone" dataKey={name}
                          name={name}
                          stroke={legendColor(name, idx)}
                          strokeWidth={2} dot={false}
                          strokeDasharray={name === 'Justin Verlander' ? '5 3' : undefined}
                        />
                      )
                    ))}
                </LineChart>
              </ResponsiveContainer>

              {/* Legend toggle chips */}
              <div className="flex flex-wrap gap-2 mt-4">
                {hasCareerData && (
                  <button
                    onClick={() => toggleLine('__selected__')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-opacity ${visibleLines.has('__selected__') ? 'opacity-100' : 'opacity-40'}`}
                    style={{ borderColor: LEGEND_COLORS['__selected__'], color: LEGEND_COLORS['__selected__'] }}
                  >
                    <span className="w-3 h-0.5 inline-block" style={{ backgroundColor: LEGEND_COLORS['__selected__'] }} />
                    {player.name}
                  </button>
                )}
                {Object.keys(legendWar)
                  .filter((name) => name !== player.name)
                  .map((name, idx) => {
                    const color = legendColor(name, idx)
                    return (
                      <button key={name}
                        onClick={() => toggleLine(name)}
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-opacity ${visibleLines.has(name) ? 'opacity-100' : 'opacity-40'}`}
                        style={{ borderColor: color, color }}>
                        <span className="w-3 h-0.5 inline-block" style={{ backgroundColor: color }} />
                        {name}{name === 'Justin Verlander' ? ' (P)' : ''}
                      </button>
                    )
                  })}
              </div>
            </>
          )}

          {view === 'season' && (
            <>
              <p className="text-xs text-538-muted mb-4">
                2025 season {metric === 'war' ? 'WAR' : metric === 'off_war' ? 'oWAR' : 'dWAR'} leaderboard — top 40 qualified batters (50+ PA).
                <span className="ml-1 font-semibold" style={{ color: LEGEND_COLORS['__selected__'] }}>■ {player.name}</span>
                {comparePlayer && (
                  <span className="ml-2 font-semibold" style={{ color: LEGEND_COLORS['__compare__'] }}>■ {comparePlayer.name}</span>
                )}
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b-2 border-538-border">
                      <th className="text-left py-2 px-2 text-538-muted font-bold w-8">#</th>
                      <th className="text-left py-2 px-2 text-538-muted font-bold">Player</th>
                      <th className="text-right py-2 px-2 text-538-muted font-bold">G</th>
                      <th className="text-right py-2 px-2 text-538-muted font-bold">PA</th>
                      <th className="text-right py-2 px-2 text-538-muted font-bold">WAR</th>
                      <th className="text-right py-2 px-2 text-538-muted font-bold">oWAR</th>
                      <th className="text-right py-2 px-2 text-538-muted font-bold">dWAR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {seasonData.map((row) => {
                      const fullPlayer = allPlayers.find((p) => p.name === row.fullName)
                      const isSelected = fullPlayer?.player_id === player.player_id
                      const isCompare = fullPlayer?.player_id === comparePlayerId
                      return (
                        <tr key={row.fullName}
                          className={`border-b border-538-border/40 transition-colors ${
                            isSelected ? 'font-bold' : isCompare ? 'font-semibold' : ''
                          }`}
                          style={{
                            backgroundColor: isSelected
                              ? `${LEGEND_COLORS['__selected__']}18`
                              : isCompare
                              ? `${LEGEND_COLORS['__compare__']}18`
                              : undefined,
                          }}
                        >
                          <td className="py-1.5 px-2 text-538-muted">{row.rank}</td>
                          <td className="py-1.5 px-2 text-538-text">
                            {isSelected && <span className="mr-1" style={{ color: LEGEND_COLORS['__selected__'] }}>●</span>}
                            {isCompare && <span className="mr-1" style={{ color: LEGEND_COLORS['__compare__'] }}>●</span>}
                            {row.fullName}
                            <span className="ml-1 text-538-muted">{fullPlayer?.team}</span>
                          </td>
                          <td className="py-1.5 px-2 text-right text-538-muted">{fullPlayer?.g}</td>
                          <td className="py-1.5 px-2 text-right text-538-muted">{fullPlayer?.pa}</td>
                          <td className="py-1.5 px-2 text-right font-mono">
                            {fullPlayer ? (fullPlayer.war > 0 ? '+' : '') + fullPlayer.war.toFixed(1) : '—'}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono text-538-orange">
                            {fullPlayer ? (fullPlayer.off_war > 0 ? '+' : '') + fullPlayer.off_war.toFixed(1) : '—'}
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono text-538-muted">
                            {fullPlayer ? (fullPlayer.def_war > 0 ? '+' : '') + fullPlayer.def_war.toFixed(1) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="px-6 pb-4 text-xs text-538-muted border-t border-538-border pt-3">
          WAR data via Baseball Reference (bRef bWAR). oWAR and dWAR derived from runs above average.
          {metric === 'def_war' && ' Defense: negative values indicate below-average range/fielding.'}
        </div>
      </div>
    </div>
  )
}
