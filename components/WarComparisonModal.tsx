'use client'

import { useState } from 'react'
import Link from 'next/link'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import type { PlayerWar, LegendWar, WarSeason } from '../lib/types'

type WarMetric = 'war' | 'off_war' | 'def_war' | 'table'

const LEGEND_GRAY = '#CCCCCC'

// Renders a filled circle only at the last data point of a line.
// Must return a ReactElement (not null) to satisfy Recharts' LineDot type.
function endDot(color: string, lastIndex: number) {
  return (props: any) => {
    const { cx, cy, index } = props as { cx?: number; cy?: number; index?: number }
    if (index !== lastIndex || !cx || !cy) return <g key={`skip-${index}`} />
    return (
      <circle
        key={`dot-${index}`}
        cx={cx}
        cy={cy}
        r={4}
        fill={color}
        stroke="var(--color-surface, #fff)"
        strokeWidth={1.5}
      />
    )
  }
}

const TEAM_COLORS: Record<string, string> = {
  BAL: '#DF4601', BOS: '#BD3039', NYY: '#003087', TBR: '#092C5C', TOR: '#134A8E',
  CHW: '#27251F', CLE: '#E31937', DET: '#0C2340', KCR: '#004687', MIN: '#002B5C',
  HOU: '#EB6E1F', LAA: '#BA0021', OAK: '#003831', SEA: '#0C2C56', TEX: '#003278',
  ATL: '#CE1141', MIA: '#00A3E0', NYM: '#002D72', PHI: '#E81828', WSN: '#AB0003',
  CHC: '#0E3386', CIN: '#C6011F', MIL: '#12284B', PIT: '#FDB827', STL: '#C41E3A',
  ARI: '#A71930', COL: '#333366', LAD: '#005A9C', SDP: '#2F241D', SFG: '#FD5A1E',
  TB: '#092C5C', KC: '#004687', SD: '#2F241D', SF: '#FD5A1E',
  CWS: '#27251F', WSH: '#AB0003',
}

export function getTeamColor(team: string): string {
  return TEAM_COLORS[team] ?? '#888888'
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
function ChartTooltip({
  active, payload, label, metricLabel, legendName, playerName,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: number
  metricLabel: string
  legendName: string
  playerName: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface border border-538-border rounded px-2 py-1.5 shadow text-xs">
      <p className="font-bold text-538-muted mb-1">Career Year {label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name === 'legend' ? legendName : playerName}:{' '}
          <span className="font-semibold">
            {p.value > 0 ? '+' : ''}{p.value.toFixed(1)} {metricLabel}
          </span>
        </p>
      ))}
    </div>
  )
}

