import { getRatingsHistory, getStandings } from '@/lib/data'
import EloHistoryChart from '@/components/EloHistoryChart'

export const dynamic = 'force-dynamic'

export default function RatingsPage() {
  const history = getRatingsHistory()
  const standings = getStandings()

  // Pre-compute top 8 teams by final rating for default selection
  const finalRatings = Object.entries(history).map(([abbr, entries]) => ({
    abbr,
    rating: entries.at(-1)?.rating ?? 1500,
  }))
  finalRatings.sort((a, b) => b.rating - a.rating)

  const topTeams = finalRatings.slice(0, 8).map(t => t.abbr)
  const allTeams = finalRatings.map(t => t.abbr)

  // Date range for subtitle
  const allDates = Object.values(history)
    .flatMap(entries => entries.map(e => e.date))
    .sort()
  const startDate = allDates[0] ?? '—'
  const endDate   = allDates.at(-1) ?? '—'

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-black tracking-tight text-538-text">ELO Ratings History</h1>
        <p className="text-xs text-538-muted mt-0.5">
          {startDate} — {endDate} · K=20 · Home field advantage = +35
        </p>
      </div>

      <EloHistoryChart history={history} topTeams={topTeams} allTeams={allTeams} />
    </div>
  )
}
