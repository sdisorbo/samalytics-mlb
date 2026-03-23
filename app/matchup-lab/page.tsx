import { getStandings, getPitchers, getPlayers, getPitcherArsenal } from '../../lib/data'
import MatchupLab from '../../components/MatchupLab'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Matchup Lab | Samalytics MLB Engine' }

export default function MatchupLabPage() {
  const standings = getStandings()

  // Prefer current-season data; fall back to 2025 if empty (early season)
  let pitchers = getPitchers()
  if (pitchers.length === 0) pitchers = getPitchers('2025')

  let players = getPlayers()
  if (players.length === 0) players = getPlayers('2025')

  let pitcherArsenals = getPitcherArsenal()
  if (pitcherArsenals.length === 0) pitcherArsenals = getPitcherArsenal('2025')

  return (
    <main className="max-w-screen-xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-538-text tracking-tight">Matchup Lab</h1>
        <p className="text-sm text-538-muted mt-1">
          Game simulator — model pitcher vs. lineup matchups with {100}-game Monte Carlo simulations.
          Pick a date to load today&apos;s slate, or select two teams to simulate any matchup.
        </p>
      </div>

      <MatchupLab
        standings={standings}
        pitchers={pitchers}
        players={players}
        pitcherArsenals={pitcherArsenals}
      />
    </main>
  )
}
