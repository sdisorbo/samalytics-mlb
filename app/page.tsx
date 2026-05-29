import Link from 'next/link'
import { getStandings, getPitchers, getPlayers } from '@/lib/data'
import {
  getTeamPitchingStats,
  getTeamBattingStats,
  pitchingHeadline,
  pitchingBlurb,
  battingHeadline,
  battingBlurb,
} from '@/lib/articleUtils'
import type { TeamStanding } from '@/lib/types'
import CloseGamesWidget from '@/components/home/CloseGamesWidget'
import PitcherSpotlight from '@/components/PitcherSpotlight'

// All 30 MLB team abbreviations in a stable order
const MLB_ABBRS = [
  'ARI', 'ATL', 'BAL', 'BOS', 'CHC', 'CWS', 'CIN', 'CLE', 'COL', 'DET',
  'HOU', 'KC',  'LAA', 'LAD', 'MIA', 'MIL', 'MIN', 'NYM', 'NYY', 'OAK',
  'PHI', 'PIT', 'SD',  'SEA', 'SF',  'STL', 'TB',  'TEX', 'TOR', 'WSH',
]

function logoUrl(abbr: string): string {
  return `https://a.espncdn.com/i/teamlogos/mlb/500/${abbr.toLowerCase()}.png`
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

function shortDate(): string {
  return new Date().toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

// ── Article Card ─────────────────────────────────────────────────────────────

interface ArticleCardProps {
  category: string
  categoryColor: string // hex or tailwind
  teamAbbr: string
  teamName: string
  headline: string
  blurb: string
  href: string
  size?: 'large' | 'medium'
}

function ArticleCard({
  category,
  categoryColor,
  teamAbbr,
  teamName,
  headline,
  blurb,
  href,
  size = 'medium',
}: ArticleCardProps) {
  return (
    <Link
      href={href}
      className="group flex flex-col bg-surface border border-538-border rounded-xl shadow-sm hover:shadow-md transition-shadow overflow-hidden h-full"
    >
      {/* Top colored border */}
      <div className="h-1 w-full shrink-0" style={{ backgroundColor: categoryColor }} />

      <div className="flex flex-col flex-1 p-4 gap-3">
        {/* Category badge */}
        <div className="flex items-center justify-between">
          <span
            className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-white"
            style={{ backgroundColor: categoryColor }}
          >
            {category}
          </span>
          <span className="text-[11px] text-538-muted">{shortDate()}</span>
        </div>

        {/* Team identity */}
        <div className="flex items-center gap-2">
          <img
            src={logoUrl(teamAbbr)}
            alt={teamAbbr}
            width={size === 'large' ? 24 : 20}
            height={size === 'large' ? 24 : 20}
            className="object-contain"
          />
          <span className="text-xs font-semibold text-538-muted uppercase tracking-wider">
            {teamName}
          </span>
        </div>

        {/* Headline */}
        <h2
          className={`font-bold text-538-text leading-snug group-hover:text-538-orange transition-colors ${
            size === 'large' ? 'text-xl' : 'text-base'
          }`}
        >
          {headline}
        </h2>

        {/* Blurb */}
        <p className="text-sm text-538-muted leading-relaxed flex-1">{blurb}</p>

        {/* CTA */}
        <div className="text-xs font-semibold text-538-orange group-hover:underline mt-auto pt-1">
          Read Analysis →
        </div>
      </div>
    </Link>
  )
}

// ── ELO Movers Widget ────────────────────────────────────────────────────────

function EloMoversWidget({ standings }: { standings: TeamStanding[] }) {
  const sorted = [...standings].sort((a, b) => b.elo_change_7d - a.elo_change_7d)
  const risers = sorted.slice(0, 3)
  const fallers = sorted.slice(-3).reverse()

  function Row({ team, highlight }: { team: TeamStanding; highlight: 'up' | 'down' }) {
    const isUp = highlight === 'up'
    return (
      <div className="flex items-center gap-2 py-1.5 border-b border-538-border last:border-0">
        <img
          src={logoUrl(team.team_abbr)}
          alt={team.team_abbr}
          width={20}
          height={20}
          className="object-contain shrink-0"
        />
        <span className="text-sm font-semibold text-538-text flex-1">{team.team_abbr}</span>
        <span className={`text-xs font-bold tabular-nums ${isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
          {isUp ? '+' : ''}{team.elo_change_7d.toFixed(1)}
        </span>
      </div>
    )
  }

  return (
    <div className="bg-surface border border-538-border rounded-xl shadow-sm overflow-hidden h-full flex flex-col">
      <div className="h-1 w-full shrink-0" style={{ backgroundColor: '#D97706' }} />
      <div className="p-4 flex flex-col flex-1">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: '#D97706' }}>
            ELO Movers
          </span>
          <span className="text-[11px] text-538-muted">7-day change</span>
        </div>

        <div className="mb-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mb-1">Rising</div>
          {risers.map((t) => <Row key={t.team_abbr} team={t} highlight="up" />)}
        </div>

        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-rose-600 dark:text-rose-400 mb-1 mt-2">Falling</div>
          {fallers.map((t) => <Row key={t.team_abbr} team={t} highlight="down" />)}
        </div>

        <div className="mt-auto pt-3">
          <Link href="/ratings" className="text-xs font-semibold text-538-orange hover:underline">
            Full ELO Ratings →
          </Link>
        </div>
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function HomePage() {
  const dayIdx = Math.floor(Date.now() / 86400000)
  const pitchingAbbr = MLB_ABBRS[dayIdx % MLB_ABBRS.length]
  const battingAbbr  = MLB_ABBRS[(dayIdx + 15) % MLB_ABBRS.length]

  let standings: TeamStanding[] = []
  let pitchingStats = null
  let battingStats  = null

  try {
    standings = getStandings()
    const pitchers = getPitchers()
    const players  = getPlayers()
    pitchingStats  = getTeamPitchingStats(pitchingAbbr, pitchers)
    battingStats   = getTeamBattingStats(battingAbbr, players)
  } catch {
    // data files unavailable — render gracefully
  }

  const pitchTeamName = pitchingStats?.teamName ?? pitchingAbbr
  const battTeamName  = battingStats?.teamName  ?? battingAbbr

  return (
    <div className="space-y-8">
      {/* Section 1 — Header strip */}
      <div className="border-b border-538-border pb-4">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <h1 className="font-orbitron font-black text-2xl tracking-wider text-538-orange uppercase">
              MLB Intel
            </h1>
            <p className="text-sm text-538-muted mt-0.5">
              Today&apos;s analysis, trends, and game previews
            </p>
          </div>
          <span className="text-sm text-538-muted font-medium mt-1">{formatDate()}</span>
        </div>
      </div>

      {/* Section 2 — Top row: 3 columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-stretch">
        {/* Col A — Pitching article (large) */}
        <div className="md:col-span-1">
          {pitchingStats ? (
            <ArticleCard
              category="Pitching Analysis"
              categoryColor="#3D405B"
              teamAbbr={pitchingAbbr}
              teamName={pitchTeamName}
              headline={pitchingHeadline(pitchTeamName, pitchingStats)}
              blurb={pitchingBlurb(pitchTeamName, pitchingStats)}
              href={`/analysis/pitching/${pitchingAbbr}`}
              size="large"
            />
          ) : (
            <div className="bg-surface border border-538-border rounded-xl p-6 text-538-muted text-sm flex items-center justify-center h-full">
              Pitching data unavailable
            </div>
          )}
        </div>

        {/* Col B — Batting article (medium) */}
        <div className="md:col-span-1">
          {battingStats ? (
            <ArticleCard
              category="Batting Analysis"
              categoryColor="#B20D30"
              teamAbbr={battingAbbr}
              teamName={battTeamName}
              headline={battingHeadline(battTeamName, battingStats)}
              blurb={battingBlurb(battTeamName, battingStats)}
              href={`/analysis/batting/${battingAbbr}`}
              size="medium"
            />
          ) : (
            <div className="bg-surface border border-538-border rounded-xl p-6 text-538-muted text-sm flex items-center justify-center h-full">
              Batting data unavailable
            </div>
          )}
        </div>

        {/* Col C — ELO Movers */}
        <div className="md:col-span-1">
          {standings.length > 0 ? (
            <EloMoversWidget standings={standings} />
          ) : (
            <div className="bg-surface border border-538-border rounded-xl p-6 text-538-muted text-sm flex items-center justify-center h-full">
              Standings data unavailable
            </div>
          )}
        </div>
      </div>

      {/* Section 3 — Pitcher Spotlight */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-538-muted">
            Last Night&apos;s Best Start
          </h2>
          <div className="flex-1 h-px bg-538-border" />
        </div>
        <PitcherSpotlight />
      </div>

      {/* Section 4 — Close Games */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-538-muted">
            Most Competitive Games Today
          </h2>
          <div className="flex-1 h-px bg-538-border" />
          <span className="text-[11px] text-538-muted">Closest win probability</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <CloseGamesWidget />
        </div>
      </div>
    </div>
  )
}
