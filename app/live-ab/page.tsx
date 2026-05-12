import {
  getPitchers,
  getPlayers,
  getPitcherArsenal,
  getBatterVsPitch,
} from '../../lib/data'
import LiveAtBat from '../../components/LiveAtBat'
import YearSelector from '../../components/YearSelector'
import { Suspense } from 'react'

export const metadata = { title: 'Live At Bat | Samalytics MLB Engine' }

export default function LiveAtBatPage({
  searchParams,
}: {
  searchParams: { year?: string }
}) {
  const year = searchParams.year
  const pitchers = getPitchers(year)
  const players = getPlayers(year)
  const arsenal = getPitcherArsenal(year)
  const batterVsPitch = getBatterVsPitch(year)

  // Only show pitchers/batters that have matching split data.
  const arsenalIds = new Set(arsenal.map((a) => a.player_id))
  const splitIds = new Set(batterVsPitch.map((b) => b.player_id))
  const pitchersFiltered = pitchers.filter((p) => arsenalIds.has(p.player_id))
  const battersFiltered = players.filter((p) => splitIds.has(p.player_id))

  return (
    <main className="max-w-screen-xl mx-auto px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-538-text tracking-tight">Live At Bat</h1>
          <p className="text-sm text-538-muted mt-1">
            Track a live count and see what the pitcher is most likely to throw — and how the at-bat is projected to end.
          </p>
        </div>
        <Suspense>
          <YearSelector selectedYear={year} />
        </Suspense>
      </div>

      {arsenal.length === 0 ? (
        <p className="text-538-muted text-sm py-8">
          No Statcast data yet for this season — check back once games have been played.
        </p>
      ) : (
        <LiveAtBat
          pitchers={pitchersFiltered}
          batters={battersFiltered}
          arsenal={arsenal}
          batterVsPitch={batterVsPitch}
        />
      )}
    </main>
  )
}
