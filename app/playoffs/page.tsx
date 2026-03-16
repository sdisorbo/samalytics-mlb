import { getPlayoffOdds, getStandings } from '@/lib/data'
import PlayoffOddsChart from '@/components/PlayoffOddsChart'

export const dynamic = 'force-dynamic'

export default function PlayoffsPage() {
  const odds    = getPlayoffOdds()
  const standings = getStandings()

  const updated = new Date(odds.last_updated).toLocaleString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-black tracking-tight text-538-text">Playoff Odds</h1>
        <p className="text-xs text-538-muted mt-0.5">
          Based on {odds.simulations} simulated brackets · Last updated {updated}
        </p>
      </div>

      <PlayoffOddsChart results={odds.results} standings={standings} />

      <div className="mt-4 text-xs text-538-muted max-w-2xl space-y-1">
        <p><strong>Win WC</strong> — probability of winning the Wild Card round (WC teams only).</p>
        <p><strong>Win DS/CS/WS</strong> — probability of advancing past each playoff round.</p>
        <p>
          Each simulation draws the 12-team playoff field probabilistically based on current standings,
          then simulates every series game-by-game using ELO win probabilities.
        </p>
      </div>
    </div>
  )
}
