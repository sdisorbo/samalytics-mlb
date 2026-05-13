'use client'

import { useMemo, useState } from 'react'
import {
  compareEntries,
  type LeaderboardEntry,
  type DailyData,
  SLG_CLOSENESS,
  MIN_AB,
} from '../lib/dailyLeaderboard'

type SortKey = 'rank' | 'name' | 'pitcher' | 'pa' | 'ab' | 'h' | 'hr' | 'k' | 'bb' | 'avg' | 'obp' | 'slg' | 'ops'

const COLUMNS: { key: SortKey; label: string; width?: string; numeric?: boolean }[] = [
  { key: 'rank', label: '#', width: 'w-6' },
  { key: 'name', label: 'Name' },
  { key: 'pitcher', label: 'Pitcher' },
  { key: 'pa', label: 'PA', numeric: true },
  { key: 'ab', label: 'AB', numeric: true },
  { key: 'h', label: 'H', numeric: true },
  { key: 'hr', label: 'HR', numeric: true },
  { key: 'k', label: 'K', numeric: true },
  { key: 'bb', label: 'BB', numeric: true },
  { key: 'avg', label: 'AVG', numeric: true },
  { key: 'obp', label: 'OBP', numeric: true },
  { key: 'slg', label: 'SLG', numeric: true },
  { key: 'ops', label: 'OPS', numeric: true },
]

function fmtAvg(v: number): string {
  if (!isFinite(v)) return '.000'
  return v.toFixed(3).replace(/^0/, '')
}

export default function DailyLeaderboard({
  data,
  compact = false,
}: {
  data: DailyData
  compact?: boolean
}) {
  // Default sort: SLG (which is also the ranking metric).
  const [sortKey, setSortKey] = useState<SortKey>('slg')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // The leaderboard order (rank) is fixed — by compareEntries (SLG with
  // tiebreaker). The user can re-sort the displayed table by any column, but
  // the rank column always shows their tournament rank.
  const ranked = useMemo(() => {
    return [...data.entries].sort(compareEntries).map((e, i) => ({ entry: e, rank: i + 1 }))
  }, [data.entries])

  const display = useMemo(() => {
    const rows = [...ranked]
    rows.sort((a, b) => {
      const dir = sortDir === 'desc' ? -1 : 1
      if (sortKey === 'rank') return dir * (b.rank - a.rank)
      if (sortKey === 'name') return dir * b.entry.name.localeCompare(a.entry.name)
      if (sortKey === 'pitcher') return dir * b.entry.pitcher.localeCompare(a.entry.pitcher)
      const av = (a.entry as unknown as Record<string, number>)[sortKey] ?? 0
      const bv = (b.entry as unknown as Record<string, number>)[sortKey] ?? 0
      return dir * (bv - av)
    })
    return rows
  }, [ranked, sortKey, sortDir])

  function clickHeader(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  if (data.entries.length === 0) {
    return (
      <div className={'text-xs text-538-muted text-center py-3 ' + (compact ? '' : 'border border-538-border rounded bg-surface')}>
        <div className="font-bold text-538-text mb-0.5">Daily Leaderboard</div>
        <div className="opacity-80">No qualifying scores yet today.</div>
        <div className="text-[10px] mt-1 opacity-60">
          {data.plays} {data.plays === 1 ? 'attempt' : 'attempts'} so far · {MIN_AB}-AB minimum to qualify
        </div>
      </div>
    )
  }

  return (
    <div className={compact ? '' : 'border border-538-border rounded bg-surface p-2'}>
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-xs font-bold text-538-text">Daily Leaderboard</div>
        <div className="text-[10px] text-538-muted tabular-nums">
          {data.plays} {data.plays === 1 ? 'play' : 'plays'} today
        </div>
      </div>
      <div className="text-[10px] text-538-muted mb-1 leading-snug">
        Top 10 by SLG. Tiebreaker: if two scores are within {Math.round(SLG_CLOSENESS * 100)}%
        of each other in SLG, the one with more ABs ranks higher. Click any column to re-sort
        the display.
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-538-muted uppercase tracking-wider text-[9px]">
            {COLUMNS.map((c) => {
              const active = sortKey === c.key
              return (
                <th
                  key={c.key}
                  onClick={() => clickHeader(c.key)}
                  className={
                    'cursor-pointer select-none py-1 px-1 hover:text-538-text ' +
                    (active ? 'text-538-text font-bold' : '') +
                    ' ' +
                    (c.numeric ? 'text-right' : 'text-left')
                  }
                >
                  {c.label}
                  {active && <span className="ml-0.5">{sortDir === 'desc' ? '▾' : '▴'}</span>}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {display.map(({ entry, rank }) => (
            <tr key={`${entry.ts}-${entry.name}`} className="border-t border-538-border/40">
              <td className="py-0.5 px-1 text-538-muted tabular-nums">{rank}</td>
              <td className="py-0.5 px-1 font-semibold text-538-text truncate max-w-[10ch]">{entry.name}</td>
              <td className="py-0.5 px-1 text-538-muted truncate max-w-[14ch]">
                {entry.pitcher === 'Random' ? (
                  <span className="text-538-orange font-bold">Random</span>
                ) : (
                  entry.pitcher
                )}
              </td>
              <td className="text-right tabular-nums">{entry.pa}</td>
              <td className="text-right tabular-nums">{entry.ab}</td>
              <td className="text-right tabular-nums">{entry.h}</td>
              <td className="text-right tabular-nums">{entry.hr}</td>
              <td className="text-right tabular-nums">{entry.k}</td>
              <td className="text-right tabular-nums">{entry.bb}</td>
              <td className="text-right tabular-nums">{fmtAvg(entry.avg)}</td>
              <td className="text-right tabular-nums">{fmtAvg(entry.obp)}</td>
              <td className="text-right tabular-nums font-bold">{fmtAvg(entry.slg)}</td>
              <td className="text-right tabular-nums">{fmtAvg(entry.ops)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Helper for callers — re-export so consumers don't need a second import.
export type { LeaderboardEntry }
