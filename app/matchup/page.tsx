import { getPitcherArsenal, getBatterVsPitch, getPitchers, getPlayers } from '../../lib/data'
import MatchupTool from '../../components/MatchupTool'
import LiveAtBat from '../../components/LiveAtBat'
import YearSelector from '../../components/YearSelector'
import { Suspense } from 'react'

export const metadata = { title: 'Pitch Lab | Samalytics MLB Engine' }

export default function MatchupPage({ searchParams }: { searchParams: { year?: string } }) {
  const year = searchParams.year
  const pitcherArsenal = getPitcherArsenal(year)
  const batters = getBatterVsPitch(year)
  const pitchers = getPitchers(year)
  const players = getPlayers(year)

  const arsenalIds = new Set(pitcherArsenal.map((a) => a.player_id))
  const splitIds = new Set(batters.map((b) => b.player_id))
  const pitchersFiltered = pitchers.filter((p) => arsenalIds.has(p.player_id))
  const battersFiltered = players.filter((p) => splitIds.has(p.player_id))

  return (
    <main className="max-w-screen-xl mx-auto px-4 py-8 space-y-12">
      {/* ── Pitch Lab (matchup tool) ── */}
      <section>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-538-text tracking-tight">Pitch Lab</h1>
            <p className="text-sm text-538-muted mt-1">
              Select a pitcher and batter to compare pitch arsenal vs performance by pitch type.
            </p>
          </div>
          <Suspense>
            <YearSelector selectedYear={year} />
          </Suspense>
        </div>

        {pitcherArsenal.length === 0 && batters.length === 0 ? (
          <p className="text-538-muted text-sm py-8">No Statcast data yet for this season — check back once games have been played.</p>
        ) : (
          <MatchupTool pitchers={pitcherArsenal} batters={batters} />
        )}
      </section>

      {/* ── Live At Bat ── */}
      <section>
        <div className="mb-6">
          <h2 className="text-2xl font-black text-538-text tracking-tight">Live At Bat</h2>
          <p className="text-sm text-538-muted mt-1">
            Track a live count and see what the pitcher is most likely to throw — and how the at-bat is projected to end.
          </p>
        </div>

        {pitcherArsenal.length === 0 ? (
          <p className="text-538-muted text-sm py-8">No Statcast data yet for this season — check back once games have been played.</p>
        ) : (
          <LiveAtBat
            pitchers={pitchersFiltered}
            batters={battersFiltered}
            arsenal={pitcherArsenal}
            batterVsPitch={batters}
          />
        )}
      </section>
    </main>
  )
}
