import { getStandings, getPlayoffOdds, getTeamWar } from '@/lib/data'
import StandingsTable from '@/components/StandingsTable'

export const dynamic = 'force-dynamic'

export default function StandingsPage() {
  const standings = getStandings()
  const odds = getPlayoffOdds()
  const teamWar = getTeamWar()

  // last_updated is set by the pipeline at run time (10 AM ET = 2 PM UTC, always same calendar day)
  const lastUpdated = odds.last_updated
    ? new Date(odds.last_updated + 'Z').toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric',
        timeZone: 'America/New_York',
      })
    : '—'

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-black tracking-tight text-538-text">MLB Standings & ELO Ratings</h1>
        <p className="text-xs text-538-muted mt-0.5">
          ELO ratings updated through {lastUpdated} · {standings.length} teams
        </p>
      </div>

      <StandingsTable standings={standings} teamWar={teamWar} />

      <div className="mt-4 text-xs text-538-muted space-y-1 max-w-2xl">
        <p><strong>ELO</strong> — team strength rating based on game-by-game results. League average = 1500.</p>
        <p><strong>WAR</strong> — total Wins Above Replacement for current roster (bWAR via Baseball Reference). Reflects post-trade-deadline rosters.</p>
        <p><strong>WAR-Adj ELO</strong> — blends ELO (65%) with a WAR-based talent rating (35%). Surfaces teams whose player talent diverges from their game results.</p>
        <p><strong>Δ7d</strong> — ELO change over the past 7 days.</p>
        <p><strong>Playoff%</strong> — probability of clinching any of the 12 playoff spots.</p>
        <p><strong>Win DS/CS/WS</strong> — fraction of {100} playoff simulations in which the team won that round.</p>
      </div>
    </div>
  )
}
