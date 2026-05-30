import { NextResponse } from 'next/server'
import {
  fetchGameBreakdown,
  computeGameScore,
  ipToDecimal,
} from '../../../lib/pitcherGame'

const MLB_API = 'https://statsapi.mlb.com/api/v1'

export async function GET() {
  try {
    const now = new Date()
    // Use Eastern time so the date doesn't flip at midnight UTC (7–8 PM ET)
    const dateStr     = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
    dateStr.setDate(dateStr.getDate() - 1)
    const etYesterday = dateStr
    const dateStrFmt  = etYesterday.toLocaleDateString('en-CA')
    const dateDisplay = etYesterday.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })

    const schedRes = await fetch(
      `${MLB_API}/schedule?sportId=1&date=${dateStrFmt}&hydrate=team,linescore`,
      { next: { revalidate: 3600 } },
    )
    if (!schedRes.ok) return NextResponse.json(null)
    const schedData = await schedRes.json()
    const games = schedData.dates?.[0]?.games ?? []
    if (!games.length) return NextResponse.json(null)

    // Collect qualifying starts
    const candidates: {
      gamePk: number
      pitcherId: number
      pitcherName: string
      teamAbbr: string
      opponentAbbr: string
      ipDisplay: string
      ks: number
      bbs: number
      hits: number
      er: number
      r: number
      pitchCount: number
      homeRuns: number
      battersFaced: number
      gameScore: number
      gameResult: string
    }[] = []

    for (const game of games) {
      if (game.status?.abstractGameState !== 'Final') continue
      try {
        const bsRes = await fetch(`${MLB_API}/game/${game.gamePk}/boxscore`, { next: { revalidate: 3600 } })
        if (!bsRes.ok) continue
        const bs = await bsRes.json()

        for (const side of ['away', 'home'] as const) {
          const team        = bs.teams[side]
          const pitcherIds: number[] = team.pitchers ?? []
          if (!pitcherIds.length) continue

          const starterId   = pitcherIds[0]
          const starterData = team.players?.[`ID${starterId}`]
          if (!starterData) continue

          const stats = starterData.stats?.pitching
          if (!stats) continue

          const ip = ipToDecimal(stats.inningsPitched ?? '0.0')
          if (ip < 4) continue

          const ks  = stats.strikeOuts  ?? 0
          const bbs = stats.baseOnBalls ?? 0
          const hits = stats.hits       ?? 0
          const er  = stats.earnedRuns  ?? 0
          const r   = stats.runs        ?? 0

          const oppSide     = side === 'away' ? 'home' : 'away'
          const teamAbbr    = (team.team?.abbreviation ?? '').toUpperCase()
          const opponentAbbr = (bs.teams[oppSide]?.team?.abbreviation ?? '').toUpperCase()

          const myScore  = side === 'away' ? (bs.teams.away?.teamStats?.batting?.runs ?? 0) : (bs.teams.home?.teamStats?.batting?.runs ?? 0)
          const oppScore = side === 'away' ? (bs.teams.home?.teamStats?.batting?.runs ?? 0) : (bs.teams.away?.teamStats?.batting?.runs ?? 0)
          const gameResult = myScore > oppScore ? `W ${myScore}-${oppScore}` : `L ${myScore}-${oppScore}`

          candidates.push({
            gamePk: game.gamePk,
            pitcherId: starterId,
            pitcherName: starterData.person?.fullName ?? 'Unknown',
            teamAbbr, opponentAbbr,
            ipDisplay: stats.inningsPitched ?? '0.0',
            ks, bbs, hits, er, r,
            pitchCount:   stats.numberOfPitches ?? 0,
            homeRuns:     stats.homeRuns        ?? 0,
            battersFaced: stats.battersFaced    ?? 0,
            gameScore: computeGameScore(ip, ks, hits, bbs, er, r),
            gameResult,
          })
        }
      } catch { continue }
    }

    if (!candidates.length) return NextResponse.json(null)
    const best = candidates.sort((a, b) => b.gameScore - a.gameScore)[0]

    const breakdown = await fetchGameBreakdown(
      best.gamePk, best.pitcherId, best.pitcherName,
      best.teamAbbr, best.opponentAbbr,
      best.ipDisplay, best.ks, best.bbs, best.hits, best.er, best.r,
      best.pitchCount, best.homeRuns, best.battersFaced,
      best.gameResult, dateDisplay, 3600,
    )

    return NextResponse.json(breakdown)
  } catch {
    return NextResponse.json(null)
  }
}

