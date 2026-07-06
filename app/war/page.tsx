import { getPlayerWar, getLegendWar } from '../../lib/data'
import PlayerWarTable from '../../components/PlayerWarTable'

export const metadata = { title: 'Player WAR | Samalytics MLB Engine' }

export default function WarPage() {
  const players = getPlayerWar()
  const legendWar = getLegendWar()

  return (
    <main className="max-w-screen-xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-538-text tracking-tight">Player WAR</h1>
        <p className="text-sm text-538-muted mt-1">
          2025 Wins Above Replacement — offensive, defensive, and total — for all qualified batters (50+ PA).
          Click any player to compare against historical legends.
        </p>
      </div>

      {players.length === 0 ? (
        <p className="text-538-muted text-sm py-8">No WAR data available yet — run the pipeline to populate.</p>
      ) : (
        <PlayerWarTable players={players} legendWar={legendWar} />
      )}
    </main>
  )
}
