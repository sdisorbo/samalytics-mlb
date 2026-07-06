import { getPlayerWar, getLegendWar, getPlayers } from '../../lib/data'
import PlayerWarTable from '../../components/PlayerWarTable'
import type { PlayerWarWithPos } from '../../components/PlayerWarTable'

export const metadata = { title: 'Player WAR | Samalytics MLB Engine' }

export default function WarPage() {
  const raw      = getPlayerWar()
  const legendWar = getLegendWar()

  // Join position from players.json (keyed by MLB player_id)
  const mlbPlayers = getPlayers()
  const posMap = new Map(mlbPlayers.map((p) => [p.player_id, p.position]))

  const players: PlayerWarWithPos[] = raw.map((p) => ({
    ...p,
    position: p.player_id != null ? (posMap.get(p.player_id) ?? undefined) : undefined,
  }))

  return (
    <main className="max-w-screen-xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-538-text tracking-tight">Player WAR</h1>
        <p className="text-sm text-538-muted mt-1">
          2025 Wins Above Replacement — offensive, defensive, and total — for all qualified batters (50+ PA).
          Click any player to compare their season against historical legends.
        </p>
      </div>

      {players.length === 0 ? (
        <p className="text-538-muted text-sm py-8">
          No WAR data available — run the pipeline to populate.
        </p>
      ) : (
        <PlayerWarTable players={players} legendWar={legendWar} />
      )}
    </main>
  )
}
