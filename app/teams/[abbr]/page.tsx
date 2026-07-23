import { getStandings, getRatingsHistory, getPlayerWar, getTeamGameLogs } from '@/lib/data'
import TeamPage from '@/components/TeamPage'

// Baseball Reference uses different abbreviations than the standings data
const BREF_ABBR: Record<string, string> = {
  AZ:  'ARI',
  KC:  'KCR',
  CWS: 'CHW',
  SD:  'SDP',
  SF:  'SFG',
  TB:  'TBR',
  WSH: 'WSN',
}

export default function TeamsRoute({ params }: { params: { abbr: string } }) {
  const abbr = params.abbr.toUpperCase()
  const standings = getStandings()
  const standing = standings.find(s => s.team_abbr === abbr)
  if (!standing) return <div className="p-8 text-538-muted">Team not found: {abbr}</div>

  const history = getRatingsHistory()
  const teamHistory = history[abbr] ?? []

  const brefAbbr = BREF_ABBR[abbr] ?? abbr
  const allPlayerWar = getPlayerWar()
  const teamPlayerWar = allPlayerWar.filter(p => p.team === abbr || p.team === brefAbbr)

  const allLogs = getTeamGameLogs()
  const teamLogs = allLogs.filter(l => l.team === abbr || l.team === brefAbbr)

  return (
    <TeamPage
      standing={standing}
      teamHistory={teamHistory}
      allHistory={history}
      teamPlayerWar={teamPlayerWar}
      allPlayerWar={allPlayerWar}
      teamLogs={teamLogs}
    />
  )
}
