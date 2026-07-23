'use client'

import Link from 'next/link'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ScatterChart, Scatter, ReferenceLine,
  ZAxis, Customized,
} from 'recharts'
import TeamPerformance from './TeamPerformance'
import { teamColor, teamLogoUrl } from '@/lib/teamColors'
import type { TeamStanding, RatingPoint, PlayerWar, TeamGameLog } from '@/lib/types'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Props {
  standing: TeamStanding
  teamHistory: RatingPoint[]
  teamPlayerWar: PlayerWar[]
  allPlayerWar: PlayerWar[]
  teamLogs: TeamGameLog[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const LEAGUE_MIN = 740_000

function fmtSalary(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  return `$${Math.round(n / 1_000)}K`
}

function median(arr: number[]): number {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid]
}

function pct(n: number, decimals = 0): string {
  return (n * 100).toFixed(decimals) + '%'
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

// Custom dot for scatter: player headshot circle
function HeadshotDot(props: Record<string, unknown>) {
  const { cx, cy, payload } = props as { cx: number; cy: number; payload: ScatterPoint }
  const size = 28
  const r = size / 2
  const id = `clip-${payload.bref_id}`
  return (
    <g>
      <defs>
        <clipPath id={id}>
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
      </defs>
      {payload.player_id ? (
        <image
          href={`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${payload.player_id}/headshot/67/current`}
          x={cx - r}
          y={cy - r}
          width={size}
          height={size}
          clipPath={`url(#${id})`}
          style={{ imageRendering: 'auto' }}
        />
      ) : (
        <circle cx={cx} cy={cy} r={r} fill="#888" opacity={0.5} />
      )}
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={1} />
    </g>
  )
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

// Custom scatter tooltip
function ScatterTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ScatterPoint }> }) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-538-card border border-538-border rounded px-3 py-2 text-xs shadow-lg">
      <div className="font-semibold text-538-text">{d.name}</div>
      <div className="text-538-muted">{d.player_type === 'pitcher' ? 'P' : 'B'}</div>
      <div className="mt-1 font-mono">WAR: <span className="text-538-text font-semibold">{d.war.toFixed(1)}</span></div>
      <div className="font-mono">Salary: <span className="text-538-text font-semibold">{fmtSalary(d.salary)}</span></div>
      {d.war >= 0.5 && <div className="font-mono">$/WAR: <span className="text-538-text">{fmtSalary(d.salary / d.war)}/W</span></div>}
    </div>
  )
}

