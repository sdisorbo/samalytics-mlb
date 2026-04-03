'use client'

import { useState, useMemo } from 'react'
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
  type TooltipProps,
} from 'recharts'
import type { Pitcher } from '@/lib/types'
import { teamColor, DIVISION_ORDER, normalizeDivision } from '@/lib/teamColors'
import clsx from 'clsx'

// ── Constants ──────────────────────────────────────────────────────────────────

const DIVISION_TEAMS: Record<string, string[]> = {
  'AL East':    ['BAL', 'BOS', 'NYY', 'TB',  'TOR'],
  'AL Central': ['CWS', 'CLE', 'DET', 'KC',  'MIN'],
  'AL West':    ['HOU', 'LAA', 'OAK', 'SEA', 'TEX'],
  'NL East':    ['ATL', 'MIA', 'NYM', 'PHI', 'WSH'],
  'NL Central': ['CHC', 'CIN', 'MIL', 'PIT', 'STL'],
  'NL West':    ['AZ',  'COL', 'LAD', 'SD',  'SF'],
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function stableJitter(seed: number): number {
  let s = seed | 0
  s = Math.imul(s ^ (s >>> 16), 0x45d9f3b)
  s = Math.imul(s ^ (s >>> 16), 0x45d9f3b)
  s = s ^ (s >>> 16)
  return ((s >>> 0) / 0x100000000) * 0.55 - 0.275
}

/** Scale IP to dot radius: 20 IP → 4px, 120 IP → 7px, 220+ IP → 11px */
function ipToRadius(ip: number): number {
  return Math.max(4, Math.min(11, 4 + (Math.min(ip, 220) - 20) / 200 * 7))
}

// ── Tooltip ────────────────────────────────────────────────────────────────────

type PlotPitcher = Pitcher & { x: number; y: number }

function PitcherTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.[0]) return null
  const d = payload[0].payload as PlotPitcher
  const color = teamColor(d.team)
  return (
    <div className="bg-surface border border-538-border rounded shadow-md px-3 py-2.5 text-xs min-w-[170px] z-50">
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="inline-flex items-center justify-center w-8 h-5 rounded text-white font-bold shrink-0"
          style={{ backgroundColor: color, fontSize: '0.6rem' }}
        >
          {d.team}
        </span>
        <span className="font-bold text-538-text leading-tight">{d.name}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 tabular">
        <span className="text-538-muted">FIP %ile</span> <span className="font-bold">{d.fip_percentile}</span>
        <span className="text-538-muted">FIP</span>      <span>{d.fip?.toFixed(2) ?? '—'}</span>
        <span className="text-538-muted">ERA</span>      <span>{d.era?.toFixed(2) ?? '—'}</span>
        <span className="text-538-muted">K/9</span>      <span>{d.k_per_9.toFixed(1)}</span>
        <span className="text-538-muted">BB/9</span>     <span>{d.bb_per_9.toFixed(1)}</span>
        <span className="text-538-muted">IP</span>       <span>{d.innings_pitched}</span>
      </div>
    </div>
  )
}

// ── Single team strip ──────────────────────────────────────────────────────────

interface StripProps {
  abbr: string
  pitchers: PlotPitcher[]
  isLast: boolean
}

