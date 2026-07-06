'use client'

import { useState, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Label,
} from 'recharts'
import type { PlayerWar, LegendWar } from '../lib/types'

type WarMetric = 'war' | 'off_war' | 'def_war'
type ViewMode  = 'career' | 'season'

// ── Colors ───────────────────────────────────────────────────────────────────
const LEGEND_COLORS: Record<string, string> = {
  'Barry Bonds':      '#6A1B9A',
  'Derek Jeter':      '#00695C',
  'Albert Pujols':    '#C62828',
  'David Ortiz':      '#37474F',
  'Johnny Damon':     '#F57C00',
  'Mike Trout':       '#0277BD',
  'Justin Verlander': '#558B2F',
  'Michael Young':    '#78909C',
  'Nick Swisher':     '#A1887F',
}

const PLAYER_COLOR = '#C0392B'   // the selected player (red-orange, like Trump line)
const LEGEND_LINE  = '#AAAAAA'   // gray for the legend line, overridden per-legend

// ── Mini tooltip ─────────────────────────────────────────────────────────────
function MiniTooltip({
  active, payload, label, metricLabel,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string | number
  metricLabel: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface border border-538-border rounded px-2 py-1.5 shadow text-xs whitespace-nowrap">
      <p className="font-bold text-538-text mb-0.5">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: <span className="font-semibold">
            {p.value > 0 ? '+' : ''}{p.value.toFixed(1)} {metricLabel}
          </span>
        </p>
      ))}
    </div>
  )
}

// ── One comparison card: selected player reference vs legend career ────────────
function ComparisonCard({
  legendName,
  legendSeasons,
  playerName,
  playerValue,
  metric,
  metricLabel,
}: {
  legendName: string
  legendSeasons: Array<{ year: number; war: number; off_war: number; def_war: number }>
  playerName: string
  playerValue: number
  metric: WarMetric
  metricLabel: string
}) {
  const color = LEGEND_COLORS[legendName] ?? '#888'

  // Build chart data: one row per year in the legend's career
  const data = legendSeasons.map((s) => ({
    year: s.year,
    [legendName]: parseFloat(s[metric].toFixed(2)),
  }))

  const legendPeak = Math.max(...legendSeasons.map((s) => s[metric]))
  const legendPeakYear = legendSeasons.find((s) => s[metric] === Math.max(...legendSeasons.map((x) => x[metric])))?.year

  const allVals = legendSeasons.map((s) => s[metric])
  const yMin = Math.floor(Math.min(...allVals, playerValue) - 0.5)
  const yMax = Math.ceil(Math.max(...allVals, playerValue) + 0.5)

  return (
    <div className="border border-538-border rounded-lg p-4 bg-surface">
      {/* Card header */}
      <div className="mb-3">
        <p className="text-xs font-bold text-538-muted uppercase tracking-wide">vs.</p>
        <h3 className="text-base font-black text-538-text leading-tight">{legendName}</h3>
        {legendName === 'Justin Verlander' && (
          <span className="text-xs text-538-muted">(pitcher bWAR)</span>
        )}
      </div>

      {/* Callout row */}
      <div className="flex justify-between text-xs mb-3">
        <div>
          <span className="font-bold" style={{ color: PLAYER_COLOR }}>{playerName}</span>
          <p className="font-mono font-black" style={{ color: PLAYER_COLOR }}>
            {playerValue > 0 ? '+' : ''}{playerValue.toFixed(1)} WAR
            <span className="text-538-muted font-normal"> (2025)</span>
          </p>
        </div>
        <div className="text-right">
          <span className="font-bold" style={{ color }}>{legendName.split(' ').pop()}</span>
          <p className="font-mono font-black" style={{ color }}>
            {legendPeak > 0 ? '+' : ''}{legendPeak.toFixed(1)} WAR
            <span className="text-538-muted font-normal"> (peak {legendPeakYear})</span>
          </p>
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e5e5e5)" vertical={false} />
          <XAxis
            dataKey="year" tick={{ fontSize: 9, fill: 'var(--color-muted)' }}
            tickLine={false} axisLine={false}
            tickFormatter={(v) => `'${String(v).slice(2)}`}
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fontSize: 9, fill: 'var(--color-muted)' }}
            tickLine={false} axisLine={false}
            tickFormatter={(v) => (v > 0 ? `+${v}` : String(v))}
          />
          <Tooltip content={<MiniTooltip metricLabel={metricLabel} />} />

          {/* Horizontal reference line for the player's current season value */}
          <ReferenceLine
            y={playerValue}
            stroke={PLAYER_COLOR}
            strokeDasharray="5 3"
            strokeWidth={1.5}
            label={
              <Label
                value={playerName.split(' ').pop()!}
                position="insideTopLeft"
                style={{ fontSize: 8, fill: PLAYER_COLOR, fontWeight: 700 }}
              />
            }
          />

          {/* Legend career line */}
          <Line
            type="monotone"
            dataKey={legendName}
            stroke={color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3, stroke: color }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

interface Props {
  player: PlayerWar
  allPlayers: PlayerWar[]
  legendWar: LegendWar
  onClose: () => void
}

