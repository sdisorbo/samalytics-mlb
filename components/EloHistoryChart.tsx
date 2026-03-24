'use client'

import { useState, useMemo } from 'react'
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Customized,
  type TooltipProps,
} from 'recharts'
import type { TeamRatingsHistory } from '@/lib/types'
import { teamColor } from '@/lib/teamColors'
import clsx from 'clsx'

interface Props {
  history: TeamRatingsHistory
  topTeams: string[]
  allTeams: string[]
}

// ── Season scaffold ────────────────────────────────────────────────────────────

/** Generate weekly date strings (every 7 days) from start to end inclusive. */
function weeklyScaffold(start: string, end: string): string[] {
  const dates: string[] = []
  const cur = new Date(start + 'T12:00:00Z')
  const last = new Date(end + 'T12:00:00Z')
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 7)
  }
  return dates
}

/** Infer the season year from history data (falls back to current year). */
function inferYear(history: TeamRatingsHistory): number {
  for (const abbr of Object.keys(history)) {
    const pts = history[abbr]
    if (pts?.length) return parseInt(pts[0].date.slice(0, 4))
  }
  return new Date().getFullYear()
}

// ── Data helpers ───────────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function buildChartData(history: TeamRatingsHistory, selected: string[], allTeams: string[]) {
  const year = inferYear(history)
  const seasonStart = `${year}-03-20`
  // Fixed X-axis: opening day (late March) through end of regular season (early Oct)
  const scaffold = weeklyScaffold(seasonStart, `${year}-10-05`)

  // Collect all real data points; normalize sentinel dates to season start
  const dateMap = new Map<string, Record<string, number>>()
  for (const abbr of allTeams) {
    for (const { date, rating } of history[abbr] ?? []) {
      const d = DATE_RE.test(date) ? date : seasonStart
      if (!dateMap.has(d)) dateMap.set(d, {} as Record<string, number>)
      dateMap.get(d)![abbr] = rating
    }
  }

  const allRealDates = Array.from(dateMap.keys()).sort()
  const lastRealDate = allRealDates.length > 0 ? allRealDates[allRealDates.length - 1] : null

  // The last scaffold slot that should carry data = first scaffold date >= lastRealDate.
  // This ensures the terminal dot lands on the scaffold (even if the last game date falls
  // between two scaffold slots) while nothing beyond that slot draws a line.
  const cutoff = lastRealDate ? (scaffold.find(d => d >= lastRealDate) ?? null) : null

  const lastVal: Record<string, number> = {}
  let realIdx = 0

  const rows = scaffold.map(scaffoldDate => {
    const row: Record<string, unknown> = { date: scaffoldDate }

    // Consume all real data points whose date falls on or before this scaffold slot
    while (realIdx < allRealDates.length && allRealDates[realIdx] <= scaffoldDate) {
      const vals = dateMap.get(allRealDates[realIdx])!
      for (const abbr of allTeams) {
        if (vals[abbr] != null) lastVal[abbr] = vals[abbr]
      }
      realIdx++
    }

    // Only draw up to the cutoff slot, and only once we have real data
    if (cutoff && scaffoldDate <= cutoff && Object.keys(lastVal).length > 0) {
      for (const abbr of allTeams) {
        if (lastVal[abbr] != null) row[abbr] = lastVal[abbr]
      }
      const vals = allTeams.map(a => row[a] as number | undefined).filter((v): v is number => v != null)
      if (vals.length) {
        row.leagueHigh = Math.max(...vals)
        row.leagueLow  = Math.min(...vals)
      }
    }

    return row
  })

  return rows.map(row => {
    const out: Record<string, unknown> = {
      date:       row.date,
      leagueHigh: row.leagueHigh,
      leagueLow:  row.leagueLow,
    }
    for (const abbr of selected) {
      if (row[abbr] != null) out[abbr] = row[abbr]
    }
    return out
  })
}

// ── League band (SVG drawn via Customized) ─────────────────────────────────────

function LeagueBand(props: Record<string, unknown>) {
  try {
    const { xAxisMap, yAxisMap, data } = props as {
      xAxisMap: Record<string, { scale: ((v: string) => number) & { bandwidth?: () => number } }>
      yAxisMap: Record<string, { scale: (v: number) => number }>
      data:     Record<string, unknown>[]
    }

    const xAxis = xAxisMap[Object.keys(xAxisMap)[0]]
    const yAxis = yAxisMap[Object.keys(yAxisMap)[0]]
    if (!xAxis?.scale || !yAxis?.scale || !data?.length) return null

    const bw = typeof xAxis.scale.bandwidth === 'function' ? xAxis.scale.bandwidth() / 2 : 0

    const items = data.filter(d => d.leagueHigh != null && d.leagueLow != null)
    if (items.length < 2) return null

    const top = items.map(d => {
      const x = xAxis.scale(d.date as string) + bw
      const y = yAxis.scale(d.leagueHigh as number)
      return isFinite(x) && isFinite(y) ? [x, y] as [number, number] : null
    }).filter(Boolean) as [number, number][]

    const bot = [...items].reverse().map(d => {
      const x = xAxis.scale(d.date as string) + bw
      const y = yAxis.scale(d.leagueLow as number)
      return isFinite(x) && isFinite(y) ? [x, y] as [number, number] : null
    }).filter(Boolean) as [number, number][]

    if (top.length < 2) return null

    const path =
      `M${top[0][0].toFixed(1)},${top[0][1].toFixed(1)} ` +
      top.slice(1).map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ') +
      ' ' +
      bot.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ') +
      ' Z'

    return <path d={path} fill="rgba(150, 120, 90, 0.1)" stroke="none" />
  } catch {
    return null
  }
}

