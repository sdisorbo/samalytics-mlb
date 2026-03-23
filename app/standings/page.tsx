import { getStandings, getPlayoffOdds } from '@/lib/data'
import StandingsTable from '@/components/StandingsTable'

export const dynamic = 'force-dynamic'

export default function StandingsPage() {
  const standings = getStandings()
  const odds = getPlayoffOdds()

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

      <StandingsTable standings={standings} />

      <div className="mt-4 text-xs text-538-muted space-y-1 max-w-2xl">
        <p><strong>ELO</strong> — team strength rating. League average = 1500. Higher is better.</p>
        <p><strong>Δ7d</strong> — ELO change over the past 7 days.</p>
        <p><strong>Playoff%</strong> — probability of clinching any of the 12 playoff spots.</p>
        <p><strong>Win DS/CS/WS</strong> — fraction of {100} playoff simulations in which the team won that round.</p>
      </div>
    </div>
  )
}
