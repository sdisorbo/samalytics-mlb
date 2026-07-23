'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ScatterChart, Scatter, ReferenceLine,
  ZAxis, Customized,
} from 'recharts'
import TeamPerformance from './TeamPerformance'
import { teamColor, teamLogoUrl } from '@/lib/teamColors'
import type { TeamStanding, RatingPoint, PlayerWar, TeamGameLog, TeamRatingsHistory } from '@/lib/types'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Props {
  standing: TeamStanding
  teamHistory: RatingPoint[]
  allHistory: TeamRatingsHistory
  teamPlayerWar: PlayerWar[]
  allPlayerWar: PlayerWar[]
  teamLogs: TeamGameLog[]
}

interface ScatterPoint {
  war: number
  salary: number
  salaryM: number
  name: string
  bref_id: string
  player_id: number | null
  player_type: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const LEAGUE_MIN = 740_000

function fmtSalary(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  return `$${Math.round(n / 1_000)}K`
}

function pct(n: number, decimals = 0): string {
  return (n * 100).toFixed(decimals) + '%'
}

function median(arr: number[]): number {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

function iqrBounds(arr: number[], factor = 1.5) {
  if (arr.length < 4) return { lo: -Infinity, hi: Infinity }
  const s = [...arr].sort((a, b) => a - b)
  const q1 = s[Math.floor(s.length * 0.25)]
  const q3 = s[Math.floor(s.length * 0.75)]
  const iqr = q3 - q1
  return { lo: q1 - factor * iqr, hi: q3 + factor * iqr }
}

// ── ELO chart data builder ─────────────────────────────────────────────────────

type EloRow = { date: string; elo?: number; leagueHigh?: number; leagueLow?: number }

function buildEloData(abbr: string, teamHistory: RatingPoint[], allHistory: TeamRatingsHistory): EloRow[] {
  if (!teamHistory.length) return []
  const year = parseInt(teamHistory[0].date.slice(0, 4)) || new Date().getFullYear()
  const seasonStart = `${year}-03-20`

  // Weekly scaffold
  const scaffold: string[] = []
  const cur = new Date(seasonStart + 'T12:00:00Z')
  const end = new Date(`${year}-10-05T12:00:00Z`)
  while (cur <= end) {
    scaffold.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 7)
  }

  const dateRe = /^\d{4}-\d{2}-\d{2}$/
  const allTeams = Array.from(new Set([abbr, ...Object.keys(allHistory)]))
  const dateMap = new Map<string, Record<string, number>>()

  for (const t of allTeams) {
    for (const { date, rating } of (allHistory[t] ?? [])) {
      const d = dateRe.test(date) ? date : seasonStart
      if (!dateMap.has(d)) dateMap.set(d, {})
      dateMap.get(d)![t] = rating
    }
  }
  // Ensure this team's data is included even if allHistory keying differs
  for (const { date, rating } of teamHistory) {
    const d = dateRe.test(date) ? date : seasonStart
    if (!dateMap.has(d)) dateMap.set(d, {})
    dateMap.get(d)![abbr] = rating
  }

  const allRealDates = Array.from(dateMap.keys()).sort()
  const lastReal = allRealDates[allRealDates.length - 1]
  const cutoff = lastReal ? (scaffold.find(d => d >= lastReal) ?? scaffold[scaffold.length - 1]) : null

  const lastVal: Record<string, number> = {}
  let ri = 0
  const rows: EloRow[] = []

  for (const slot of scaffold) {
    while (ri < allRealDates.length && allRealDates[ri] <= slot) {
      const pts = dateMap.get(allRealDates[ri])!
      for (const t of allTeams) { if (pts[t] != null) lastVal[t] = pts[t] }
      ri++
    }
    if (!cutoff || slot > cutoff || !Object.keys(lastVal).length) {
      rows.push({ date: slot })
      continue
    }
    const allVals = allTeams.map(t => lastVal[t]).filter((v): v is number => v != null)
    rows.push({
      date: slot,
      elo: lastVal[abbr],
      leagueHigh: allVals.length ? Math.max(...allVals) : undefined,
      leagueLow:  allVals.length ? Math.min(...allVals) : undefined,
    })
  }
  return rows
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatBox({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-538-card border border-538-border rounded-lg px-4 py-3 flex flex-col gap-0.5">
      <span className="text-xs text-538-muted uppercase tracking-wide">{label}</span>
      <span className="text-xl font-bold font-mono" style={{ color }}>{value}</span>
      {sub && <span className="text-xs text-538-muted">{sub}</span>}
    </div>
  )
}

// League band between high/low ELO — same pattern as EloHistoryChart
function LeagueBand(props: Record<string, unknown>) {
  try {
    const { xAxisMap, yAxisMap, data } = props as {
      xAxisMap: Record<string, { scale: ((v: string) => number) & { bandwidth?: () => number } }>
      yAxisMap: Record<string, { scale: (v: number) => number }>
      data: EloRow[]
    }
    const xAxis = xAxisMap[Object.keys(xAxisMap)[0]]
    const yAxis = yAxisMap[Object.keys(yAxisMap)[0]]
    if (!xAxis?.scale || !yAxis?.scale || !data?.length) return null
    const bw = typeof xAxis.scale.bandwidth === 'function' ? xAxis.scale.bandwidth() / 2 : 0
    const items = data.filter(d => d.leagueHigh != null && d.leagueLow != null)
    if (items.length < 2) return null
    const top = items.map(d => {
      const x = xAxis.scale(d.date) + bw
      const y = yAxis.scale(d.leagueHigh!)
      return isFinite(x) && isFinite(y) ? [x, y] as [number, number] : null
    }).filter(Boolean) as [number, number][]
    const bot = [...items].reverse().map(d => {
      const x = xAxis.scale(d.date) + bw
      const y = yAxis.scale(d.leagueLow!)
      return isFinite(x) && isFinite(y) ? [x, y] as [number, number] : null
    }).filter(Boolean) as [number, number][]
    if (top.length < 2) return null
    const path =
      `M${top[0][0].toFixed(1)},${top[0][1].toFixed(1)} ` +
      top.slice(1).map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ') + ' ' +
      bot.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ') + ' Z'
    return <path d={path} fill="rgba(150, 120, 90, 0.1)" stroke="none" />
  } catch { return null }
}

// Market rate diagonal
function MarketLine({ dpwM, maxWar }: { dpwM: number; maxWar: number }) {
  return (props: Record<string, unknown>) => {
    try {
      const { xAxisMap, yAxisMap } = props as {
        xAxisMap: Record<string, { scale: (v: number) => number }>
        yAxisMap: Record<string, { scale: (v: number) => number }>
      }
      const xs = Object.values(xAxisMap)[0]?.scale
      const ys = Object.values(yAxisMap)[0]?.scale
      if (!xs || !ys) return null
      return (
        <line
          x1={xs(0)} y1={ys(0)} x2={xs(maxWar)} y2={ys(maxWar * dpwM)}
          stroke="rgba(255,255,255,0.25)"
          strokeWidth={1.5}
          strokeDasharray="6 4"
        />
      )
    } catch { return null }
  }
}

function HeadshotDot({ teamPrimary }: { teamPrimary: string }) {
  return function Dot(props: Record<string, unknown>) {
    const { cx, cy, payload } = props as { cx: number; cy: number; payload: ScatterPoint }
    const size = 28
    const r = size / 2
    const id = `clip-${payload.bref_id}-${payload.player_type}`
    return (
      <g>
        <defs>
          <clipPath id={id}>
            <circle cx={cx} cy={cy} r={r - 1} />
          </clipPath>
        </defs>
        {/* team color background ring */}
        <circle cx={cx} cy={cy} r={r + 1} fill={teamPrimary} opacity={0.85} />
        {payload.player_id ? (
          <image
            href={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${payload.player_id}/headshot/67/current`}
            x={cx - r + 1}
            y={cy - r + 1}
            width={size - 2}
            height={size - 2}
            clipPath={`url(#${id})`}
          />
        ) : (
          <circle cx={cx} cy={cy} r={r - 1} fill="#555" clipPath={`url(#${id})`} />
        )}
      </g>
    )
  }
}

function ScatterTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ScatterPoint }> }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-538-card border border-538-border rounded px-3 py-2 text-xs shadow-lg">
      <div className="font-semibold text-538-text">{d.name}</div>
      <div className="text-538-muted">{d.player_type === 'pitcher' ? 'Pitcher' : 'Batter'}</div>
      <div className="mt-1 font-mono">WAR: <span className="font-semibold text-538-text">{d.war.toFixed(1)}</span></div>
      <div className="font-mono">Salary: <span className="font-semibold text-538-text">{fmtSalary(d.salary)}</span></div>
      {d.war >= 0.5 && <div className="font-mono">$/WAR: <span className="text-538-text">{fmtSalary(d.salary / d.war)}/W</span></div>}
    </div>
  )
}

function EloTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color?: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  const eloEntry = payload.find(e => e.dataKey === 'elo')
  if (!eloEntry?.value) return null
  return (
    <div className="bg-538-card border border-538-border rounded px-2 py-1.5 text-xs shadow">
      <div className="text-538-muted mb-0.5">{label}</div>
      <div className="font-mono font-semibold" style={{ color: eloEntry.color }}>{Math.round(eloEntry.value)}</div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TeamPage({ standing, teamHistory, allHistory, teamPlayerWar, allPlayerWar, teamLogs }: Props) {
  const [clipOutliers, setClipOutliers] = useState(false)
  const abbr = standing.team_abbr
  const primary = teamColor(abbr)
  const logoUrl = teamLogoUrl(abbr)

  // ── ELO chart ────────────────────────────────────────────────────────────────
  const eloData = useMemo(
    () => buildEloData(abbr, teamHistory, allHistory),
    [abbr, teamHistory, allHistory]
  )

  // ── Payroll / WAR math ───────────────────────────────────────────────────────
  const hasSalaryData = allPlayerWar.some(p => p.salary && p.salary > LEAGUE_MIN)

  const warPlayers = teamPlayerWar.filter(p => p.salary && p.salary > 0)
  const totalPayroll = warPlayers.reduce((s, p) => s + (p.salary ?? 0), 0)
  const totalWar = teamPlayerWar.reduce((s, p) => s + p.war, 0)

  // League $/WAR from all players with meaningful salary (above league min)
  const leaguePairs = allPlayerWar
    .filter(p => p.war >= 0.5 && p.salary && p.salary > LEAGUE_MIN)
    .map(p => p.salary! / p.war)
  const leagueDpw = median(leaguePairs)

  const teamDpw = totalWar >= 0.5 && totalPayroll > 0 ? totalPayroll / totalWar : null
  const efficiency = teamDpw && leagueDpw > 0 ? leagueDpw / teamDpw : null

  // ── Efficiency ranking among all teams ───────────────────────────────────────
  const teamEfficiencies = useMemo(() => {
    const byTeam: Record<string, { pay: number; war: number }> = {}
    for (const p of allPlayerWar) {
      if (!p.salary || p.salary <= LEAGUE_MIN) continue
      if (!byTeam[p.team]) byTeam[p.team] = { pay: 0, war: 0 }
      byTeam[p.team].pay += p.salary
      byTeam[p.team].war += p.war
    }
    return Object.entries(byTeam)
      .filter(([, v]) => v.war >= 0.5)
      .map(([t, v]) => ({ team: t, dpw: v.pay / v.war }))
      .sort((a, b) => a.dpw - b.dpw)
  }, [allPlayerWar])

  const teamRank = teamEfficiencies.findIndex(e => e.team === abbr) + 1
  const rankTotal = teamEfficiencies.length

  // ── Scatter plot ─────────────────────────────────────────────────────────────
  const allScatterData: ScatterPoint[] = teamPlayerWar
    .filter(p => p.salary && p.salary > 0)
    .map(p => ({
      war: p.war,
      salary: p.salary!,
      salaryM: p.salary! / 1_000_000,
      name: p.name,
      bref_id: p.bref_id,
      player_id: p.player_id,
      player_type: p.player_type,
    }))

  const scatterData = useMemo(() => {
    if (!clipOutliers || allScatterData.length < 4) return allScatterData
    const warB  = iqrBounds(allScatterData.map(d => d.war))
    const salB  = iqrBounds(allScatterData.map(d => d.salaryM))
    return allScatterData.filter(d => d.war >= warB.lo && d.war <= warB.hi && d.salaryM >= salB.lo && d.salaryM <= salB.hi)
  }, [allScatterData, clipOutliers])

  // Medians from unclipped data so lines don't jump when clipping
  const medWar    = median(allScatterData.filter(d => d.war >= 0.5).map(d => d.war))
  const medSalM   = median(allScatterData.map(d => d.salaryM))
  const dpwM      = leagueDpw / 1_000_000
  const maxWarVal = scatterData.length > 0 ? Math.max(...scatterData.map(d => d.war)) * 1.1 : 6

  const DotComponent = useMemo(() => HeadshotDot({ teamPrimary: primary }), [primary])

  const eloChange = standing.elo_change_7d
  const eloChangeColor = eloChange > 0 ? '#3C999E' : eloChange < 0 ? '#9B405A' : '#888'

  return (
    <div className="min-h-screen bg-538-bg text-538-text px-4 py-6 max-w-5xl mx-auto">

      {/* Back nav */}
      <Link href="/standings" className="text-xs text-538-muted hover:text-538-text transition-colors flex items-center gap-1 mb-6">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Standings
      </Link>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 mb-8">
        {logoUrl && <img src={logoUrl} alt={abbr} width={72} height={72} className="object-contain" />}
        <div>
          <h1 className="text-2xl font-bold text-538-text">{standing.team}</h1>
          <div className="text-sm text-538-muted mt-0.5">{standing.division}</div>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="text-lg font-mono font-semibold">{standing.wins}–{standing.losses}</span>
            <span className="text-sm text-538-muted">ELO <span className="font-mono text-538-text">{Math.round(standing.elo_rating)}</span></span>
            <span className="text-sm font-mono" style={{ color: eloChangeColor }}>
              {eloChange > 0 ? '+' : ''}{eloChange.toFixed(1)} (7d)
            </span>
          </div>
        </div>
      </div>

      {/* ── Playoff odds ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <StatBox label="Playoff %" value={pct(standing.playoff_probability)} color={standing.playoff_probability > 0.5 ? '#3C999E' : undefined} />
        <StatBox label="Win Division" value={pct(standing.win_ds)} />
        <StatBox label="Win Pennant" value={pct(standing.win_cs)} />
        <StatBox label="Win WS" value={pct(standing.win_ws)} />
      </div>

      {/* ── ELO Trend ──────────────────────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-538-muted uppercase tracking-wide mb-3">ELO Trend</h2>
        <div className="bg-538-card border border-538-border rounded-xl p-4" style={{ height: 220 }}>
          {eloData.some(d => d.elo != null) ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={eloData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: '#8A6248' }}
                  tickFormatter={d => (d as string).slice(5)}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 10, fill: '#8A6248' }}
                  width={40}
                />
                <Tooltip content={<EloTooltip />} />
                <ReferenceLine y={1500} stroke="rgba(150,120,90,0.4)" strokeDasharray="4 3" label={{ value: '1500', position: 'insideTopLeft', fontSize: 9, fill: '#8A6248' }} />
                {/* League high/low band */}
                <Line dataKey="leagueHigh" stroke="transparent" dot={false} legendType="none" />
                <Line dataKey="leagueLow"  stroke="transparent" dot={false} legendType="none" />
                <Customized component={LeagueBand as any} />
                {/* Team line */}
                <Line
                  type="monotone"
                  dataKey="elo"
                  stroke={primary}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4, fill: primary }}
                  connectNulls={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-538-muted text-sm">No ELO history available</div>
          )}
        </div>
        <p className="text-xs text-538-muted mt-1.5">Grey band = league high/low range. Dashed = 1500 avg.</p>
      </section>

      {/* ── Team Performance ───────────────────────────────────────────────── */}
      {teamLogs.length > 0 && (
        <section className="mb-10">
          <h2 className="text-sm font-semibold text-538-muted uppercase tracking-wide mb-3">Team Performance</h2>
          <TeamPerformance logs={teamLogs} />
        </section>
      )}

      {/* ── Payroll & Contract Efficiency ──────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="text-sm font-semibold text-538-muted uppercase tracking-wide mb-3">Payroll & Contract Efficiency</h2>
        {!hasSalaryData ? (
          <p className="text-sm text-538-muted italic">Salary data unavailable — re-run the pipeline to populate contract values.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <StatBox label="Total Payroll" value={totalPayroll > 0 ? fmtSalary(totalPayroll) : '—'} />
              <StatBox label="Total WAR" value={totalWar.toFixed(1)} />
              <StatBox
                label="Team $/WAR"
                value={teamDpw ? fmtSalary(teamDpw) + '/W' : '—'}
                sub={leagueDpw > 0 ? `Market: ${fmtSalary(leagueDpw)}/W` : undefined}
              />
              <StatBox
                label="Value vs Market"
                value={
                  efficiency == null ? '—'
                    : efficiency >= 1 ? `${pct(efficiency - 1, 1)} under`
                    : `${pct(1 - efficiency, 1)} over`
                }
                color={efficiency != null ? (efficiency >= 1 ? '#3C999E' : '#9B405A') : undefined}
                sub={
                  efficiency == null ? undefined
                    : teamRank > 0 ? `#${teamRank} of ${rankTotal} teams`
                    : efficiency >= 1 ? 'underpaying (good)' : 'overpaying'
                }
              />
            </div>
            {teamRank > 0 && (
              <p className="text-xs text-538-muted">
                Ranked <span className="font-semibold text-538-text">#{teamRank}</span> of {rankTotal} teams by $/WAR — lower rank = better value per win.
                Market rate uses current-season data only (salary inflation makes multi-year averages inaccurate).
              </p>
            )}
          </>
        )}
      </section>

      {/* ── WAR vs Salary Scatter ──────────────────────────────────────────── */}
      {allScatterData.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-538-muted uppercase tracking-wide">WAR vs Salary</h2>
            {allScatterData.length > 4 && (
              <button
                onClick={() => setClipOutliers(v => !v)}
                className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                  clipOutliers
                    ? 'bg-538-accent/20 border-538-accent text-538-accent'
                    : 'border-538-border text-538-muted hover:text-538-text'
                }`}
              >
                {clipOutliers ? 'Show all' : 'Clip outliers'}
              </button>
            )}
          </div>
          <div className="bg-538-card border border-538-border rounded-xl p-4" style={{ height: 440 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 20, bottom: 34, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  type="number"
                  dataKey="war"
                  name="WAR"
                  label={{ value: 'WAR', position: 'insideBottom', offset: -20, style: { fill: '#888', fontSize: 11 } }}
                  tick={{ fontSize: 10, fill: '#888' }}
                  domain={['auto', 'auto']}
                />
                <YAxis
                  type="number"
                  dataKey="salaryM"
                  name="Salary"
                  tickFormatter={v => `$${(v as number).toFixed(0)}M`}
                  tick={{ fontSize: 10, fill: '#888' }}
                  width={54}
                />
                <ZAxis range={[1, 1]} />
                <Tooltip content={<ScatterTooltip />} />

                {/* Team median crosshairs */}
                {medWar > 0 && (
                  <ReferenceLine x={medWar} stroke="rgba(255,255,255,0.22)" strokeDasharray="5 3"
                    label={{ value: `med WAR ${medWar.toFixed(1)}`, position: 'insideTopRight', fontSize: 9, fill: 'rgba(255,255,255,0.4)' }} />
                )}
                {medSalM > 0 && (
                  <ReferenceLine y={medSalM} stroke="rgba(255,255,255,0.22)" strokeDasharray="5 3"
                    label={{ value: `med ${fmtSalary(medSalM * 1_000_000)}`, position: 'insideTopLeft', fontSize: 9, fill: 'rgba(255,255,255,0.4)' }} />
                )}

                {/* Market rate diagonal */}
                {leagueDpw > 0 && (
                  <Customized component={MarketLine({ dpwM, maxWar: maxWarVal }) as any} />
                )}

                <Scatter data={scatterData} shape={DotComponent as any} name="Players" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-538-muted mt-2">
            {leagueDpw > 0 && <>Dashed line = league market rate (~{fmtSalary(leagueDpw)}/WAR). </>}
            Crosshairs = team medians. Circles outlined in team color.
            {clipOutliers && ' Outliers hidden (IQR ×1.5).'}
          </p>
        </section>
      )}
    </div>
  )
}
