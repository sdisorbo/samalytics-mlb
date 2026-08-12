import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPitchers } from '@/lib/data'
import {
  getTeamPitchingStats,
  pitchingHeadline,
  pitchingArticleBody,
  type TeamPitchingStats,
} from '@/lib/articleUtils'
import type { Pitcher } from '@/lib/types'

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
            backgroundColor: isStrong ? '#3D405B' : '#B20D30',
          }}
        />
      </div>
      <span className="w-8 text-xs font-bold tabular-nums text-right shrink-0" style={{ color: isStrong ? '#3D405B' : '#B20D30' }}>
        {value}
      </span>
      <span className="text-[10px] text-538-muted w-6 shrink-0">{stat}</span>
    </div>
  )
}

function PitcherTable({ pitchers }: { pitchers: Pitcher[] }) {
  const sorted = [...pitchers]
    .filter((p) => p.innings_pitched >= 10)
    .sort((a, b) => b.innings_pitched - a.innings_pitched)

  if (sorted.length === 0) {
    return <p className="text-538-muted text-sm">No qualified pitchers found (min 10 IP).</p>
  }

  return (
    <div className="table-scroll">
      <table className="data-table w-full">
        <thead>
          <tr>
            <th className="text-left">Name</th>
            <th className="text-right">IP</th>
            <th className="text-right">ERA</th>
            <th className="text-right">FIP</th>
            <th className="text-right">K/9</th>
            <th className="text-right">BB/9</th>
            <th className="text-right">WHIP</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.player_id}>
              <td className="font-semibold text-538-text">{p.name}</td>
              <td className="text-right tabular-nums">{p.innings_pitched.toFixed(1)}</td>
              <td className="text-right tabular-nums">{p.era != null ? p.era.toFixed(2) : '—'}</td>
              <td className="text-right tabular-nums">{p.fip != null ? p.fip.toFixed(2) : '—'}</td>
              <td className="text-right tabular-nums">{p.k_per_9.toFixed(1)}</td>
              <td className="text-right tabular-nums">{p.bb_per_9.toFixed(1)}</td>
              <td className="text-right tabular-nums">{p.whip != null ? p.whip.toFixed(2) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default async function PitchingArticlePage({ params }: Props) {
  const { team } = await params
  const abbr = team.toUpperCase()

  let pitchers: Pitcher[] = []
  let stats: TeamPitchingStats | null = null

  try {
    pitchers = getPitchers()
    stats    = getTeamPitchingStats(abbr, pitchers)
  } catch {
    // data unavailable
  }

  if (!stats) notFound()

  const teamPitchers = pitchers.filter((p) => p.team === abbr)
  const headline     = pitchingHeadline(stats.teamName, stats)
  const body         = pitchingArticleBody(stats.teamName, stats)

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {/* Back link */}
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-538-muted hover:text-538-text transition-colors">
        <span>←</span>
        <span>Back to Home</span>
      </Link>

      {/* Article header */}
      <div className="border-t-4 pt-4" style={{ borderColor: '#3D405B' }}>
        <div className="flex items-center gap-3 mb-2">
          <img
            src={logoUrl(abbr)}
            alt={abbr}
            width={48}
            height={48}
            className="object-contain"
          />
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-white inline-block mb-1" style={{ backgroundColor: '#3D405B' }}>
              Pitching Analysis
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
          Staff Percentile Rankings
        </h3>
        <PercentileBar label="ERA"  value={stats.eraPercentile}  stat="ERA" />
        <PercentileBar label="FIP"  value={stats.fipPercentile}  stat="FIP" />
        <PercentileBar label="K/9"  value={stats.k9Percentile}   stat="K/9" />
        <PercentileBar label="BB/9" value={stats.bb9Percentile}  stat="BB/9" />
        <PercentileBar label="WHIP" value={stats.whipPercentile} stat="WHIP" />
        <div className="pt-2 border-t border-538-border flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-widest text-538-muted">Overall</span>
          <div className="flex-1 h-3 rounded-full bg-538-border overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${stats.overallPercentile}%`,
                backgroundColor: stats.overallPercentile >= 50 ? '#3D405B' : '#B20D30',
              }}
            />
          </div>
          <span className="text-sm font-black tabular-nums" style={{ color: stats.overallPercentile >= 50 ? '#3D405B' : '#B20D30' }}>
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

      {/* Pitcher table */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-widest text-538-muted mb-3">
          Individual Pitchers (min. 10 IP)
        </h3>
        <div className="bg-surface border border-538-border rounded-xl p-4">
          <PitcherTable pitchers={teamPitchers} />
        </div>
      </div>
    </div>
  )
}
