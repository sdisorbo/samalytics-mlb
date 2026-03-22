import { getPitchers } from '@/lib/data'
import PitcherScatter from '@/components/PitcherScatter'
import YearSelector from '@/components/YearSelector'
import { Suspense } from 'react'

export const dynamic = 'force-dynamic'

export default function PitchersPage({ searchParams }: { searchParams: { year?: string } }) {
  const year = searchParams.year
  const pitchers = getPitchers(year)

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-black tracking-tight text-538-text">Pitcher Comparison</h1>
          <p className="text-xs text-538-muted mt-0.5">
            {pitchers.length} qualifying starters (min 20 IP) · FIP vs K/9
          </p>
        </div>
        <Suspense>
          <YearSelector selectedYear={year} />
        </Suspense>
      </div>

      {pitchers.length === 0 ? (
        <p className="text-538-muted text-sm py-8">No pitcher data yet for this season — check back once games have been played.</p>
      ) : (
        <PitcherScatter pitchers={pitchers} />
      )}

      <div className="mt-4 text-xs text-538-muted max-w-2xl space-y-1">
        <p>
          <strong>FIP</strong> — Fielding Independent Pitching. Isolates outcomes the pitcher controls
          (HR, BB, K). Lower is better. Formula: (13×HR + 3×BB − 2×K) / IP + 3.10.
        </p>
        <p><strong>K/9</strong> — strikeouts per 9 innings. Higher is better.</p>
        <p>Bubble size reflects innings pitched. Hover any dot for full stats.</p>
      </div>
    </div>
  )
}
