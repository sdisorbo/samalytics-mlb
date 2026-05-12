import { getPitchers, getPitcherArsenal } from '../../lib/data'
import PitchVisualizer from '../../components/PitchVisualizer'
import YearSelector from '../../components/YearSelector'
import { Suspense } from 'react'
import type { RankedPitch } from '../../lib/types'

export const metadata = { title: 'Pitch Visualizer | Samalytics MLB Engine' }

export default function PitchVisPage({
  searchParams,
}: {
  searchParams: { year?: string }
}) {
  const year = searchParams.year
  const pitchers = getPitchers(year)
  const arsenal = getPitcherArsenal(year)

  // Build leaderboard: pitcher ≥ 20 IP, pitch ≥ 5% usage, sort by RV/100 asc.
  const pitcherById = new Map(pitchers.map((p) => [p.player_id, p]))
  const ranked: RankedPitch[] = []
  for (const p of arsenal) {
    const pitcher = pitcherById.get(p.player_id)
    if (!pitcher || (pitcher.innings_pitched ?? 0) < 20) continue
    for (const pitch of p.pitches) {
      if ((pitch.usage_pct ?? 0) < 5) continue
      if (pitch.run_value_per_100 === null) continue
      ranked.push({
        pitcher_id: p.player_id,
        pitcher_name: p.name,
        team: p.team,
        pitch_type: pitch.pitch_type,
        pitch_name: pitch.pitch_name,
        usage_pct: pitch.usage_pct ?? 0,
        whiff_pct: pitch.whiff_pct,
        woba_against: pitch.woba_against,
        xwoba_against: pitch.xwoba_against,
        hard_hit_pct: pitch.hard_hit_pct,
        run_value_per_100: pitch.run_value_per_100,
        avg_speed: pitch.avg_speed,
        break_x: pitch.break_x,
        break_z: pitch.break_z,
      })
    }
  }
  // Lower RV/100 is better for the pitcher.
  ranked.sort((a, b) => (a.run_value_per_100 ?? 0) - (b.run_value_per_100 ?? 0))
  const top = ranked.slice(0, 30)

  return (
    <main className="max-w-screen-xl mx-auto px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-538-text tracking-tight">Pitch Visualizer</h1>
          <p className="text-sm text-538-muted mt-1">
            Pick a pitch from the league&apos;s best — or search a pitcher — then click the strike
            zone to see the pitch animate from the pitcher&apos;s release point to where it crosses
            the plate, in 3D from the batter&apos;s POV.
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
        <PitchVisualizer ranked={top} arsenal={arsenal} pitchers={pitchers} />
      )}
    </main>
  )
}
