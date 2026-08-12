import { getPlayerWar, getLegendWar, getPlayers } from '../../lib/data'
import PlayerWarTable from '../../components/PlayerWarTable'
import type { PlayerWarWithPos } from '../../components/PlayerWarTable'

export const dynamic  = 'force-dynamic'
export const metadata = { title: 'Player WAR | Samalytics MLB Engine' }

export default function WarPage() {
  let players: PlayerWarWithPos[] = []
  let legendWar: Record<string, Array<{ year: number; war: number; off_war: number; def_war: number }>> = {}
  let loadError: string | null = null

  try {
    const raw       = getPlayerWar()
    legendWar       = getLegendWar()
    const mlbPlayers = getPlayers()
    const posMap    = new Map(mlbPlayers.map((p) => [p.player_id, p.position]))

    players = raw.map((p) => ({
      ...p,
      position: p.player_id != null ? (posMap.get(p.player_id) ?? undefined) : undefined,
    }))
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err)
  }

  return (
    <main className="max-w-screen-xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-538-text tracking-tight">Player WAR</h1>
        <p className="text-sm text-538-muted mt-1">
          Wins Above Replacement — offensive, defensive, and total — for all qualified batters (50+ PA).
          Click any player to compare their season against historical legends.
        </p>
      </div>

      {loadError ? (
        <div className="py-8 text-sm text-538-muted">
          <p className="font-semibold text-red-500 mb-1">Could not load WAR data</p>
          <pre className="text-xs bg-gray-100 rounded p-3 whitespace-pre-wrap">{loadError}</pre>
          <p className="mt-2">Run <code className="bg-gray-100 px-1 rounded">python src/main.py</code> to regenerate.</p>
        </div>
      ) : players.length === 0 ? (
        <p className="text-538-muted text-sm py-8">
          No WAR data — run the pipeline to populate.
        </p>
      ) : (
        <PlayerWarTable players={players} legendWar={legendWar} />
      )}
    </main>
  )
}
