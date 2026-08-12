import { getPlayers } from '@/lib/data'
import PlayerList from '@/components/PlayerList'
import YearSelector from '@/components/YearSelector'
import { Suspense } from 'react'

export const dynamic = 'force-dynamic'

export default function PlayersPage({ searchParams }: { searchParams: { year?: string } }) {
  const year = searchParams.year
  const players = getPlayers(year)
  const allTeams = [...new Set(players.map(p => p.team))].sort()

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-black tracking-tight text-538-text">Batter Percentiles</h1>
          <p className="text-xs text-538-muted mt-0.5">
            {players.length} qualified batters · percentile ranks vs. the full league
          </p>
        </div>
        <Suspense>
          <YearSelector selectedYear={year} />
        </Suspense>
      </div>

      {players.length === 0 ? (
        <p className="text-538-muted text-sm py-8">No player data yet for this season — check back once games have been played.</p>
      ) : (
        <PlayerList players={players} allTeams={allTeams} />
      )}

      <div className="mt-6 text-xs text-538-muted max-w-xl space-y-1">
        <p>
          Percentile bars show each batter&apos;s rank within the qualified pool (0 = worst, 100 = best).
          <span className="inline-block w-3 h-2 rounded ml-2 mr-1 align-middle" style={{ backgroundColor: '#3C999E' }} />High
          <span className="inline-block w-3 h-2 rounded ml-2 mr-1 align-middle" style={{ backgroundColor: '#9B405A' }} />Low
        </p>
        <p className="text-538-muted italic">
          Statcast fields (exit velocity, barrel%, xBA, etc.) require Baseball Savant integration — coming soon.
        </p>
      </div>
    </div>
  )
}
