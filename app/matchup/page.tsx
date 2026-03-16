import { getPitcherArsenal, getBatterVsPitch } from '../../lib/data'
import MatchupTool from '../../components/MatchupTool'

export const metadata = { title: 'Matchup Lab | Samalytics MLB Engine' }

export default function MatchupPage() {
  const pitchers = getPitcherArsenal()
  const batters = getBatterVsPitch()

  return (
    <main className="max-w-screen-xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-538-text tracking-tight">Matchup Lab</h1>
        <p className="text-sm text-538-muted mt-1">
          Select a pitcher and batter to compare pitch arsenal vs performance by pitch type.
        </p>
      </div>
      <MatchupTool pitchers={pitchers} batters={batters} />
    </main>
  )
}
