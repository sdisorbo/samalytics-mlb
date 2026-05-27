'use client'

import { useState, useMemo } from 'react'
import {
  ComposedChart,
  Scatter,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Customized,
} from 'recharts'
import type { TeamGameLog, TeamGame } from '../lib/types'

// ── Palette ───────────────────────────────────────────────────────────────────
const TURQ      = '#3C999E'   // turquoise — positive RV boxes
const PINK      = '#9B405A'   // pink — negative RV boxes
const GOLD      = '#C9A22A'   // actual runs line
const BROWN     = '#7B5230'   // expected runs line
const SHADE_POS = 'rgba(46, 125, 50, 0.22)'    // green — actual > expected
const SHADE_NEG = 'rgba(198, 40, 40, 0.22)'    // red   — actual < expected

// ── Date helpers ──────────────────────────────────────────────────────────────
function dateToTs(dateStr: string): number {
  return new Date(dateStr + 'T12:00:00Z').getTime()
}
function fmtTick(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface PlayerPoint {
  x:        number   // timestamp — recharts numeric x
  rv:       number
  name:     string
  pa:       number
  date:     string
  opponent: string
  home:     boolean
}

interface GameLine {
  x:             number   // timestamp
  date:          string
  top9rv:        number   // sum of RV for the 9 batters with the most PAs
  expected_runs: number   // avg_runs + top9rv  (absolute scale)
  actual_runs:   number | null
}

// ── Module-level hover callbacks (lets BoxShape reach component state) ─────────
// Stable function references reassigned each render — safe because recharts
// calls shape functions synchronously during paint, not on stale closures.
const _hover = {
  enter: null as ((p: PlayerPoint, x: number, y: number) => void) | null,
  leave: null as (() => void) | null,
}

// ── Square box shape ──────────────────────────────────────────────────────────
function BoxShape(props: Record<string, unknown>) {
  const { cx, cy, payload } = props as { cx: number; cy: number; payload: PlayerPoint }
  const isPos = payload.rv >= 0
  const s = 9
  return (
    <rect
      x={cx - s / 2}
      y={cy - s / 2}
      width={s}
      height={s}
      fill={isPos ? TURQ : PINK}
      fillOpacity={0.5}
      stroke={isPos ? TURQ : PINK}
      strokeWidth={0.8}
      rx={1}
      style={{ cursor: 'crosshair' }}
      onMouseEnter={(e: React.MouseEvent) =>
        _hover.enter?.(payload, e.clientX, e.clientY)
      }
      onMouseLeave={() => _hover.leave?.()}
    />
  )
}

// ── Fill-between customized layer ─────────────────────────────────────────────
// Draws trapezoids between expected_runs and actual_runs on the runs axis,
// green where team scored more than expected, red where they fell short.
function FillBetween({
  xAxisMap,
  yAxisMap,
  lineData,
}: {
  xAxisMap?: Record<string, { scale: (v: number) => number }>
  yAxisMap?: Record<string, { scale: (v: number) => number }>
  lineData: GameLine[]
}) {
  const xScale = xAxisMap ? Object.values(xAxisMap)[0]?.scale : null
  // Use the "runs" axis (first entry in yAxisMap)
  const yScale = yAxisMap ? Object.values(yAxisMap)[0]?.scale : null
  if (!xScale || !yScale) return null

  const pts = lineData.filter((d) => d.actual_runs != null)
  if (pts.length < 2) return null

  return (
    <g>
      {pts.slice(0, -1).map((d, i) => {
        const n = pts[i + 1]
        const avgGap =
          ((d.actual_runs! - d.expected_runs) + (n.actual_runs! - n.expected_runs)) / 2
        const x1 = xScale(d.x),  x2 = xScale(n.x)
        const yExp1 = yScale(d.expected_runs), yExp2 = yScale(n.expected_runs)
        const yAct1 = yScale(d.actual_runs!),  yAct2 = yScale(n.actual_runs!)
        return (
          <polygon
            key={i}
            points={`${x1},${yExp1} ${x2},${yExp2} ${x2},${yAct2} ${x1},${yAct1}`}
            fill={avgGap >= 0 ? SHADE_POS : SHADE_NEG}
          />
        )
      })}
    </g>
  )
}

// ── Summary card ──────────────────────────────────────────────────────────────
function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-538-border rounded bg-surface p-3 text-center">
      <div className="text-[10px] uppercase tracking-wider text-538-muted mb-0.5">{label}</div>
      <div className="text-lg font-black text-538-text tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-538-muted mt-0.5">{sub}</div>}
    </div>
  )
}

