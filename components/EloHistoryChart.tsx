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

// ── Data helpers ───────────────────────────────────────────────────────────────

function buildChartData(history: TeamRatingsHistory, selected: string[], allTeams: string[]) {
  // Collect all dates across ALL teams (for league min/max)
  const dateMap = new Map<string, Record<string, number>>()

  for (const abbr of allTeams) {
    for (const { date, rating } of history[abbr] ?? []) {
      if (!dateMap.has(date)) dateMap.set(date, {} as Record<string, number>)
      dateMap.get(date)![abbr] = rating
    }
  }

  const sorted: Record<string, unknown>[] = Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({ date, ...vals } as Record<string, unknown>))

  // Forward-fill every team value
  const last: Record<string, number> = {}
  for (const row of sorted) {
    for (const abbr of allTeams) {
      const v = row[abbr] as number | undefined
      if (v != null) last[abbr] = v
      else if (last[abbr] != null) row[abbr] = last[abbr]
    }
  }

  // Compute league high/low from all 30 teams at each date
  for (const row of sorted) {
    const vals = allTeams.map(a => row[a] as number | undefined).filter((v): v is number => v != null)
    if (vals.length) {
      ;(row as Record<string, unknown>).leagueHigh = Math.max(...vals)
      ;(row as Record<string, unknown>).leagueLow = Math.min(...vals)
    }
  }

  // Weekly sample (keep one point per ISO week) for smooth lines
  const seen = new Set<string>()
  const weekly = sorted.filter((row: Record<string, unknown>) => {
    const d = new Date(row.date as string)
    const year = d.getFullYear()
    const jan1 = new Date(year, 0, 1)
    const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7)
    const key = `${year}-${week}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Keep only selected team keys + date + leagueHigh/Low in final rows
  return weekly.map((row: Record<string, unknown>) => {
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

  // X-axis tick labels (monthly)
  const ticks = useMemo(() => {
    const result: string[] = []
    let lastMonth = ''
    for (const row of chartData) {
      const m = (row.date as string).slice(0, 7)
      if (m !== lastMonth) { result.push(row.date as string); lastMonth = m }
    }
    return result
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
