'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Customized,
} from 'recharts'
import type { PlayerWar, LegendWar, WarSeason } from '../lib/types'
import type { WarSearchResult } from '../app/api/war-search/route'

type WarMetric = 'war' | 'off_war' | 'def_war' | 'table'

const LEGEND_GRAY = '#CCCCCC'

function endDot(color: string, lastIndex: number) {
  return (props: any) => {
    const { cx, cy, index } = props as { cx?: number; cy?: number; index?: number }
    if (index !== lastIndex || !cx || !cy) return <g key={`skip-${index}`} />
    return (
      <circle key={`dot-${index}`} cx={cx} cy={cy} r={4} fill={color}
        stroke="var(--color-surface, #fff)" strokeWidth={1.5} />
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
  active, payload, label, metricLabel, compName, playerName,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: number
  metricLabel: string
  compName: string
  playerName: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-surface border border-538-border rounded px-2 py-1.5 shadow text-xs">
      <p className="font-bold text-538-muted mb-1">Career Year {label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name === 'legend' ? compName : playerName}:{' '}
          <span className="font-semibold">
            {p.value > 0 ? '+' : ''}{p.value.toFixed(1)} {metricLabel}
          </span>
        </p>
      ))}
    </div>
  )
}

// ── Between-lines grey fill (Recharts Customized) ─────────────────────────────
interface ChartPoint {
  careerYear: number
  legend: number | null
  player: number | null
}

function BetweenFill({
  chartData,
  xAxisMap,
  yAxisMap,
}: {
  chartData: ChartPoint[]
  xAxisMap?: Record<number, { scale: (v: number) => number }>
  yAxisMap?: Record<number, { scale: (v: number) => number }>
}) {
  const xScale = xAxisMap?.[0]?.scale
  const yScale = yAxisMap?.[0]?.scale
  if (!xScale || !yScale) return null

  const valid = chartData.filter((d) => d.player != null && d.legend != null)
  if (valid.length < 2) return null

  const top = valid.map((d) => `${xScale(d.careerYear).toFixed(1)},${Math.min(yScale(d.player!), yScale(d.legend!)).toFixed(1)}`)
  const bot = [...valid].reverse().map((d) => `${xScale(d.careerYear).toFixed(1)},${Math.max(yScale(d.player!), yScale(d.legend!)).toFixed(1)}`)

  return <polygon points={[...top, ...bot].join(' ')} fill="rgba(156,163,175,0.2)" />
}