// ── Season leaderboard ────────────────────────────────────────────────────────
function TopBattersTable({ games }: { games: TeamGame[] }) {
  const rows = useMemo(() => {
    const agg: Record<string, { rv: number; pa: number; games: number }> = {}
    for (const g of games) {
      for (const b of g.batters) {
        if (!agg[b.name]) agg[b.name] = { rv: 0, pa: 0, games: 0 }
        agg[b.name].rv    += b.rv
        agg[b.name].pa    += b.pa
        agg[b.name].games += 1
      }
    }
    return Object.entries(agg)
      .map(([name, s]) => ({ name, ...s }))
      .sort((a, b) => b.rv - a.rv)
      .slice(0, 15)
  }, [games])

  return (
    <div className="border border-538-border rounded bg-surface overflow-hidden">
      <div className="px-3 py-2 border-b border-538-border text-[11px] font-bold text-538-text uppercase tracking-wider">
        Season RV Leaders
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[9px] uppercase tracking-wider text-538-muted border-b border-538-border">
            <th className="text-left px-3 py-1.5">#</th>
            <th className="text-left px-2 py-1.5">Batter</th>
            <th className="text-right px-2 py-1.5">G</th>
            <th className="text-right px-2 py-1.5">PA</th>
            <th className="text-right px-3 py-1.5">RV</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name} className="border-t border-538-border/40">
              <td className="px-3 py-1 text-538-muted">{i + 1}</td>
              <td className="px-2 py-1 font-semibold text-538-text">{r.name}</td>
              <td className="px-2 py-1 text-right tabular-nums text-538-muted">{r.games}</td>
              <td className="px-2 py-1 text-right tabular-nums text-538-muted">{r.pa}</td>
              <td
                className="px-3 py-1 text-right font-bold tabular-nums"
                style={{ color: r.rv >= 0 ? TURQ : PINK }}
              >
                {r.rv >= 0 ? '+' : ''}{r.rv.toFixed(3)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TeamPerformance({ logs }: { logs: TeamGameLog[] }) {
  const teams = useMemo(() => logs.map((l) => l.team).sort(), [logs])
  const [selectedTeam, setSelectedTeam] = useState<string>(teams[0] ?? '')

  // Floating tooltip state for individual box hover
  const [hoveredPlayer, setHoveredPlayer] = useState<PlayerPoint | null>(null)
  const [tipPos, setTipPos] = useState({ x: 0, y: 0 })

  // Wire up module-level hover callbacks every render (cheap, safe)
  _hover.enter = (p, x, y) => {
    setHoveredPlayer(p)
    setTipPos({ x, y })
  }
  _hover.leave = () => setHoveredPlayer(null)

  const teamLog = useMemo(
    () => logs.find((l) => l.team === selectedTeam),
    [logs, selectedTeam],
  )

  // Season average runs (computed first so scatterData can use it)
  const avgRuns = useMemo(() => {
    if (!teamLog) return null
    const arr = teamLog.games.filter((g) => g.actual_runs != null).map((g) => g.actual_runs!)
    return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null
  }, [teamLog])

  // Per-player scatter points — ALL batters shown, y = avgRuns + rv so boxes
  // float around the expected-runs line. Top-9 restriction is only for the line.
  const scatterData = useMemo<PlayerPoint[]>(() => {
    if (!teamLog || avgRuns == null) return []
    return teamLog.games.flatMap((g) =>
      g.batters.map((b) => ({
        x:        dateToTs(g.date),
        rv:       avgRuns + b.rv,
        name:     b.name,
        pa:       b.pa,
        date:     g.date,
        opponent: g.opponent,
        home:     g.home,
      })),
    )
  }, [teamLog, avgRuns])

  // Per-game aggregate line data.
  // top9rv = RV sum of the 9 batters with the most PAs (excludes late subs).
  // expected_runs and actual_runs are smoothed with a 5-game centred rolling
  // average so the lines are less volatile game-to-game.
  const lineData = useMemo(() => {
    if (!teamLog || avgRuns == null) return [] as GameLine[]

    // Build raw per-game values first
    const raw = teamLog.games.map((g) => {
      const top9rv = [...g.batters]
        .sort((a, b) => b.pa - a.pa)
        .slice(0, 9)
        .reduce((s, b) => s + b.rv, 0)
      return {
        x:            dateToTs(g.date),
        date:         g.date,
        top9rv,
        expected_runs: avgRuns + top9rv,
        actual_runs:  g.actual_runs,
      }
    })

    // 5-game centred rolling average helper
    const WINDOW = 5
    const half = Math.floor(WINDOW / 2)
    const smooth = (arr: (number | null)[], i: number): number | null => {
      const slice: number[] = []
      for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) {
        if (arr[j] != null) slice.push(arr[j] as number)
      }
      return slice.length ? slice.reduce((s, v) => s + v, 0) / slice.length : null
    }

    const expArr = raw.map((d) => d.expected_runs)
    const actArr = raw.map((d) => d.actual_runs)

    return raw.map((d, i) => ({
      ...d,
      expected_runs: smooth(expArr, i) ?? d.expected_runs,
      actual_runs:   smooth(actArr, i),
    }))
  }, [teamLog, avgRuns])

  // Summary stats
  const summary = useMemo(() => {
    if (!lineData.length) return null
    const rvSum    = lineData.reduce((s, d) => s + d.top9rv, 0)
    const posGames = lineData.filter((d) => d.top9rv > 0).length
    const overperf = lineData.filter(
      (d) => d.actual_runs != null && d.actual_runs > d.expected_runs,
    ).length
    const best = [...lineData].sort((a, b) => b.expected_runs - a.expected_runs)[0]
    return { rvSum, posGames, overperf, best, n: lineData.length }
  }, [lineData])

  if (!teamLog) {
    return <div className="text-538-muted text-sm">No data for selected team.</div>
  }

  return (
    <div className="space-y-4">

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-538-muted block mb-1">Team</label>
          <select
            value={selectedTeam}
            onChange={(e) => setSelectedTeam(e.target.value)}
            className="px-2 py-1.5 text-sm bg-538-bg border border-538-border rounded text-538-text outline-none focus:border-538-orange"
          >
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        {summary && (
          <div className="text-[11px] text-538-muted self-center">
            {summary.n} games · avg {avgRuns?.toFixed(1)} runs/game
          </div>
        )}
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <SummaryCard
            label="Season RV"
            value={(summary.rvSum >= 0 ? '+' : '') + summary.rvSum.toFixed(3)}
            sub={`${summary.n} games`}
          />
          <SummaryCard
            label="Positive RV Games"
            value={`${summary.posGames} / ${summary.n}`}
            sub={`${Math.round((summary.posGames / summary.n) * 100)}%`}
          />
          <SummaryCard
            label="Outperformed RV"
            value={`${summary.overperf} / ${summary.n}`}
            sub="scored > RV predicted"
          />
          <SummaryCard
            label="Best Expected Game"
            value={summary.best ? summary.best.expected_runs.toFixed(1) + ' R' : '—'}
            sub={summary.best ? fmtTick(summary.best.x) : undefined}
          />
        </div>
      )}

      {/* Chart */}
      <div className="border border-538-border rounded bg-surface p-4">

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-5 mb-1 text-[11px] text-538-muted">
          <div className="flex items-center gap-1.5">
            <svg width="9" height="9"><rect width="9" height="9" fill={TURQ} fillOpacity={0.5} rx="1" /></svg>
            <span>Positive RV player</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg width="9" height="9"><rect width="9" height="9" fill={PINK} fillOpacity={0.5} rx="1" /></svg>
            <span>Negative RV player</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg width="18" height="9"><line x1="0" y1="4.5" x2="18" y2="4.5" stroke={BROWN} strokeWidth="2" /></svg>
            <span>Expected runs (avg + top-9 RV)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg width="18" height="9"><line x1="0" y1="4.5" x2="18" y2="4.5" stroke={GOLD} strokeWidth="2" strokeDasharray="5 3" /></svg>
            <span>Actual runs scored</span>
          </div>
        </div>
        <div className="text-[10px] text-538-muted mb-3 opacity-70">
          Green fill = scored more than expected (timely hitting / luck). Red fill = underperformed at-bat quality (left runners on base).
        </div>

        <ResponsiveContainer width="100%" height={400}>
          <ComposedChart margin={{ top: 8, right: 16, bottom: 8, left: 4 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.06)"
              vertical={false}
            />
            <XAxis
              dataKey="x"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tick={{ fontSize: 10, fill: '#888' }}
              tickLine={false}
              tickFormatter={fmtTick}
              ticks={(() => {
                // One tick per calendar month present in the data
                const seen = new Set<string>()
                return lineData
                  .filter((d) => {
                    const mo = d.date.slice(0, 7)
                    if (seen.has(mo)) return false
                    seen.add(mo)
                    return true
                  })
                  .map((d) => d.x)
              })()}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#888' }}
              tickLine={false}
              axisLine={false}
              label={{ value: 'Runs', angle: -90, position: 'insideLeft', offset: 14, fontSize: 10, fill: '#888' }}
              domain={([min, max]: [number, number]) => [Math.max(0, Math.floor(min) - 1), Math.ceil(max) + 1]}
            />

            {avgRuns != null && (
              <ReferenceLine y={avgRuns} stroke="rgba(150,150,150,0.35)" strokeWidth={1} strokeDasharray="4 4"
                label={{ value: `Avg ${avgRuns.toFixed(1)}`, position: 'right', fontSize: 9, fill: '#888' }}
              />
            )}

            {/* Shaded area between team_rv and runs_delta */}
            <Customized
              component={(props: Record<string, unknown>) => (
                <FillBetween
                  xAxisMap={props.xAxisMap as Parameters<typeof FillBetween>[0]['xAxisMap']}
                  yAxisMap={props.yAxisMap as Parameters<typeof FillBetween>[0]['yAxisMap']}
                  lineData={lineData}
                />
              )}
            />

            {/* Per-player scatter boxes — hover for name + RV */}
            <Scatter
              data={scatterData}
              dataKey="rv"
              shape={<BoxShape />}
              isAnimationActive={false}
            />

            {/* Expected runs (avg + top-9 RV) — brown solid */}
            <Line
              data={lineData}
              dataKey="expected_runs"
              type="monotone"
              stroke={BROWN}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />

            {/* Actual runs scored — gold dashed */}
            <Line
              data={lineData}
              dataKey="actual_runs"
              type="monotone"
              stroke={GOLD}
              strokeWidth={1.5}
              strokeDasharray="5 3"
              dot={false}
              connectNulls
              isAnimationActive={false}
            />

            {/* Suppress the default axis-snapping tooltip */}
            <Tooltip content={() => null} cursor={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Floating player tooltip — follows the mouse over scatter boxes */}
      {hoveredPlayer && (
        <div
          className="fixed z-50 bg-surface border border-538-border rounded px-3 py-2 text-xs shadow-xl pointer-events-none"
          style={{ left: tipPos.x + 14, top: tipPos.y - 12 }}
        >
          <div className="font-bold text-538-text mb-0.5">{hoveredPlayer.name}</div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-538-muted">RV</span>
            <span
              className="font-bold tabular-nums"
              style={{ color: (hoveredPlayer.rv - (avgRuns ?? 0)) >= 0 ? TURQ : PINK }}
            >
              {(hoveredPlayer.rv - (avgRuns ?? 0)) >= 0 ? '+' : ''}{(hoveredPlayer.rv - (avgRuns ?? 0)).toFixed(3)}
            </span>
            <span className="text-538-muted">· {hoveredPlayer.pa} PA</span>
          </div>
          <div className="text-[10px] text-538-muted mt-0.5">
            {fmtTick(hoveredPlayer.x)} · {hoveredPlayer.home ? 'vs' : '@'} {hoveredPlayer.opponent}
          </div>
        </div>
      )}

      {/* Leaderboard */}
      <TopBattersTable games={teamLog.games} />
    </div>
  )
}