function TeamStrip({ abbr, pitchers, isLast }: StripProps) {
  const color = teamColor(abbr)
  const height = isLast ? 98 : 58

  return (
    <div
      className={clsx('flex items-stretch', !isLast && 'border-b border-538-border')}
      style={{ height }}
    >
      {/* Team badge column */}
      <div
        className="w-14 shrink-0 border-r border-538-border flex items-center justify-center"
        style={{ backgroundColor: `${color}12` }}
      >
        <span
          className="text-white font-black rounded px-1.5 py-0.5 tracking-wide"
          style={{ backgroundColor: color, fontSize: '0.6rem' }}
        >
          {abbr}
        </span>
      </div>

      {/* Strip chart */}
      <div className="flex-1 relative">
        {pitchers.length === 0 ? (
          <div className="h-full flex items-center pl-4 text-2xs text-538-muted italic">
            No qualifying pitchers
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 16, bottom: isLast ? 38 : 8, left: 4 }}>
              <XAxis
                type="number"
                dataKey="x"
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                hide={!isLast}
                tick={{ fontSize: 10, fill: '#8A6248' }}
                axisLine={{ stroke: '#DDD0C0' }}
                tickLine={false}
                label={
                  isLast
                    ? { value: 'FIP Percentile  (100 = best in league)', position: 'insideBottom', offset: -14, fontSize: 10, fill: '#8A6248' }
                    : undefined
                }
              />
              <YAxis type="number" dataKey="y" domain={[-1, 1]} hide />
              <ReferenceLine x={50} stroke="#E0CEC0" strokeDasharray="3 3" />
              <Tooltip content={<PitcherTooltip />} cursor={false} />
              <Scatter
                data={pitchers}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                shape={(props: any) => {
                  const { cx, cy, payload } = props as { cx: number; cy: number; payload: PlotPitcher }
                  const r = ipToRadius(payload.innings_pitched)
                  return (
                    <circle
                      cx={cx} cy={cy} r={r}
                      fill={color}
                      fillOpacity={0.82}
                      stroke="white"
                      strokeWidth={0.8}
                    />
                  )
                }}
              />
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}

// ── Percentile pip ─────────────────────────────────────────────────────────────

function PercentilePip({ value }: { value: number }) {
  const color = value >= 70 ? '#3A7A3A' : value >= 40 ? '#9B5A3A' : '#C04030'
  return (
    <div className="flex items-center gap-1.5 justify-end">
      <div className="w-14 pct-bar">
        <div className="h-full rounded" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
      <span className="tabular w-6 text-right text-2xs font-bold" style={{ color }}>{value}</span>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  pitchers: Pitcher[]
}

export default function PitcherScatter({ pitchers }: Props) {
  // Default to first division that has data
  const availableDivisions = useMemo(() => {
    const names = new Set(pitchers.map(p => normalizeDivision(p.division)))
    return DIVISION_ORDER.filter(d => names.has(d))
  }, [pitchers])

  const [division, setDivision] = useState<string>(availableDivisions[0] ?? DIVISION_ORDER[0])
  const [minIP, setMinIP] = useState(20)

  const activeDivision = availableDivisions.includes(division) ? division : (availableDivisions[0] ?? DIVISION_ORDER[0])
  const divisionTeams = DIVISION_TEAMS[activeDivision] ?? []

  // Build per-team pitcher lists
  const pitchersByTeam = useMemo(() => {
    const map = new Map<string, PlotPitcher[]>()
    for (const abbr of divisionTeams) map.set(abbr, [])

    for (const p of pitchers) {
      if (normalizeDivision(p.division) !== activeDivision) continue
      if (p.innings_pitched < minIP) continue
      if (p.fip_percentile == null) continue
      const arr = map.get(p.team) ?? []
      arr.push({
        ...p,
        x: p.fip_percentile,
        y: stableJitter(p.player_id ?? Math.floor(Math.random() * 9999)),
      })
      map.set(p.team, arr)
    }
    return map
  }, [pitchers, activeDivision, minIP, divisionTeams])

  const totalPitchers = Array.from(pitchersByTeam.values()).reduce((n, arr) => n + arr.length, 0)

  return (
    <div>
      {/* Division tabs */}
      <div className="flex border border-538-border rounded overflow-hidden mb-5">
        {availableDivisions.map((div, i) => (
          <button
            key={div}
            onClick={() => setDivision(div)}
            className={clsx(
              'flex-1 px-2 py-2 text-xs font-semibold transition-colors whitespace-nowrap',
              i > 0 && 'border-l border-538-border',
              div === activeDivision
                ? 'bg-538-orange text-white'
                : 'bg-surface text-538-muted hover:bg-538-header hover:text-538-text'
            )}
          >
            {div}
          </button>
        ))}
      </div>

      {/* Subtitle + controls */}
      <div className="flex items-center gap-4 mb-3">
        <p className="text-xs text-538-muted">
          {totalPitchers} pitchers · dot size = innings pitched
        </p>
        <label className="flex items-center gap-2 text-xs text-538-muted ml-auto">
          Min IP:
          <select
            value={minIP}
            onChange={e => setMinIP(Number(e.target.value))}
            className="border border-538-border rounded px-1.5 py-0.5 text-xs bg-surface"
          >
            {[20, 40, 60, 80, 100].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
      </div>

      {/* Team strips */}
      <div className="stat-card p-0 overflow-hidden">
        {divisionTeams.map((abbr, i) => (
          <TeamStrip
            key={abbr}
            abbr={abbr}
            pitchers={pitchersByTeam.get(abbr) ?? []}
            isLast={i === divisionTeams.length - 1}
          />
        ))}
      </div>

      {/* Top 25 table */}
      <div className="stat-card p-0 overflow-hidden mt-6">
        <div className="px-4 pt-3 pb-1 border-b border-538-border">
          <p className="section-heading">Top 25 by FIP Percentile — {activeDivision}</p>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th className="text-left">Pitcher</th>
                <th className="text-left">Team</th>
                <th className="text-right">IP</th>
                <th className="text-right">ERA</th>
                <th className="text-right">FIP</th>
                <th className="text-right">K/9</th>
                <th className="text-right">BB/9</th>
                <th className="text-right">WHIP</th>
                <th className="text-right">FIP %ile</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(pitchersByTeam.values())
                .flat()
                .sort((a, b) => b.fip_percentile - a.fip_percentile)
                .slice(0, 25)
                .map(p => (
                  <tr key={p.player_id}>
                    <td className="font-medium">{p.name}</td>
                    <td>
                      <span
                        className="inline-flex items-center justify-center w-8 h-5 rounded text-white font-bold"
                        style={{ backgroundColor: teamColor(p.team), fontSize: '0.6rem' }}
                      >
                        {p.team}
                      </span>
                    </td>
                    <td className="text-right tabular">{p.innings_pitched}</td>
                    <td className="text-right tabular">{p.era?.toFixed(2) ?? '—'}</td>
                    <td className="text-right tabular font-semibold">{p.fip?.toFixed(2) ?? '—'}</td>
                    <td className="text-right tabular">{p.k_per_9.toFixed(1)}</td>
                    <td className="text-right tabular">{p.bb_per_9.toFixed(1)}</td>
                    <td className="text-right tabular">{p.whip?.toFixed(2) ?? '—'}</td>
                    <td className="text-right"><PercentilePip value={p.fip_percentile} /></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