// ELO tooltip
function EloTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-538-card border border-538-border rounded px-2 py-1.5 text-xs shadow">
      <div className="text-538-muted">{label}</div>
      <div className="font-mono font-semibold text-538-text">{payload[0].value.toFixed(0)}</div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TeamPage({ standing, teamHistory, teamPlayerWar, allPlayerWar, teamLogs }: Props) {
  const abbr = standing.team_abbr
  const primary = teamColor(abbr)
  const logoUrl = teamLogoUrl(abbr)

  // ── ELO chart data ───────────────────────────────────────────────────────────
  const eloData = teamHistory.slice(-60).map(p => ({
    date: p.date,
    elo: Math.round(p.rating),
  }))

  // ── Payroll / WAR math ───────────────────────────────────────────────────────
  const warPlayers = teamPlayerWar.filter(p => p.salary && p.salary > 0)
  const totalPayroll = warPlayers.reduce((s, p) => s + (p.salary ?? 0), 0)
  const totalWar = teamPlayerWar.reduce((s, p) => s + p.war, 0)

  // League $/WAR: use all players with WAR >= 0.5 and real salary (above league min)
  const leaguePairs = allPlayerWar
    .filter(p => p.war >= 0.5 && p.salary && p.salary > LEAGUE_MIN)
    .map(p => (p.salary! / p.war))
  const leagueDpw = median(leaguePairs)

  const teamDpw = totalWar >= 0.5 ? totalPayroll / totalWar : null
  const efficiency = teamDpw && leagueDpw ? leagueDpw / teamDpw : null // >1 = underpaying (good)

  // ── Scatter plot data ────────────────────────────────────────────────────────
  const scatterData: ScatterPoint[] = teamPlayerWar
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

  const medWar = median(teamPlayerWar.filter(p => p.war >= 0.5).map(p => p.war))
  const medSalary = median(warPlayers.map(p => p.salary!)) / 1_000_000

  const dpwM = leagueDpw / 1_000_000
  const maxWar = scatterData.length > 0 ? Math.max(...scatterData.map(d => d.war), 5) + 1 : 6

  const eloChange = standing.elo_change_7d
  const eloChangeColor = eloChange > 0 ? '#3C999E' : eloChange < 0 ? '#9B405A' : '#888'

  return (
    <div className="min-h-screen bg-538-bg text-538-text px-4 py-6 max-w-5xl mx-auto">
      {/* Back nav */}
      <Link href="/" className="text-xs text-538-muted hover:text-538-text transition-colors flex items-center gap-1 mb-6">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Standings
      </Link>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 mb-8">
        {logoUrl && (
          <img src={logoUrl} alt={abbr} width={72} height={72} className="object-contain" />
        )}
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
        <h2 className="text-sm font-semibold text-538-muted uppercase tracking-wide mb-3">ELO Trend (Last 60 Days)</h2>
        <div className="bg-538-card border border-538-border rounded-xl p-4" style={{ height: 200 }}>
          {eloData.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={eloData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: '#888' }}
                  tickFormatter={d => d.slice(5)}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={{ fontSize: 10, fill: '#888' }}
                  width={40}
                />
                <Tooltip content={<EloTooltip />} />
                <Line
                  type="monotone"
                  dataKey="elo"
                  stroke={primary}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-538-muted text-sm">No ELO history available</div>
          )}
        </div>
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <StatBox label="Total Payroll" value={fmtSalary(totalPayroll)} />
          <StatBox label="Total WAR" value={totalWar.toFixed(1)} />
          <StatBox
            label="Team $/WAR"
            value={teamDpw ? fmtSalary(teamDpw) + '/W' : '—'}
            sub={leagueDpw ? `League avg: ${fmtSalary(leagueDpw)}/W` : undefined}
          />
          <StatBox
            label="Value vs Market"
            value={efficiency ? (efficiency >= 1 ? `${pct(efficiency - 1, 1)} under` : `${pct(1 - efficiency, 1)} over`) : '—'}
            color={efficiency ? (efficiency >= 1 ? '#3C999E' : '#9B405A') : undefined}
            sub={efficiency && efficiency >= 1 ? 'underpaying (good)' : efficiency ? 'overpaying' : undefined}
          />
        </div>
      </section>

      {/* ── WAR vs Salary Scatter ──────────────────────────────────────────── */}
      {scatterData.length > 0 && (
        <section className="mb-10">
          <h2 className="text-sm font-semibold text-538-muted uppercase tracking-wide mb-3">WAR vs Salary</h2>
          <div className="bg-538-card border border-538-border rounded-xl p-4" style={{ height: 420 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  type="number"
                  dataKey="war"
                  name="WAR"
                  label={{ value: 'WAR', position: 'insideBottom', offset: -15, style: { fill: '#888', fontSize: 11 } }}
                  tick={{ fontSize: 10, fill: '#888' }}
                  domain={['auto', 'auto']}
                />
                <YAxis
                  type="number"
                  dataKey="salaryM"
                  name="Salary"
                  tickFormatter={v => `$${v.toFixed(0)}M`}
                  tick={{ fontSize: 10, fill: '#888' }}
                  width={52}
                />
                <ZAxis range={[1, 1]} />
                <Tooltip content={<ScatterTooltip />} />

                {/* Quadrant reference lines */}
                {medWar > 0 && (
                  <ReferenceLine x={medWar} stroke="rgba(255,255,255,0.1)" strokeDasharray="4 3" />
                )}
                {medSalary > 0 && (
                  <ReferenceLine y={medSalary} stroke="rgba(255,255,255,0.1)" strokeDasharray="4 3" />
                )}

                {/* Market rate diagonal via Customized */}
                {leagueDpw > 0 && (
                  <Customized component={(props: Record<string, unknown>) => {
                    const { xAxisMap, yAxisMap } = props as {
                      xAxisMap: Record<string, { scale: (v: number) => number }>
                      yAxisMap: Record<string, { scale: (v: number) => number }>
                    }
                    const xScale = xAxisMap && Object.values(xAxisMap)[0]?.scale
                    const yScale = yAxisMap && Object.values(yAxisMap)[0]?.scale
                    if (!xScale || !yScale) return null
                    const x1 = xScale(0)
                    const y1 = yScale(0)
                    const x2 = xScale(maxWar)
                    const y2 = yScale(maxWar * dpwM)
                    return (
                      <line
                        x1={x1} y1={y1} x2={x2} y2={y2}
                        stroke="rgba(255,255,255,0.18)"
                        strokeWidth={1.5}
                        strokeDasharray="6 4"
                      />
                    )
                  }} />
                )}

                <Scatter
                  data={scatterData}
                  shape={<HeadshotDot />}
                  name="Players"
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-538-muted mt-2">
            Dashed line = league market rate (~{fmtSalary(leagueDpw)}/WAR). Crosshairs = team medians.
            Headshots shown for players with MLB IDs.
          </p>
        </section>
      )}
    </div>
  )
}
