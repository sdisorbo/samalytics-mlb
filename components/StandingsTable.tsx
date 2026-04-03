'use client'

import { useState, useMemo, Fragment } from 'react'
import clsx from 'clsx'
import type { TeamStanding } from '@/lib/types'
import { teamColor, teamLogoUrl, DIVISION_ORDER, divisionColor, normalizeDivision } from '@/lib/teamColors'

type SortKey = keyof TeamStanding
type SortDir = 'asc' | 'desc'

const SORT_DEFAULTS: Partial<Record<SortKey, SortDir>> = {
  elo_rating:          'desc',
  wins:                'desc',
  losses:              'asc',
  playoff_probability: 'desc',
  win_ws:              'desc',
  win_cs:              'desc',
  win_ds:              'desc',
  elo_change_7d:       'desc',
  run_diff:            'desc',
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`
}

function probBarColor(p: number): string {
  if (p >= 0.9)  return '#27AE60'
  if (p >= 0.6)  return '#2ECC71'
  if (p >= 0.35) return '#F39C12'
  if (p >= 0.1)  return '#E67E22'
  return '#E74C3C'
}

// Smooth color interpolation for win stage columns
// Turquoise scale (above median): #CFE8E8 → #8EC6C8 → #5BAEB3 → #3C999E
// Pink scale (below median):      #F3D6DB → #E5A8B5 → #C96E85 → #9B405A
// White at median, text always black

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
}

function lerpColor(c1: string, c2: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(c1)
  const [r2, g2, b2] = hexToRgb(c2)
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}

function interpolateScale(colors: string[], t: number): string {
  // t goes from 0 to 1, spread across N colors
  const clamped = Math.max(0, Math.min(1, t))
  const segments = colors.length - 1
  const segment = Math.min(Math.floor(clamped * segments), segments - 1)
  const localT = (clamped * segments) - segment
  return lerpColor(colors[segment], colors[segment + 1], localT)
}

const TURQ_SCALE = ['#CFE8E8', '#8EC6C8', '#5BAEB3', '#3C999E']
const PINK_SCALE = ['#F3D6DB', '#E5A8B5', '#C96E85', '#9B405A']

function winStageStyleSmooth(value: number, median: number, max: number): { backgroundColor?: string; color?: string } {
  if (value === 0) return {}
  if (Math.abs(value - median) < 0.005) return {} // very close to median = white

  if (value > median) {
    // Above median → turquoise scale
    const t = Math.min((value - median) / (max - median), 1)
    return { backgroundColor: interpolateScale(TURQ_SCALE, t), color: '#1a1a1a' }
  } else {
    // Below median → pink scale
    const t = Math.min((median - value) / median, 1)
    return { backgroundColor: interpolateScale(PINK_SCALE, t), color: '#1a1a1a' }
  }
}

function EloChange({ val }: { val: number }) {
  if (val > 0) return <span className="elo-up">+{val}</span>
  if (val < 0) return <span className="elo-down">{val}</span>
  return <span className="elo-flat">—</span>
}

function TeamBadge({ abbr }: { abbr: string }) {
  const logo = teamLogoUrl(abbr)
  if (logo) {
    return (
      <img
        src={logo}
        alt={abbr}
        className="w-6 h-6 shrink-0 object-contain"
      />
    )
  }
  const bg = teamColor(abbr)
  return (
    <span
      className="inline-flex items-center justify-center w-8 h-5 rounded text-white font-bold text-2xs shrink-0"
      style={{ backgroundColor: bg, fontSize: '0.6rem', letterSpacing: '0.03em' }}
    >
      {abbr}
    </span>
  )
}

interface Props {
  standings: TeamStanding[]
}

export default function StandingsTable({ standings }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('wins')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [groupByDivision, setGroupByDivision] = useState(false)

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(SORT_DEFAULTS[key] ?? 'desc')
    }
  }

  const sortedStandings = useMemo(() => {
    return [...standings].sort((a, b) => {
      const av = a[sortKey] as number
      const bv = b[sortKey] as number
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [standings, sortKey, sortDir])

  const grouped = useMemo(() => {
    if (!groupByDivision) return null
    const map = new Map<string, TeamStanding[]>()
    for (const div of DIVISION_ORDER) map.set(div, [])
    for (const row of standings) {
      const normalized = normalizeDivision(row.division)
      const bucket = map.get(normalized)
      if (bucket) bucket.push(row)
    }
    // Sort within each division by wins desc
    for (const [, bucket] of map) {
      bucket.sort((a, b) => b.wins - a.wins || a.losses - b.losses)
    }
    return map
  }, [standings, groupByDivision])

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <span className="ml-0.5 opacity-25">↕</span>
    return <span className="ml-0.5">{sortDir === 'desc' ? '↓' : '↑'}</span>
  }

  function Th({
    col,
    children,
    align = 'right',
    className: extraClass,
  }: {
    col: SortKey
    children: React.ReactNode
    align?: 'left' | 'right' | 'center'
    className?: string
  }) {
    return (
      <th
        className={clsx(
          'select-none',
          align === 'left' ? 'text-left' : align === 'center' ? 'text-center' : 'text-right',
          extraClass,
        )}
        onClick={() => handleSort(col)}
      >
        {children}
        <SortIcon col={col} />
      </th>
    )
  }

  // Compute median and max for smooth color scaling
  const colStats = useMemo(() => {
    function medianAndMax(vals: number[]) {
      const sorted = [...vals].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
      return { median, max: sorted[sorted.length - 1] }
    }
    return {
      ds: medianAndMax(standings.map(s => s.win_ds)),
      cs: medianAndMax(standings.map(s => s.win_cs)),
      ws: medianAndMax(standings.map(s => s.win_ws)),
    }
  }, [standings])

  const rows = groupByDivision ? null : sortedStandings

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={() => setGroupByDivision(v => !v)}
          className={clsx(
            'text-xs font-semibold uppercase tracking-wide px-3 py-1 rounded-lg border transition-colors',
            groupByDivision
              ? 'bg-538-orange text-white border-538-orange'
              : 'bg-surface text-538-muted border-538-border hover:border-538-text'
          )}
        >
          {groupByDivision ? 'By Division' : 'By Division'}
        </button>
        <span className="text-xs text-538-muted">Click column headers to sort</span>
      </div>

      <div className="table-scroll stat-card p-0 overflow-hidden rounded-xl">
        <table className="data-table">
          <thead>
            <tr>
              <Th col="team_abbr" align="left">Team</Th>
              <Th col="wins">W</Th>
              <Th col="losses">L</Th>
              <th className="text-right text-538-muted text-2xs uppercase tracking-widest">PCT</th>
              <Th col="run_diff">Run Diff</Th>
              <Th col="elo_rating">ELO</Th>
              <Th col="elo_change_7d">Δ7d</Th>
              <Th col="playoff_probability">Playoff%</Th>
              <Th col="win_ds" align="center" className="w-[3.2rem]">Win DS</Th>
              <Th col="win_cs" align="center" className="w-[3.2rem]">Win CS</Th>
              <Th col="win_ws" align="center" className="w-[3.2rem]">Win WS</Th>
            </tr>
          </thead>
          <tbody>
            {groupByDivision && grouped
              ? Array.from(grouped.entries()).map(([division, teams]) => (
                  <Fragment key={division}>
                    <tr className="division-header">
                      <td
                        colSpan={11}
                        style={{ borderLeft: `3px solid ${divisionColor(division)}` }}
                      >
                        {division}
                      </td>
                    </tr>
                    {teams.map(row => (
                      <TeamRow key={row.team_abbr} row={row} colStats={colStats} />
                    ))}
                  </Fragment>
                ))
              : rows!.map(row => <TeamRow key={row.team_abbr} row={row} colStats={colStats} />)}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface ColStats {
  ds: { median: number; max: number }
  cs: { median: number; max: number }
  ws: { median: number; max: number }
}

function TeamRow({ row, colStats }: { row: TeamStanding; colStats: ColStats }) {
  const total = row.wins + row.losses
  const pctVal = total > 0 ? (row.wins / total).toFixed(3) : '.000'
  const playoffProb = row.playoff_probability

  return (
    <tr>
      {/* Team */}
      <td className="text-left">
        <div className="flex items-center gap-2">
          <TeamBadge abbr={row.team_abbr} />
          <span className="font-medium text-538-text">{row.team}</span>
        </div>
      </td>

      {/* W */}
      <td className="text-right font-semibold">{row.wins}</td>

      {/* L */}
      <td className="text-right text-538-muted">{row.losses}</td>

      {/* PCT */}
      <td className="text-right text-538-muted">{pctVal}</td>

      {/* Run diff */}
      <td
        className={clsx(
          'text-right',
          row.run_diff > 0 ? 'text-green-600' : row.run_diff < 0 ? 'text-red-500' : 'text-538-muted'
        )}
      >
        {row.run_diff > 0 ? `+${row.run_diff}` : row.run_diff}
      </td>

      {/* ELO */}
      <td className="text-right font-semibold tabular">{Math.round(row.elo_rating)}</td>

      {/* Δ7d */}
      <td
        className={clsx(
          'text-right tabular',
          row.elo_change_7d > 0 ? 'text-green-600' : row.elo_change_7d < 0 ? 'text-red-500' : 'text-538-muted'
        )}
      >
        {row.elo_change_7d > 0 ? `+${Math.round(row.elo_change_7d)}` : row.elo_change_7d < 0 ? Math.round(row.elo_change_7d) : '—'}
      </td>

      {/* Playoff% — bar + number */}
      <td className="text-right">
        <div className="flex items-center gap-1.5 justify-end">
          <div className="w-14 prob-bar">
            <div
              className="prob-bar-fill"
              style={{
                width: `${playoffProb * 100}%`,
                backgroundColor: probBarColor(playoffProb),
              }}
            />
          </div>
          <span className="w-8 text-right tabular">{pct(playoffProb)}</span>
        </div>
      </td>

      {/* Win DS */}
      <td className="text-center tabular w-[3.2rem]" style={{ padding: '5px 4px', ...winStageStyleSmooth(row.win_ds, colStats.ds.median, colStats.ds.max) }}>
        {pct(row.win_ds)}
      </td>

      {/* Win CS */}
      <td className="text-center tabular w-[3.2rem]" style={{ padding: '5px 4px', ...winStageStyleSmooth(row.win_cs, colStats.cs.median, colStats.cs.max) }}>
        {pct(row.win_cs)}
      </td>

      {/* Win WS */}
      <td className="text-center tabular font-semibold w-[3.2rem]" style={{ padding: '5px 4px', ...winStageStyleSmooth(row.win_ws, colStats.ws.median, colStats.ws.max) }}>
        {pct(row.win_ws)}
      </td>
    </tr>
  )
}