// ── Comparison card ───────────────────────────────────────────────────────────
function ComparisonCard({
  compName, compCareer, playerName, playerTeam, playerCareer, metric, metricLabel,
}: {
  compName: string
  compCareer: WarSeason[]
  playerName: string
  playerTeam: string
  playerCareer: WarSeason[]
  metric: 'war' | 'off_war' | 'def_war'
  metricLabel: string
}) {
  const playerColor = getTeamColor(playerTeam)
  const maxYears = Math.max(compCareer.length, playerCareer.length)

  const data: ChartPoint[] = Array.from({ length: maxYears }, (_, i) => ({
    careerYear: i + 1,
    legend: i < compCareer.length  ? parseFloat((compCareer[i][metric]  ?? 0).toFixed(2)) : null,
    player: i < playerCareer.length ? parseFloat((playerCareer[i][metric] ?? 0).toFixed(2)) : null,
  }))

  const compVals   = compCareer.map((s)   => s[metric] ?? 0)
  const playerVals = playerCareer.map((s) => s[metric] ?? 0)
  const allVals    = [...compVals, ...playerVals].filter((v) => v != null) as number[]
  const compPeak   = Math.max(...compVals)
  const yMin = Math.floor(Math.min(...allVals) - 0.5)
  const yMax = Math.ceil(Math.max(...allVals) + 0.5)
  const playerPeak    = playerVals.length ? Math.max(...playerVals) : 0
  const playerCurrent = playerVals.length ? playerVals[playerVals.length - 1] : 0

  return (
    <div className="border border-538-border rounded-lg p-4 bg-surface">
      <div className="mb-2">
        <p className="text-xs font-bold text-538-muted uppercase tracking-wide">vs.</p>
        <h3 className="text-base font-black text-538-text leading-tight">{compName}</h3>
        {compName === 'Justin Verlander' && (
          <span className="text-[10px] text-538-muted">(pitcher bWAR)</span>
        )}
      </div>

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
          <span className="font-bold text-538-muted">{compName.split(' ').pop()}</span>
          <p className="font-mono font-black text-538-muted">
            {compPeak > 0 ? '+' : ''}{compPeak.toFixed(1)}{' '}
            <span className="font-normal">career peak</span>
          </p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={data} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e5e5e5)" vertical={false} />
          <XAxis dataKey="careerYear" tick={{ fontSize: 9, fill: 'var(--color-muted, #888)' }}
            tickLine={false} axisLine={false} tickFormatter={(v) => `Yr ${v}`} interval="preserveStartEnd" />
          <YAxis domain={[yMin, yMax]} tick={{ fontSize: 9, fill: 'var(--color-muted, #888)' }}
            tickLine={false} axisLine={false} tickFormatter={(v) => (v > 0 ? `+${v}` : String(v))} />
          <ReferenceLine y={0} stroke="var(--color-border, #e5e5e5)" strokeWidth={1} />
          <Tooltip content={
            <ChartTooltip metricLabel={metricLabel} compName={compName} playerName={playerName} />
          } />
          {/* Grey fill between lines */}
          <Customized component={<BetweenFill chartData={data} />} />
          {/* Comparison line — dashed grey */}
          <Line type="monotone" dataKey="legend" stroke={LEGEND_GRAY} strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={endDot(LEGEND_GRAY, compCareer.length - 1)}
            activeDot={{ r: 3, stroke: LEGEND_GRAY }} connectNulls={false} />
          {/* Player line — solid team color */}
          <Line type="monotone" dataKey="player" stroke={playerColor} strokeWidth={2.5}
            dot={endDot(playerColor, playerCareer.length - 1)}
            activeDot={{ r: 3, stroke: playerColor }} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ── Custom pick card ──────────────────────────────────────────────────────────
function CustomPickCard({
  playerName, playerTeam, playerCareer, metric, metricLabel,
}: {
  playerName: string
  playerTeam: string
  playerCareer: WarSeason[]
  metric: 'war' | 'off_war' | 'def_war'
  metricLabel: string
}) {
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState<WarSearchResult[]>([])
  const [loading, setLoading]   = useState(false)
  const [picked, setPicked]     = useState<WarSearchResult | null>(null)
  const [open, setOpen]         = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Debounced search
  useEffect(() => {
    if (query.length < 2) { setResults([]); setOpen(false); return }
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/war-search?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        setResults(data)
        setOpen(true)
      } finally {
        setLoading(false)
      }
    }, 280)
    return () => clearTimeout(t)
  }, [query])

  const playerColor = getTeamColor(playerTeam)
  const compColor   = picked?.team ? getTeamColor(picked.team) : LEGEND_GRAY

  // Build chart data when a player is picked
  let chartEl: React.ReactNode = null
  if (picked) {
    const maxYears = Math.max(picked.career.length, playerCareer.length)
    const data: ChartPoint[] = Array.from({ length: maxYears }, (_, i) => ({
      careerYear: i + 1,
      legend: i < picked.career.length  ? parseFloat((picked.career[i][metric]  ?? 0).toFixed(2)) : null,
      player: i < playerCareer.length    ? parseFloat((playerCareer[i][metric]   ?? 0).toFixed(2)) : null,
    }))
    const compVals   = picked.career.map((s)  => s[metric] ?? 0)
    const playerVals = playerCareer.map((s)   => s[metric] ?? 0)
    const allVals    = [...compVals, ...playerVals].filter((v) => v != null) as number[]
    const yMin = Math.floor(Math.min(...allVals) - 0.5)
    const yMax = Math.ceil(Math.max(...allVals) + 0.5)
    const compPeak   = compVals.length   ? Math.max(...compVals) : 0
    const playerPeak = playerVals.length ? Math.max(...playerVals) : 0
    const playerCurrent = playerVals.length ? playerVals[playerVals.length - 1] : 0

    chartEl = (
      <>
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
            <span className="font-bold" style={{ color: compColor }}>{picked.name.split(' ').pop()}</span>
            <p className="font-mono font-black" style={{ color: compColor }}>
              {compPeak > 0 ? '+' : ''}{compPeak.toFixed(1)}{' '}
              <span className="font-normal text-538-muted">career peak</span>
            </p>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={150}>
          <LineChart data={data} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border, #e5e5e5)" vertical={false} />
            <XAxis dataKey="careerYear" tick={{ fontSize: 9, fill: 'var(--color-muted, #888)' }}
              tickLine={false} axisLine={false} tickFormatter={(v) => `Yr ${v}`} interval="preserveStartEnd" />
            <YAxis domain={[yMin, yMax]} tick={{ fontSize: 9, fill: 'var(--color-muted, #888)' }}
              tickLine={false} axisLine={false} tickFormatter={(v) => (v > 0 ? `+${v}` : String(v))} />
            <ReferenceLine y={0} stroke="var(--color-border, #e5e5e5)" strokeWidth={1} />
            <Tooltip content={
              <ChartTooltip metricLabel={metricLabel} compName={picked.name} playerName={playerName} />
            } />
            <Customized component={<BetweenFill chartData={data} />} />
            {/* Custom pick line — dashed */}
            <Line type="monotone" dataKey="legend" stroke={compColor} strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={endDot(compColor, picked.career.length - 1)}
              activeDot={{ r: 3, stroke: compColor }} connectNulls={false} />
            {/* Player line — solid */}
            <Line type="monotone" dataKey="player" stroke={playerColor} strokeWidth={2.5}
              dot={endDot(playerColor, playerCareer.length - 1)}
              activeDot={{ r: 3, stroke: playerColor }} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </>
    )
  }

  return (
    <div className="border border-538-border rounded-lg p-4 bg-surface">
      <div className="mb-3">
        <p className="text-xs font-bold text-538-muted uppercase tracking-wide mb-1">Pick your own</p>

        <div ref={containerRef} className="relative">
          <div className="flex items-center gap-1.5">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); if (picked) setPicked(null) }}
              onFocus={() => results.length > 0 && setOpen(true)}
              placeholder="Search any player, past or present…"
              className="flex-1 text-xs bg-transparent border border-538-border rounded px-2 py-1.5 text-538-text placeholder:text-538-muted focus:outline-none focus:border-538-text transition-colors"
            />
            {(query || picked) && (
              <button
                onClick={() => { setQuery(''); setPicked(null); setResults([]); setOpen(false); inputRef.current?.focus() }}
                className="text-538-muted hover:text-538-text transition-colors text-xs px-1"
              >✕</button>
            )}
          </div>

          {/* Dropdown */}
          {open && results.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-20 mt-0.5 bg-surface border border-538-border rounded shadow-lg overflow-hidden">
              {results.map((r, i) => (
                <button
                  key={i}
                  onClick={() => { setPicked(r); setQuery(r.name); setOpen(false) }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-538-border/30 transition-colors flex items-center justify-between gap-2"
                >
                  <span className="font-semibold text-538-text">{r.name}</span>
                  <span className="text-538-muted shrink-0">
                    {r.team ? `${r.team} · ` : ''}{r.player_type ?? 'Legend'}
                  </span>
                </button>
              ))}
            </div>
          )}
          {open && loading && (
            <div className="absolute top-full left-0 right-0 z-20 mt-0.5 bg-surface border border-538-border rounded shadow px-3 py-2 text-xs text-538-muted">
              Searching…
            </div>
          )}
          {open && !loading && results.length === 0 && query.length >= 2 && (
            <div className="absolute top-full left-0 right-0 z-20 mt-0.5 bg-surface border border-538-border rounded shadow px-3 py-2 text-xs text-538-muted">
              No players found
            </div>
          )}
        </div>
      </div>

      {picked ? (
        chartEl
      ) : (
        <div className="flex items-center justify-center h-[168px] text-538-muted text-xs text-center px-4">
          Search above to compare {playerName} against any player in MLB history
        </div>
      )}
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

  const metricLabel = activeMetric === 'war' ? 'WAR' : activeMetric === 'off_war' ? 'oWAR' : activeMetric === 'def_war' ? 'dWAR' : ''
  const playerColor = getTeamColor(player.team)
  const isTableView = activeMetric === 'table'

  const metricOptions: { value: WarMetric; label: string }[] = [
    { value: 'war',     label: 'Total WAR' },
    ...(!isPitcher ? [
      { value: 'off_war' as WarMetric, label: 'Offense' },
      { value: 'def_war' as WarMetric, label: 'Defense' },
    ] : []),
    { value: 'table', label: 'Table' },
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
                {isPitcher ? ` · ${player.ip?.toFixed(1) ?? '—'} IP` : ` · ${player.pa} PA`}
              </span>
              <span>
                <span className="font-semibold" style={{ color: playerColor }}>{player.war.toFixed(1)} WAR</span>
                {player.off_war != null && <>{' / '}<span style={{ color: playerColor }}>{player.off_war.toFixed(1)} oWAR</span></>}
                {player.def_war != null && <>{' / '}<span className="text-538-muted">{player.def_war.toFixed(1)} dWAR</span></>}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-1">
            {player.player_id != null && (
              <Link
                href={isPitcher ? `/pitchers/${player.player_id}` : `/batters/${player.player_id}`}
                className="flex items-center gap-1 text-xs font-semibold text-538-muted hover:text-538-text transition-colors px-2 py-1 rounded hover:bg-538-border/30"
                onClick={onClose}
              >
                <span>Stats</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </Link>
            )}
            <button onClick={onClose} className="text-538-muted hover:text-538-text transition-colors p-1" aria-label="Close">
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
                <span className="inline-block w-5 border-b-2" style={{ borderColor: playerColor }} />
                {player.name}
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-5 border-b-2 border-dashed" style={{ borderColor: LEGEND_GRAY }} />
                Comparison
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
          <div className="px-4 sm:px-6 py-5">
            <p className="text-xs text-538-muted mb-5">
              X-axis = career year (Year 1 = MLB debut).{' '}
              <span style={{ color: playerColor }} className="font-semibold">{player.name}</span>
              {' '}career arc vs. each comparison&apos;s full career.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {/* Custom pick card always first */}
              <CustomPickCard
                playerName={player.name}
                playerTeam={player.team}
                playerCareer={player.career}
                metric={activeMetric as 'war' | 'off_war' | 'def_war'}
                metricLabel={metricLabel}
              />
              {/* Pre-set legend cards */}
              {Object.entries(legendWar).map(([name, seasons]) => (
                <ComparisonCard
                  key={name}
                  compName={name}
                  compCareer={seasons as unknown as WarSeason[]}
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
