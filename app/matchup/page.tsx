import { getPitcherArsenal, getBatterVsPitch } from '../../lib/data'
import MatchupTool from '../../components/MatchupTool'
import YearSelector from '../../components/YearSelector'
import { Suspense } from 'react'

export const metadata = { title: 'Matchup Lab | Samalytics MLB Engine' }

export default function MatchupPage({ searchParams }: { searchParams: { year?: string } }) {
  const year = searchParams.year
  const pitchers = getPitcherArsenal(year)
  const batters = getBatterVsPitch(year)

  return (
    <main className="max-w-screen-xl mx-auto px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-538-text tracking-tight">Matchup Lab</h1>
          <p className="text-sm text-538-muted mt-1">
            Select a pitcher and batter to compare pitch arsenal vs performance by pitch type.
          </p>
        </div>
        <Suspense>
          <YearSelector selectedYear={year} />
        </Suspense>
      </div>

      {pitchers.length === 0 && batters.length === 0 ? (
        <p className="text-538-muted text-sm py-8">No Statcast data yet for this season — check back once games have been played.</p>
      ) : (
        <MatchupTool pitchers={pitchers} batters={batters} />
      )}
    </main>
  )
}