// ── Tooltip ────────────────────────────────────────────────────────────────────

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  const sorted = [...payload]
    .filter(e => e.value != null && e.dataKey !== 'leagueHigh' && e.dataKey !== 'leagueLow')
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
  if (!sorted.length) return null
  return (
    <div className="bg-white border border-538-border rounded shadow-sm px-3 py-2 text-xs">
      <p className="font-semibold text-538-muted mb-1 uppercase tracking-wide" style={{ fontSize: '0.6rem' }}>
        {label as string}
      </p>
      {sorted.map(entry => (
        <div key={entry.dataKey} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: entry.color }} />
          <span className="font-bold w-8">{entry.dataKey as string}</span>
          <span className="tabular">{Math.round(entry.value ?? 0)}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function EloHistoryChart({ history, topTeams, allTeams }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(topTeams.slice(0, 8)))

  const selectedArr = useMemo(() => Array.from(selected), [selected])

  const chartData = useMemo(
    () => buildChartData(history, selectedArr, allTeams),
    [history, selectedArr, allTeams]
  )

  // Pre-compute last valid index per team (for terminal dot)
  const lastIndex = useMemo(() => {
    const map: Record<string, number> = {}
    for (const abbr of selectedArr) {
      for (let i = chartData.length - 1; i >= 0; i--) {
        if (chartData[i][abbr] != null) { map[abbr] = i; break }
      }
    }
    return map
  }, [chartData, selectedArr])

  // X-axis tick labels: one per month across the full season scaffold
  const ticks = useMemo(() => {
    const seen = new Set<string>()
    return chartData
      .map(row => row.date as string)
      .filter(date => {
        const m = date.slice(0, 7)
        if (seen.has(m)) return false
        seen.add(m)
        return true
      })
  }, [chartData])

  function toggle(abbr: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(abbr) ? next.delete(abbr) : next.add(abbr)
      return next
    })
  }

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <button
          onClick={() => setSelected(new Set(topTeams.slice(0, 8)))}
          className="text-xs font-semibold px-3 py-1 rounded border border-538-border bg-white text-538-muted hover:text-538-text transition-colors"
        >
          Top 8
        </button>
        <button
          onClick={() => setSelected(new Set(allTeams))}
          className="text-xs font-semibold px-3 py-1 rounded border border-538-border bg-white text-538-muted hover:text-538-text transition-colors"
        >
          All 30
        </button>
        <button
          onClick={() => setSelected(new Set())}
          className="text-xs font-semibold px-3 py-1 rounded border border-538-border bg-white text-538-muted hover:text-538-text transition-colors"
        >
          Clear All
        </button>
        <span className="text-xs text-538-muted">{selected.size} teams shown</span>
      </div>

      {/* Team chips */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {allTeams.map(abbr => {
          const active = selected.has(abbr)
          const color = teamColor(abbr)
          return (
            <button
              key={abbr}
              onClick={() => toggle(abbr)}
              className={clsx(
                'px-2 py-0.5 rounded text-xs font-bold border transition-all',
                active ? 'text-white' : 'text-538-muted bg-white hover:bg-538-header'
              )}
              style={
                active
                  ? { backgroundColor: color, borderColor: color }
                  : { borderColor: '#DDD0C0' }
              }
            >
              {abbr}
            </button>
          )
        })}
      </div>

      {/* Chart */}
      <div className="stat-card p-4">
        <ResponsiveContainer width="100%" height={440}>
          <ComposedChart data={chartData} margin={{ top: 12, right: 20, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E8DDD0" vertical={false} />

            <XAxis
              dataKey="date"
              ticks={ticks}
              tickFormatter={d => (d as string).slice(5, 10).replace('-', '/')}
              tick={{ fontSize: 11, fill: '#8A6248' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={['auto', 'auto']}
              tick={{ fontSize: 11, fill: '#8A6248' }}
              axisLine={false}
              tickLine={false}
              width={44}
            />

            <ReferenceLine
              y={1500}
              stroke="#C8B8A8"
              strokeDasharray="4 4"
              label={{ value: '1500 avg', position: 'insideTopLeft', fontSize: 10, fill: '#B0906A' }}
            />

            {/* League high/low dashed bounds */}
            <Line
              dataKey="leagueHigh"
              stroke="#C8B0A0"
              strokeWidth={1}
              strokeDasharray="4 3"
              dot={false}
              activeDot={false}
              legendType="none"
              connectNulls
            />
            <Line
              dataKey="leagueLow"
              stroke="#C8B0A0"
              strokeWidth={1}
              strokeDasharray="4 3"
              dot={false}
              activeDot={false}
              legendType="none"
              connectNulls
            />

            {/* Grey shaded band between high and low */}
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <Customized component={LeagueBand as any} />

            <Tooltip content={<CustomTooltip />} />

            {/* One line per selected team */}
            {selectedArr.map(abbr => {
              const color = teamColor(abbr)
              const termIdx = lastIndex[abbr] ?? -1
              return (
                <Line
                  key={abbr}
                  type="monotone"
                  dataKey={abbr}
                  stroke={color}
                  strokeWidth={2}
                  connectNulls
                  activeDot={{ r: 4, fill: color }}
                  dot={(dotProps: Record<string, unknown>) => {
                    if ((dotProps.index as number) !== termIdx) return <g key={dotProps.key as string} />
                    return (
                      <circle
                        key={dotProps.key as string}
                        cx={dotProps.cx as number}
                        cy={dotProps.cy as number}
                        r={5}
                        fill="white"
                        stroke={color}
                        strokeWidth={2.5}
                      />
                    )
                  }}
                />
              )
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="text-xs text-538-muted mt-2">
        Dashed line = 1500 (league average). Grey band = league high/low range. Dots = season-end rating.
      </p>
    </div>
  )
}