export default function WarComparisonModal({ player, allPlayers, legendWar, onClose }: Props) {
  const [metric, setMetric] = useState<WarMetric>('war')
  const [view, setView] = useState<ViewMode>('career')
  const [comparePlayerId, setComparePlayerId] = useState<number | null>(null)

  const metricLabel = metric === 'war' ? 'WAR' : metric === 'off_war' ? 'oWAR' : 'dWAR'

  const playerValue = player[metric]

  // Season leaderboard
  const seasonData = useMemo(() => {
    return allPlayers
      .filter((p) => p.pa >= 50)
      .sort((a, b) => b[metric] - a[metric])
      .slice(0, 40)
  }, [allPlayers, metric])

  const metricOptions: { value: WarMetric; label: string }[] = [
    { value: 'war',     label: 'Total WAR' },
    { value: 'off_war', label: 'Offense' },
    { value: 'def_war', label: 'Defense' },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-surface rounded-xl border border-538-border shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto">

        {/* ── Header ── */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-538-border sticky top-0 bg-surface z-10">
          <div>
            <h2 className="text-xl font-black text-538-text tracking-tight">{player.name}</h2>
            <p className="text-xs text-538-muted mt-0.5">
              {player.team} · {player.g} G · {player.pa} PA ·{' '}
              <span className="font-semibold" style={{ color: PLAYER_COLOR }}>{player.war.toFixed(1)} WAR</span>
              {' / '}
              <span className="text-538-orange">{player.off_war.toFixed(1)} oWAR</span>
              {' / '}
              <span className="text-538-muted">{player.def_war.toFixed(1)} dWAR</span>
            </p>
          </div>
          <button onClick={onClose} className="text-538-muted hover:text-538-text transition-colors p-1" aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Controls ── */}
        <div className="px-6 py-3 flex flex-wrap items-center gap-3 border-b border-538-border">
          <div className="inline-flex rounded border border-538-border overflow-hidden">
            {metricOptions.map((opt) => (
              <button key={opt.value} onClick={() => setMetric(opt.value)}
                className={`px-3 py-1 text-xs font-semibold transition-colors ${metric === opt.value ? 'bg-538-orange text-white' : 'text-538-muted hover:text-538-text'}`}>
                {opt.label}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded border border-538-border overflow-hidden">
            <button onClick={() => setView('career')}
              className={`px-3 py-1 text-xs font-semibold transition-colors ${view === 'career' ? 'bg-538-orange text-white' : 'text-538-muted hover:text-538-text'}`}>
              vs. Legends
            </button>
            <button onClick={() => setView('season')}
              className={`px-3 py-1 text-xs font-semibold transition-colors ${view === 'season' ? 'bg-538-orange text-white' : 'text-538-muted hover:text-538-text'}`}>
              2025 Leaderboard
            </button>
          </div>
          {view === 'season' && (
            <select
              value={comparePlayerId ?? ''}
              onChange={(e) => setComparePlayerId(e.target.value ? Number(e.target.value) : null)}
              className="text-xs border border-538-border rounded px-2 py-1 bg-surface text-538-text"
            >
              <option value="">+ Highlight another player</option>
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

        {/* ── Content ── */}
        <div className="px-6 py-5">

          {/* Career: grid of individual comparison cards */}
          {view === 'career' && (
            <>
              <p className="text-xs text-538-muted mb-5">
                Each card shows a legend&apos;s year-by-year {metricLabel} (colored line).
                The dashed line marks <span className="font-semibold" style={{ color: PLAYER_COLOR }}>{player.name}&apos;s 2025 {metricLabel}</span> ({playerValue > 0 ? '+' : ''}{playerValue.toFixed(1)}) for reference.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Object.entries(legendWar).map(([name, seasons]) => (
                  <ComparisonCard
                    key={name}
                    legendName={name}
                    legendSeasons={seasons}
                    playerName={player.name}
                    playerValue={playerValue}
                    metric={metric}
                    metricLabel={metricLabel}
                  />
                ))}
              </div>
            </>
          )}

          {/* Season: ranked leaderboard */}
          {view === 'season' && (
            <>
              <p className="text-xs text-538-muted mb-4">
                2025 {metricLabel} leaderboard — top 40 qualified batters (50+ PA).
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
                    {seasonData.map((p, i) => {
                      const isSelected = p.player_id === player.player_id
                      const isCompare  = p.player_id === comparePlayerId
                      return (
                        <tr key={p.player_id ?? p.name}
                          className="border-b border-538-border/40"
                          style={{
                            backgroundColor: isSelected ? `${PLAYER_COLOR}18` : isCompare ? '#1565C018' : undefined,
                            fontWeight: isSelected || isCompare ? 700 : undefined,
                          }}
                        >
                          <td className="py-1.5 px-2 text-538-muted">{i + 1}</td>
                          <td className="py-1.5 px-2 text-538-text">
                            {isSelected && <span className="mr-1" style={{ color: PLAYER_COLOR }}>●</span>}
                            {isCompare  && <span className="mr-1 text-blue-600">●</span>}
                            {p.name}
                            <span className="ml-1 text-538-muted font-normal">{p.team}</span>
                          </td>
                          <td className="py-1.5 px-2 text-right text-538-muted">{p.g}</td>
                          <td className="py-1.5 px-2 text-right text-538-muted">{p.pa}</td>
                          <td className="py-1.5 px-2 text-right font-mono">{(p.war > 0 ? '+' : '') + p.war.toFixed(1)}</td>
                          <td className="py-1.5 px-2 text-right font-mono text-538-orange">{(p.off_war > 0 ? '+' : '') + p.off_war.toFixed(1)}</td>
                          <td className="py-1.5 px-2 text-right font-mono text-538-muted">{(p.def_war > 0 ? '+' : '') + p.def_war.toFixed(1)}</td>
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
          WAR data via Baseball Reference (bWAR). oWAR and dWAR derived from runs above average ÷ 10.
          {metric === 'def_war' && ' Negative defensive WAR = below-average range/fielding.'}
        </div>
      </div>
    </div>
  )
}
