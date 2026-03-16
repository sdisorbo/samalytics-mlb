'use client'

import { useMemo } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  type TooltipProps,
} from 'recharts'
import type { PlayoffTeam, TeamStanding } from '@/lib/types'
import { teamColor } from '@/lib/teamColors'

interface Props {
  results: PlayoffTeam[]
  standings: TeamStanding[]
}

const ROUND_COLORS = {
  win_ws:       '#005A9C',
  win_cs:       '#008FD5',
  win_ds:       '#66C2E8',
  win_wildcard: '#B3DFF5',
}

const ROUND_LABELS = {
  win_ws:       'Win WS',
  win_cs:       'Win CS',
  win_ds:       'Win DS',
  win_wildcard: 'Win WC',
}

function pct(n: number) { return `${Math.round(n * 100)}%` }

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-538-border rounded shadow-sm px-3 py-2 text-xs min-w-[130px]">
      <p className="font-bold mb-1.5" style={{ color: teamColor(label as string) }}>{label}</p>
      {[...payload].reverse().map(entry => (
        <div key={entry.dataKey} className="flex justify-between gap-4">
          <span className="text-538-muted">{ROUND_LABELS[entry.dataKey as keyof typeof ROUND_LABELS]}</span>
          <span className="font-semibold tabular">{pct((entry.value ?? 0) / 100)}</span>
        </div>
      ))}
    </div>
  )
}

export default function PlayoffOddsChart({ results, standings }: Props) {
  // Only show teams with any playoff odds
  const playoffTeams = useMemo(
    () =>
      results
        .filter(r => r.win_ws > 0 || r.win_cs > 0 || r.win_ds > 0)
        .sort((a, b) => b.win_ws - a.win_ws),
    [results]
  )

  const chartData = useMemo(
    () =>
      playoffTeams.map(r => ({
        team:         r.team,
        win_ws:       Math.round(r.win_ws * 100),
        win_cs:       Math.round(r.win_cs * 100),
        win_ds:       Math.round(r.win_ds * 100),
        win_wildcard: Math.round(r.win_wildcard * 100),
      })),
    [playoffTeams]
  )

  // Table data — full 30-team list
  const tableData = useMemo(
    () =>
      results
        .map(r => {
          const standing = standings.find(s => s.team_abbr === r.team)
          return { ...r, standing }
        })
        .sort((a, b) => b.win_ws - a.win_ws),
    [results, standings]
  )

  return (
    <div className="space-y-8">
      {/* Bar chart */}
      <div className="stat-card p-4">
        <p className="section-heading mb-3">Simulated playoff advancement odds</p>
        <ResponsiveContainer width="100%" height={420}>
          <BarChart
            data={chartData}
            margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
            barCategoryGap="30%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" horizontal vertical={false} />
            <XAxis
              dataKey="team"
              tick={{ fontSize: 11, fill: '#555', fontWeight: 600 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={v => `${v}%`}
              tick={{ fontSize: 11, fill: '#888' }}
              axisLine={false}
              tickLine={false}
              width={36}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: '#F5F5F5' }} />
            <Legend
              formatter={key => ROUND_LABELS[key as keyof typeof ROUND_LABELS]}
              wrapperStyle={{ fontSize: '0.7rem', paddingTop: '12px' }}
            />
            <Bar dataKey="win_wildcard" stackId="a" fill={ROUND_COLORS.win_wildcard} radius={[0,0,0,0]} />
            <Bar dataKey="win_ds"       stackId="a" fill={ROUND_COLORS.win_ds} />
            <Bar dataKey="win_cs"       stackId="a" fill={ROUND_COLORS.win_cs} />
            <Bar dataKey="win_ws"       stackId="a" fill={ROUND_COLORS.win_ws} radius={[3,3,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Full table */}
      <div className="stat-card p-0 overflow-hidden">
        <div className="px-4 pt-3 pb-1 border-b border-538-border">
          <p className="section-heading">Full odds table — all 30 teams</p>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th className="text-left">Team</th>
                <th className="text-right">Win WC</th>
                <th className="text-right">Win DS</th>
                <th className="text-right">Win CS</th>
                <th className="text-right">Win WS</th>
                <th className="text-right">W-L</th>
                <th className="text-right">ELO</th>
              </tr>
            </thead>
            <tbody>
              {tableData.map(({ team, win_wildcard, win_ds, win_cs, win_ws, standing }) => (
                <tr key={team}>
                  <td>
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-flex items-center justify-center w-8 h-5 rounded text-white font-bold"
                        style={{ backgroundColor: teamColor(team), fontSize: '0.6rem' }}
                      >
                        {team}
                      </span>
                      <span>{standing?.team ?? team}</span>
                    </div>
                  </td>
                  <td className="text-right tabular text-538-muted">{pct(win_wildcard)}</td>
                  <td className="text-right tabular">{pct(win_ds)}</td>
                  <td className="text-right tabular">{pct(win_cs)}</td>
                  <td
                    className="text-right tabular font-semibold"
                    style={{ color: win_ws > 0.15 ? '#005A9C' : undefined }}
                  >
                    {pct(win_ws)}
                  </td>
                  <td className="text-right tabular text-538-muted">
                    {standing ? `${standing.wins}-${standing.losses}` : '—'}
                  </td>
                  <td className="text-right tabular">
                    {standing ? Math.round(standing.elo_rating) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
