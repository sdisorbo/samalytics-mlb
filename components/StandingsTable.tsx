'use client'

import { useState, useMemo } from 'react'
import clsx from 'clsx'
import type { TeamStanding } from '@/lib/types'
import { teamColor, teamLogoUrl, DIVISION_ORDER, divisionColor } from '@/lib/teamColors'

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

function winStageColor(p: number): string | undefined {
  if (p >= 0.15) return '#00CDD1'
  if (p >= 0.08) return '#09E8DE'
  if (p >= 0.03) return undefined   // neutral / median
  if (p >= 0.01) return '#E0007C'
  return p > 0 ? '#F4308F' : undefined
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
      const bucket = map.get(row.division)
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
  }: {
    col: SortKey
    children: React.ReactNode
    align?: 'left' | 'right'
  }) {
    return (
      <th
        className={clsx('select-none', align === 'right' ? 'text-right' : 'text-left')}
        onClick={() => handleSort(col)}
      >
        {children}
        <SortIcon col={col} />
      </th>
    )
  }

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
              : 'bg-white text-538-muted border-538-border hover:border-538-text'
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
              <Th col="win_ds">Win DS</Th>
              <Th col="win_cs">Win CS</Th>
              <Th col="win_ws">Win WS</Th>
            </tr>
          </thead>
          <tbody>
            {groupByDivision && grouped
              ? Array.from(grouped.entries()).map(([division, teams]) => (
                  <>
                    <tr key={`header-${division}`} className="division-header">
                      <td
                        colSpan={11}
                        style={{ borderLeft: `3px solid ${divisionColor(division)}` }}
                      >
                        {division}
                      </td>
                    </tr>
                    {teams.map(row => (
                      <TeamRow key={row.team_abbr} row={row} />
                    ))}
                  </>
                ))
              : rows!.map(row => <TeamRow key={row.team_abbr} row={row} />)}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TeamRow({ row }: { row: TeamStanding }) {
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
        <div className="flex items-center gap-2 justify-end">
          <div className="w-20 prob-bar">
            <div
              className="prob-bar-fill"
              style={{
                width: `${playoffProb * 100}%`,
                backgroundColor: probBarColor(playoffProb),
              }}
            />
          </div>
          <span className="w-9 text-right tabular">{pct(playoffProb)}</span>
        </div>
      </td>

      {/* Win DS */}
      <td className="text-right tabular" style={{ color: winStageColor(row.win_ds) }}>
        {pct(row.win_ds)}
      </td>

      {/* Win CS */}
      <td className="text-right tabular" style={{ color: winStageColor(row.win_cs) }}>
        {pct(row.win_cs)}
      </td>

      {/* Win WS */}
      <td className="text-right tabular font-semibold" style={{ color: winStageColor(row.win_ws) }}>
        {pct(row.win_ws)}
      </td>
    </tr>
  )
}
