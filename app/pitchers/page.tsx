import { getPitchers } from '@/lib/data'
import PitcherScatter from '@/components/PitcherScatter'
import YearSelector from '@/components/YearSelector'
import PitcherLookup from '@/components/PitcherLookup'
import PitcherSeasonLookup from '@/components/PitcherSeasonLookup'
import { Suspense } from 'react'

export const dynamic = 'force-dynamic'

export default function PitchersPage({ searchParams }: { searchParams: { year?: string } }) {
  const year = searchParams.year
  const pitchers = getPitchers(year)

  return (
    <div className="space-y-10">
      {/* Section 0 — Season Zone Breakdown */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-538-muted">
            Season Zone Breakdown
          </h2>
          <div className="flex-1 h-px bg-538-border" />
        </div>
        <Suspense>
          <PitcherSeasonLookup />
        </Suspense>
      </div>

      {/* Section 1 — Pitcher Lookup */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-538-muted">
            Game Breakdown
          </h2>
          <div className="flex-1 h-px bg-538-border" />
        </div>
        <PitcherLookup />
      </div>

      {/* Section 2 — Season scatter */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-538-muted">
            Pitcher Comparison
          </h2>
          <div className="flex-1 h-px bg-538-border" />
          <Suspense>
            <YearSelector selectedYear={year} />
          </Suspense>
        </div>

        <p className="text-xs text-538-muted mb-4">
          {pitchers.length} qualifying starters (min 20 IP) · FIP vs K/9
        </p>

        {pitchers.length === 0 ? (
          <p className="text-538-muted text-sm py-8">No pitcher data yet for this season — check back once games have been played.</p>
        ) : (
          <PitcherScatter pitchers={pitchers} />
        )}

        <div className="mt-4 text-xs text-538-muted max-w-2xl space-y-1">
          <p><strong>FIP</strong> — Fielding Independent Pitching. Isolates outcomes the pitcher controls (HR, BB, K). Lower is better. Formula: (13×HR + 3×BB − 2×K) / IP + 3.10.</p>
          <p><strong>K/9</strong> — strikeouts per 9 innings. Higher is better.</p>
          <p>Bubble size reflects innings pitched. Hover any dot for full stats.</p>
        </div>
      </div>
    </div>
  )
}
