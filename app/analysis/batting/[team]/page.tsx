import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPlayers } from '@/lib/data'
import {
  getTeamBattingStats,
  battingHeadline,
  battingArticleBody,
  type TeamBattingStats,
} from '@/lib/articleUtils'
import type { Player } from '@/lib/types'

interface Props {
  params: Promise<{ team: string }>
}

function logoUrl(abbr: string): string {
  return `https://a.espncdn.com/i/teamlogos/mlb/500/${abbr.toLowerCase()}.png`
}

function shortDate(): string {
  return new Date().toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function fmt3(n: number | null): string {
  if (n == null) return '—'
  return '.' + String(Math.round(n * 1000)).padStart(3, '0')
}

function PercentileBar({ label, value, stat }: { label: string; value: number; stat: string }) {
  const isStrong = value >= 50
  return (
    <div className="flex items-center gap-3">
      <span className="w-12 text-xs font-semibold text-538-muted text-right shrink-0">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-538-border overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${value}%`,
            backgroundColor: isStrong ? '#B20D30' : '#3D405B',
          }}
        />
      </div>
      <span className="w-8 text-xs font-bold tabular-nums text-right shrink-0" style={{ color: isStrong ? '#B20D30' : '#3D405B' }}>
        {value}
      </span>
      <span className="text-[10px] text-538-muted w-8 shrink-0">{stat}</span>
    </div>
  )
}

function BatterTable({ players }: { players: Player[] }) {
  const qualified = players
    .filter((p) => !['SP', 'RP', 'P'].includes(p.position) && p.avg != null)
    .sort((a, b) => (b.ops ?? 0) - (a.ops ?? 0))

  if (qualified.length === 0) {
    return <p className="text-538-muted text-sm">No qualified batters found.</p>
  }

  return (
    <div className="table-scroll">
      <table className="data-table w-full">
        <thead>
          <tr>
            <th className="text-left">Name</th>
            <th className="text-left">Pos</th>
            <th className="text-right">AVG</th>
            <th className="text-right">OBP</th>
            <th className="text-right">SLG</th>
            <th className="text-right">OPS</th>
            <th className="text-right">K%</th>
            <th className="text-right">BB%</th>
          </tr>
        </thead>
        <tbody>
          {qualified.map((p) => (
            <tr key={p.player_id}>
              <td className="font-semibold text-538-text">{p.name}</td>
              <td className="text-538-muted text-xs uppercase">{p.position}</td>
              <td className="text-right tabular-nums">{fmt3(p.avg)}</td>
              <td className="text-right tabular-nums">{fmt3(p.obp)}</td>
              <td className="text-right tabular-nums">{fmt3(p.slg)}</td>
              <td className="text-right tabular-nums">{fmt3(p.ops)}</td>
              <td className="text-right tabular-nums">{p.k_pct != null ? p.k_pct.toFixed(1) + '%' : '—'}</td>
              <td className="text-right tabular-nums">{p.bb_pct != null ? p.bb_pct.toFixed(1) + '%' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default async function BattingArticlePage({ params }: Props) {
  const { team } = await params
  const abbr = team.toUpperCase()

  let players: Player[] = []
  let stats: TeamBattingStats | null = null

  try {
    players = getPlayers()
    stats   = getTeamBattingStats(abbr, players)
  } catch {
    // data unavailable
  }

  if (!stats) notFound()

  const teamPlayers = players.filter((p) => p.team === abbr)
  const headline    = battingHeadline(stats.teamName, stats)
  const body        = battingArticleBody(stats.teamName, stats)

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Back link */}
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-538-muted hover:text-538-text transition-colors">
        <span>←</span>
        <span>Back to Home</span>
      </Link>

      {/* Article header */}
      <div className="border-t-4 pt-4" style={{ borderColor: '#B20D30' }}>
        <div className="flex items-center gap-3 mb-2">
          <img
            src={logoUrl(abbr)}
            alt={abbr}
            width={48}
            height={48}
            className="object-contain"
          />
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-white inline-block mb-1" style={{ backgroundColor: '#B20D30' }}>
              Batting Analysis
            </div>
            <h1 className="font-black text-2xl text-538-text leading-tight">{stats.teamName.toUpperCase()}</h1>
          </div>
        </div>
        <h2 className="font-bold text-xl text-538-text leading-snug mb-1">{headline}</h2>
        <p className="text-[11px] text-538-muted">Published {shortDate()}</p>
      </div>

      {/* Percentile chart */}
      <div className="bg-surface border border-538-border rounded-xl p-5 space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-538-muted mb-4">
          Lineup Percentile Rankings
        </h3>
        <PercentileBar label="AVG"  value={stats.avgPercentile}   stat="AVG" />
        <PercentileBar label="OBP"  value={stats.obpPercentile}   stat="OBP" />
        <PercentileBar label="SLG"  value={stats.slgPercentile}   stat="SLG" />
        <PercentileBar label="OPS"  value={stats.opsPercentile}   stat="OPS" />
        <PercentileBar label="K%"   value={stats.kPctPercentile}  stat="K%" />
        <PercentileBar label="BB%"  value={stats.bbPctPercentile} stat="BB%" />
        <div className="pt-2 border-t border-538-border flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-widest text-538-muted">Overall</span>
          <div className="flex-1 h-3 rounded-full bg-538-border overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${stats.overallPercentile}%`,
                backgroundColor: stats.overallPercentile >= 50 ? '#B20D30' : '#3D405B',
              }}
            />
          </div>
          <span className="text-sm font-black tabular-nums" style={{ color: stats.overallPercentile >= 50 ? '#B20D30' : '#3D405B' }}>
            {stats.overallPercentile}th pct.
          </span>
        </div>
      </div>

      {/* Article body */}
      <div className="space-y-4">
        {body.map((para, i) => (
          <p key={i} className="text-538-text leading-relaxed text-sm">
            {para}
          </p>
        ))}
      </div>

      {/* Player table */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-538-muted mb-3">
          Active Roster — Qualified Hitters
        </h3>
        <div className="bg-surface border border-538-border rounded-xl p-4">
          <BatterTable players={teamPlayers} />
        </div>
      </div>
    </div>
  )
}