// ── One card: player career arc vs a single legend's career arc ───────────────
function ComparisonCard({
  legendName,
  legendSeasons,
  playerName,
  playerTeam,
  playerCareer,
  metric,
  metricLabel,
}: {
  legendName: string
  legendSeasons: WarSeason[]
  playerName: string
  playerTeam: string
  playerCareer: WarSeason[]
  metric: 'war' | 'off_war' | 'def_war'
  metricLabel: string
}) {
  const playerColor = getTeamColor(playerTeam)
  const maxYears    = Math.max(legendSeasons.length, playerCareer.length)

  // Merge both careers onto a shared career-year x-axis
  const data = Array.from({ length: maxYears }, (_, i) => ({
    careerYear: i + 1,
    legend: i < legendSeasons.length ? parseFloat((legendSeasons[i][metric] ?? 0).toFixed(2)) : null,
    player: i < playerCareer.length  ? parseFloat((playerCareer[i][metric]  ?? 0).toFixed(2)) : null,
  }))

  const legendVals = legendSeasons.map((s) => s[metric] ?? 0)
  const playerVals = playerCareer.map((s)  => s[metric] ?? 0)
  const allVals    = [...legendVals, ...playerVals].filter((v) => v != null) as number[]
  const legendPeak = Math.max(...legendVals)
  const yMin = Math.floor(Math.min(...allVals) - 0.5)
  const yMax = Math.ceil(Math.max(...allVals)  + 0.5)

  const playerPeak    = playerVals.length ? Math.max(...playerVals) : 0
  const playerCurrent = playerVals.length ? playerVals[playerVals.length - 1] : 0

  return (
    <div className="border border-538-border rounded-lg p-4 bg-surface">
      <div className="mb-2">
        <p className="text-xs font-bold text-538-muted uppercase tracking-wide">vs.</p>
        <h3 className="text-base font-black text-538-text leading-tight">{legendName}</h3>
        {legendName === 'Justin Verlander' && (
          <span className="text-[10px] text-538-muted">(pitcher bWAR)</span>
        )}
      </div>

      {/* Callout */}
      <div className="flex justify-between text-xs mb-3">
        <div>
          <span className="font-bold" style={{ color: playerColor }}>{playerName}</span>
          <p className="font-mono font-black" style={{ color: playerColor }}>
            {playerCurrent > 0 ? '+' : ''}{playerCurrent.toFixed(1)}{' '}
            <span className="font-normal text-538-muted">this season</span>
          </p>
          {playerPeak !== playerCurrent && (
            <p className="font-mono text-[10px]" style={{ color: playerColor, opacity: 0.7 }}>
              {playerPeak > 0 ? '+' : ''}{playerPeak.toFixed(1)} career peak
            </p>
          )}
        </div>
        <div className="text-right">
          <span className="font-bold text-538-muted">{legendName.split(' ').pop()}</span>
          <p className="font-mono font-black text-538-muted">
            {legendPeak > 0 ? '+' : ''}{legendPeak.toFixed(1)}{' '}
            <span className="font-normal">career peak</span>
          </p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={data} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border, #e5e5e5)"
            vertical={false}
          />
          <XAxis
            dataKey="careerYear"
            tick={{ fontSize: 9, fill: 'var(--color-muted, #888)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `Yr ${v}`}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[yMin, yMax]}
            tick={{ fontSize: 9, fill: 'var(--color-muted, #888)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => (v > 0 ? `+${v}` : String(v))}
          />
          <ReferenceLine y={0} stroke="var(--color-border, #e5e5e5)" strokeWidth={1} />
          <Tooltip
            content={
              <ChartTooltip
                metricLabel={metricLabel}
                legendName={legendName}
                playerName={playerName}
              />
            }
          />
          {/* Legend career — gray */}
          <Line
            type="monotone"
            dataKey="legend"
            stroke={LEGEND_GRAY}
            strokeWidth={2}
            dot={endDot(LEGEND_GRAY, legendSeasons.length - 1)}
            activeDot={{ r: 3, stroke: LEGEND_GRAY }}
            connectNulls={false}
          />
          {/* Player career — team color */}
          <Line
            type="monotone"
            dataKey="player"
            stroke={playerColor}
            strokeWidth={2.5}
            dot={endDot(playerColor, playerCareer.length - 1)}
            activeDot={{ r: 3, stroke: playerColor }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Career stats table ────────────────────────────────────────────────────────

function fmt3(v: number | null | undefined) {
  if (v == null) return '—'
  return v.toFixed(3).replace(/^0/, '')
}

function CareerTable({ career, playerColor }: { career: WarSeason[]; playerColor: string }) {
  const hasStats = career.some(s => s.h != null)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b-2 border-538-border">
            <th className="text-left py-2 px-2 text-538-muted font-bold sticky left-0 bg-surface">Year</th>
            <th className="text-left py-2 px-2 text-538-muted font-bold">Team</th>
            <th className="text-right py-2 px-2 text-538-muted font-bold">G</th>
            {hasStats && <>
              <th className="text-right py-2 px-2 text-538-muted font-bold">PA</th>
              <th className="text-right py-2 px-2 text-538-muted font-bold">H</th>
              <th className="text-right py-2 px-2 text-538-muted font-bold">BB</th>
              <th className="text-right py-2 px-2 text-538-muted font-bold">K</th>
              <th className="text-right py-2 px-2 text-538-muted font-bold">AVG</th>
              <th className="text-right py-2 px-2 text-538-muted font-bold">OBP</th>
              <th className="text-right py-2 px-2 text-538-muted font-bold">SLG</th>
              <th className="text-right py-2 px-2 text-538-muted font-bold">OPS</th>
            </>}
            <th className="text-right py-2 px-2 text-538-muted font-bold">oWAR</th>
            <th className="text-right py-2 px-2 text-538-muted font-bold">dWAR</th>
            <th className="text-right py-2 px-2 text-538-muted font-bold" style={{ color: playerColor }}>WAR</th>
            <th className="text-right py-2 px-2 text-538-muted font-bold">RAR/G</th>
          </tr>
        </thead>
        <tbody>
          {career.map((s, i) => {
            const rar = (s.g ?? 0) > 0 ? (s.war * 10) / (s.g ?? 1) : 0
            return (
              <tr key={i} className={`border-b border-538-border/40 ${i % 2 === 1 ? 'bg-black/[0.02] dark:bg-white/[0.02]' : ''}`}>
                <td className="py-1.5 px-2 font-semibold sticky left-0 bg-surface" style={{ color: playerColor }}>{s.year}</td>
                <td className="py-1.5 px-2 text-538-muted">{s.team ?? '—'}</td>
                <td className="py-1.5 px-2 text-right tabular text-538-muted">{s.g ?? '—'}</td>
                {hasStats && <>
                  <td className="py-1.5 px-2 text-right tabular text-538-muted">{s.pa ?? '—'}</td>
                  <td className="py-1.5 px-2 text-right tabular text-538-muted">{s.h ?? '—'}</td>
                  <td className="py-1.5 px-2 text-right tabular text-538-muted">{s.bb ?? '—'}</td>
                  <td className="py-1.5 px-2 text-right tabular text-538-muted">{s.k ?? '—'}</td>
                  <td className="py-1.5 px-2 text-right tabular font-mono">{fmt3(s.avg)}</td>
                  <td className="py-1.5 px-2 text-right tabular font-mono">{fmt3(s.obp)}</td>
                  <td className="py-1.5 px-2 text-right tabular font-mono">{fmt3(s.slg)}</td>
                  <td className="py-1.5 px-2 text-right tabular font-mono font-semibold">{fmt3(s.ops)}</td>
                </>}
                <td className="py-1.5 px-2 text-right tabular font-mono">{s.off_war != null ? s.off_war.toFixed(1) : '—'}</td>
                <td className="py-1.5 px-2 text-right tabular font-mono">{s.def_war != null ? s.def_war.toFixed(1) : '—'}</td>
                <td className="py-1.5 px-2 text-right tabular font-mono font-bold" style={{ color: playerColor }}>{s.war > 0 ? '+' : ''}{s.war.toFixed(1)}</td>
                <td className="py-1.5 px-2 text-right tabular font-mono text-538-muted">{rar > 0 ? '+' : ''}{rar.toFixed(2)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}


// ── Modal ─────────────────────────────────────────────────────────────────────
interface Props {
  player: PlayerWar
  legendWar: LegendWar
  onClose: () => void
}

export default function WarComparisonModal({ player, legendWar, onClose }: Props) {
  const [metric, setMetric] = useState<WarMetric>('war')

  const isPitcher = player.player_type === 'pitcher'
  const activeMetric = isPitcher && (metric === 'off_war' || metric === 'def_war') ? 'war' : metric

  const metricLabel  = activeMetric === 'war' ? 'WAR' : activeMetric === 'off_war' ? 'oWAR' : activeMetric === 'def_war' ? 'dWAR' : ''
  const playerColor  = getTeamColor(player.team)
  const isTableView  = activeMetric === 'table'

  const metricOptions: { value: WarMetric; label: string }[] = [
    { value: 'war',     label: 'Total WAR' },
    ...(!isPitcher ? [
      { value: 'off_war' as WarMetric, label: 'Offense' },
      { value: 'def_war' as WarMetric, label: 'Defense' },
    ] : []),
    { value: 'table',   label: 'Table'     },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-surface rounded-t-2xl sm:rounded-xl border border-538-border shadow-2xl w-full sm:max-w-5xl max-h-[92dvh] overflow-y-auto">

        {/* Header */}
        <div className="flex items-start justify-between px-4 sm:px-6 pt-5 pb-4 border-b border-538-border sticky top-0 bg-surface z-10">
          <div>
            <h2 className="text-lg sm:text-xl font-black text-538-text tracking-tight">{player.name}</h2>
            <p className="text-xs text-538-muted mt-0.5 flex flex-wrap gap-x-2">
              <span>
                {player.team} · {player.g} G
                {isPitcher
                  ? ` · ${player.ip?.toFixed(1) ?? '—'} IP`
                  : ` · ${player.pa} PA`
                }
              </span>
              <span>
                <span className="font-semibold" style={{ color: playerColor }}>{player.war.toFixed(1)} WAR</span>
                {player.off_war != null && <>{' / '}<span style={{ color: playerColor }}>{player.off_war.toFixed(1)} oWAR</span></>}
                {player.def_war != null && <>{' / '}<span className="text-538-muted">{player.def_war.toFixed(1)} dWAR</span></>}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-1">
            {(isPitcher || player.player_id != null) && (
              <Link
                href={isPitcher ? '/pitchers' : `/batters/${player.player_id}`}
                className="text-538-muted hover:text-538-text transition-colors p-1 rounded"
                title="View stats page"
                onClick={onClose}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </Link>
            )}
            <button
              onClick={onClose}
              className="text-538-muted hover:text-538-text transition-colors p-1"
              aria-label="Close"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="px-4 sm:px-6 py-3 border-b border-538-border flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded border border-538-border overflow-hidden shrink-0">
            {metricOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setMetric(opt.value)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                  activeMetric === opt.value ? 'text-white' : 'text-538-muted hover:text-538-text'
                }`}
                style={activeMetric === opt.value ? { backgroundColor: playerColor } : {}}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {!isTableView && (
            <span className="text-xs text-538-muted flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1">
                <span className="inline-block w-5 border-b-2 border-dashed" style={{ borderColor: LEGEND_GRAY }} />
                Legend
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-5 border-b-2" style={{ borderColor: playerColor }} />
                {player.name}
              </span>
            </span>
          )}
        </div>

        {/* Table view */}
        {isTableView ? (
          <div className="px-4 sm:px-6 py-5">
            <p className="text-xs text-538-muted mb-4">
              Season-by-season career stats for{' '}
              <span className="font-semibold" style={{ color: playerColor }}>{player.name}</span>.
            </p>
            <CareerTable career={player.career} playerColor={playerColor} />
          </div>
        ) : (
          /* Chart cards */
          <div className="px-4 sm:px-6 py-5">
            <p className="text-xs text-538-muted mb-5">
              X-axis = career year (Year 1 = MLB debut). {' '}
              <span style={{ color: playerColor }} className="font-semibold">{player.name}</span>
              {' '}career arc vs. each legend&apos;s full career.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(legendWar).map(([name, seasons]) => (
                <ComparisonCard
                  key={name}
                  legendName={name}
                  legendSeasons={seasons}
                  playerName={player.name}
                  playerTeam={player.team}
                  playerCareer={player.career}
                  metric={activeMetric as 'war' | 'off_war' | 'def_war'}
                  metricLabel={metricLabel}
                />
              ))}
            </div>
          </div>
        )}

        <div className="px-4 sm:px-6 pb-4 text-xs text-538-muted border-t border-538-border pt-3">
          WAR data via Baseball Reference (bWAR). oWAR = total WAR − dWAR (batting + baserunning + positional adj + replacement level).
        </div>
      </div>
    </div>
  )
}
