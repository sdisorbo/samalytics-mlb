import { getPlayers } from '@/lib/data'
import PlayerList from '@/components/PlayerList'

export const dynamic = 'force-dynamic'

export default function PlayersPage() {
  const players = getPlayers()
  const allTeams = [...new Set(players.map(p => p.team))].sort()

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-black tracking-tight text-538-text">Player Percentiles</h1>
        <p className="text-xs text-538-muted mt-0.5">
          {players.length} qualified batters · percentile ranks vs. the full league
        </p>
      </div>

      <PlayerList players={players} allTeams={allTeams} />

      <div className="mt-6 text-xs text-538-muted max-w-xl space-y-1">
        <p>
          Percentile bars show each player&apos;s rank within the qualified batter pool (0 = worst, 100 = best).
          <span className="inline-block w-3 h-2 rounded ml-2 mr-1 align-middle" style={{ backgroundColor: '#27AE60' }} />≥70
          <span className="inline-block w-3 h-2 rounded ml-2 mr-1 align-middle" style={{ backgroundColor: '#F39C12' }} />40–69
          <span className="inline-block w-3 h-2 rounded ml-2 mr-1 align-middle" style={{ backgroundColor: '#E74C3C' }} />&lt;40
        </p>
        <p className="text-538-muted italic">
          Statcast fields (exit velocity, barrel%, xBA, etc.) require Baseball Savant integration — coming soon.
        </p>
      </div>
    </div>
  )
}
