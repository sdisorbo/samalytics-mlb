import { getTeamGameLogs } from '../../lib/data'
import type { TeamGameLog } from '../../lib/types'
import TeamPerformance from '../../components/TeamPerformance'

export const metadata = { title: 'Team Performance | Samalytics MLB Engine' }

export default function TeamPerformancePage() {
  let logs: TeamGameLog[] = []
  try {
    logs = getTeamGameLogs()
  } catch {
    // team_game_logs.json not yet generated — show empty state
  }

  return (
    <main className="max-w-screen-xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-538-text tracking-tight">Team Offensive Performance</h1>
        <p className="text-sm text-538-muted mt-1">
          Rolling run value (RV) by game — how much each team's lineup contributed above/below expectation,
          vs. actual runs scored. Hover a game bar to see individual batter breakdowns.
        </p>
      </div>

      {logs.length === 0 ? (
        <div className="border border-538-border rounded bg-surface p-8 text-center text-538-muted text-sm">
          <div className="font-bold text-538-text mb-2">No data yet</div>
          <div>Run <code className="bg-538-border/30 px-1 py-0.5 rounded text-xs">python src/main.py</code> to generate team_game_logs.json</div>
        </div>
      ) : (
        <TeamPerformance logs={logs} />
      )}
    </main>
  )
}
