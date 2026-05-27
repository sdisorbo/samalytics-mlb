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
const TURQ      = '#3D405B'   // navy — positive RV boxes
const PINK      = '#B20D30'   // crimson — negative RV boxes
const GOLD      = '#C9A22A'   // actual runs (centered) dashed line
const BROWN     = '#7B5230'   // per-game team_rv solid line
const SHADE_POS = 'rgba(61, 64, 91, 0.20)'     // navy   — runs > rv
const SHADE_NEG = 'rgba(178, 13, 48, 0.20)'    // crimson — runs < rv

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
  x:           number   // timestamp
  date:        string
  team_rv:     number
  runs_delta:  number | null   // actual_runs − season_avg, same scale as rv
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
// Draws trapezoids between the team_rv line and the runs_delta line,
// coloured green where actual runs exceeded RV, red where they fell short.
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
  const yScale = yAxisMap ? Object.values(yAxisMap)[0]?.scale : null
  if (!xScale || !yScale) return null

  const pts = lineData.filter((d) => d.runs_delta != null)
  if (pts.length < 2) return null

  return (
    <g>
      {pts.slice(0, -1).map((d, i) => {
        const n = pts[i + 1]
        const avgGap =
          (d.runs_delta! - d.team_rv + (n.runs_delta! - n.team_rv)) / 2
        const x1 = xScale(d.x),  x2 = xScale(n.x)
        const yRv1 = yScale(d.team_rv), yRv2 = yScale(n.team_rv)
        const yRd1 = yScale(d.runs_delta!), yRd2 = yScale(n.runs_delta!)
        return (
          <polygon
            key={i}
            points={`${x1},${yRv1} ${x2},${yRv2} ${x2},${yRd2} ${x1},${yRd1}`}
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

  // Per-player scatter points
  const scatterData = useMemo<PlayerPoint[]>(() => {
    if (!teamLog) return []
    return teamLog.games.flatMap((g) =>
      g.batters.map((b) => ({
        x:        dateToTs(g.date),
        rv:       b.rv,
        name:     b.name,
        pa:       b.pa,
        date:     g.date,
        opponent: g.opponent,
        home:     g.home,
      })),
    )
  }, [teamLog])

  // Per-game aggregate line data
  // actual_runs is centered on the team's season average so it lives on the
  // same scale as team_rv (typically −2 to +2). This makes the gap between
  // the two lines a direct measure of over/underperforming run expectation.
  const { lineData, avgRuns } = useMemo(() => {
    if (!teamLog) return { lineData: [] as GameLine[], avgRuns: null }

    const runsArr = teamLog.games
      .filter((g) => g.actual_runs != null)
      .map((g) => g.actual_runs!)
    const avg = runsArr.length
      ? runsArr.reduce((s, v) => s + v, 0) / runsArr.length
      : null

    const data: GameLine[] = teamLog.games.map((g) => ({
      x:          dateToTs(g.date),
      date:       g.date,
      team_rv:    g.team_rv,
      runs_delta: g.actual_runs != null && avg != null
        ? g.actual_runs - avg
        : null,
    }))

    return { lineData: data, avgRuns: avg }
  }, [teamLog])

  // Summary stats
  const summary = useMemo(() => {
    if (!lineData.length) return null
    const rvSum    = lineData.reduce((s, d) => s + d.team_rv, 0)
    const posGames = lineData.filter((d) => d.team_rv > 0).length
    const overperf = lineData.filter(
      (d) => d.runs_delta != null && d.runs_delta > d.team_rv,
    ).length
    const best = [...lineData].sort((a, b) => b.team_rv - a.team_rv)[0]
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
            label="Best Game RV"
            value={summary.best ? '+' + summary.best.team_rv.toFixed(3) : '—'}
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
            <span>Team RV per game</span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg width="18" height="9"><line x1="0" y1="4.5" x2="18" y2="4.5" stroke={GOLD} strokeWidth="2" strokeDasharray="5 3" /></svg>
            <span>Runs above avg {avgRuns ? `(÷${avgRuns.toFixed(1)})` : ''}</span>
          </div>
        </div>
        <div className="text-[10px] text-538-muted mb-3 opacity-70">
          Green fill = scored more runs than RV expected (timely hitting). Red fill = underperformed RV (left runners on base).
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
              label={{ value: 'Run Value', angle: -90, position: 'insideLeft', offset: 14, fontSize: 10, fill: '#888' }}
            />

            <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />

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

            {/* Per-game team RV — brown solid */}
            <Line
              data={lineData}
              dataKey="team_rv"
              type="monotone"
              stroke={BROWN}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />

            {/* Centered actual runs — gold dashed */}
            <Line
              data={lineData}
              dataKey="runs_delta"
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
              style={{ color: hoveredPlayer.rv >= 0 ? TURQ : PINK }}
            >
              {hoveredPlayer.rv >= 0 ? '+' : ''}{hoveredPlayer.rv.toFixed(3)}
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
