import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface AbPitch {
  type: string; desc: string; code: string; result: string
  balls: number; strikes: number; speed: number | null
  pX: number | null; pZ: number | null
}

const PITCH_NAMES: Record<string, string> = {
  FF: '4-Seam FB', SI: 'Sinker', FC: 'Cutter', FT: '2-Seam FB',
  SL: 'Slider', ST: 'Sweeper', SV: 'Slurve', CU: 'Curveball',
  KC: 'Knuckle Curve', CH: 'Changeup', FS: 'Splitter',
  FO: 'Forkball', KN: 'Knuckleball', EP: 'Eephus', SW: 'Slow Curve',
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { gamePk: string } }
) {
  const { gamePk } = params

  try {
    const res = await fetch(
      `https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`,
      { cache: 'no-store' }
    )
    if (!res.ok) return NextResponse.json({ error: 'feed unavailable' }, { status: 502 })
    const feed = await res.json()

    const gd    = feed.gameData  as Record<string, unknown>
    const ld    = feed.liveData  as Record<string, unknown>
    const plays = (ld?.plays     as Record<string, unknown>)
    const linescore = (ld?.linescore as Record<string, unknown>) ?? {}

    const gameState: string = ((gd?.status as Record<string, string>)?.abstractGameState) ?? 'Preview'

    // Teams
    const awayTeam = ((gd?.teams as Record<string, unknown>)?.away as Record<string, unknown>)
    const homeTeam = ((gd?.teams as Record<string, unknown>)?.home as Record<string, unknown>)
    const awayAbbr = ((awayTeam?.abbreviation as string) ?? '').toUpperCase()
    const homeAbbr = ((homeTeam?.abbreviation as string) ?? '').toUpperCase()
    const awayName = (awayTeam?.teamName as string) ?? awayAbbr
    const homeName = (homeTeam?.teamName as string) ?? homeAbbr

    // Score + inning
    const awayScore  = (linescore.teams as Record<string, Record<string, number>>)?.away?.runs ?? null
    const homeScore  = (linescore.teams as Record<string, Record<string, number>>)?.home?.runs ?? null
    const inning     = (linescore.currentInning as number) ?? null
    const inningHalf = (linescore.inningHalf   as string) ?? null
    const outs       = (linescore.outs          as number) ?? 0

    // Base runners
    const onFirst  = !!((linescore.offense as Record<string, unknown>)?.first)
    const onSecond = !!((linescore.offense as Record<string, unknown>)?.second)
    const onThird  = !!((linescore.offense as Record<string, unknown>)?.third)

    // Current play
    const currentPlay = plays?.currentPlay as Record<string, unknown> | undefined
    const matchup     = (currentPlay?.matchup as Record<string, unknown>) ?? {}
    const count       = (currentPlay?.count   as Record<string, number>)  ?? {}

    const batter  = matchup.batter  as Record<string, unknown> | undefined
    const pitcher = matchup.pitcher as Record<string, unknown> | undefined

    const batterId    = (batter?.id   as number) ?? null
    const batterName  = (batter?.fullName  as string) ?? null
    const batterStand = ((matchup.batSide  as Record<string, string>)?.code) ?? 'R'

    const pitcherId   = (pitcher?.id   as number) ?? null
    const pitcherName = (pitcher?.fullName as string) ?? null
    const pitcherHand = ((matchup.pitchHand as Record<string, string>)?.code) ?? 'R'

    let batterTeam = '', pitcherTeam = ''
    if (inningHalf === 'Top')    { batterTeam = awayAbbr; pitcherTeam = homeAbbr }
    if (inningHalf === 'Bottom') { batterTeam = homeAbbr; pitcherTeam = awayAbbr }

    // Current AB pitch sequence
    const abPitches: AbPitch[] = []
    const playEvents = (currentPlay?.playEvents as Record<string, unknown>[]) ?? []
    for (const ev of playEvents) {
      if (!ev.isPitch) continue
      const details   = ev.details  as Record<string, unknown> | undefined
      const pitchData = ev.pitchData as Record<string, unknown> | undefined
      const afterCount = ev.count as Record<string, number> | undefined
      const ptCode    = (details?.type as Record<string, string>)?.code ?? ''
      const code      = (details?.code as string) ?? ''
      const descText  = (details?.description as string) ?? ''
      const speed     = (pitchData?.startSpeed as number) ?? null
      const coords    = pitchData?.coordinates as Record<string, number> | undefined
      abPitches.push({
        type: ptCode, desc: PITCH_NAMES[ptCode] ?? ptCode, code, result: descText,
        balls:   afterCount?.balls   ?? 0,
        strikes: afterCount?.strikes ?? 0,
        speed: speed ? Math.round(speed) : null,
        pX: coords?.pX ?? null, pZ: coords?.pZ ?? null,
      })
    }

    const balls   = count.balls   ?? 0
    const strikes = count.strikes ?? 0

    // Boxscore (shared for pitcher stats + batter stats)
    const boxscore = ld?.boxscore as Record<string, unknown> | undefined

    // Pitcher's game line from boxscore
    const currentPitcherStats = (() => {
      if (!boxscore || !pitcherId) return null
      const teams = boxscore.teams as Record<string, Record<string, unknown>> | undefined
      const pitcherSide = inningHalf === 'Top' ? 'home' : 'away'
      const pitcherTeamBox = teams?.[pitcherSide]
      const allPlayers = pitcherTeamBox?.players as Record<string, Record<string, unknown>> | undefined
      const pitcherBox = allPlayers?.[`ID${pitcherId}`]
      const stats = (pitcherBox?.stats as Record<string, Record<string, unknown>>)?.pitching
      if (!stats) return null
      return {
        ip:  (stats.inningsPitched as string) ?? '0.0',
        k:   (stats.strikeOuts     as number) ?? 0,
        bb:  (stats.baseOnBalls    as number) ?? 0,
        hits:(stats.hits           as number) ?? 0,
        er:  (stats.earnedRuns     as number) ?? 0,
        pc:  (stats.pitchesThrown  as number) ?? 0,
      }
    })()

    // Batter's game stats from boxscore
    const batterGameStats = (() => {
      if (!boxscore || !batterId) return null
      const teams = boxscore.teams as Record<string, Record<string, unknown>> | undefined
      const batterSide = inningHalf === 'Top' ? 'away' : 'home'
      const batterTeamBox = teams?.[batterSide]
      const allPlayers = batterTeamBox?.players as Record<string, Record<string, unknown>> | undefined
      const batterBox = allPlayers?.[`ID${batterId}`]
      const stats = (batterBox?.stats as Record<string, Record<string, unknown>>)?.batting
      if (!stats) return null
      return {
        ab:  (stats.atBats      as number) ?? 0,
        h:   (stats.hits        as number) ?? 0,
        hr:  (stats.homeRuns    as number) ?? 0,
        rbi: (stats.rbi         as number) ?? 0,
        bb:  (stats.baseOnBalls as number) ?? 0,
        k:   (stats.strikeOuts  as number) ?? 0,
        lob: (stats.leftOnBase  as number) ?? 0,
      }
    })()

    // Recent plays (last 18, reversed so newest first)
    const allPlaysArr = (plays?.allPlays as Record<string, unknown>[]) ?? []
    const recentPlays = allPlaysArr.slice(-18).reverse().map(p => {
      const about  = p.about  as Record<string, unknown> | undefined
      const result = p.result as Record<string, unknown> | undefined
      return {
        description: (result?.description as string) ?? '',
        eventType:   (result?.eventType   as string) ?? '',
        inning:      (about?.inning        as number) ?? 0,
        half:        (about?.halfInning    as string) ?? '',
        ordinalNum:  (about?.ordinalNum    as string) ?? '',
        rbi:         (result?.rbi          as number) ?? 0,
        awayScore:   (about?.awayScore     as number) ?? null,
        homeScore:   (about?.homeScore     as number) ?? null,
      }
    })

    return NextResponse.json({
      gameState,
      awayAbbr, homeAbbr, awayName, homeName,
      awayScore, homeScore,
      inning, inningHalf, outs,
      bases: { first: onFirst, second: onSecond, third: onThird },
      batterId, batterName, batterStand, batterTeam,
      pitcherId, pitcherName, pitcherHand, pitcherTeam,
      count: { balls, strikes },
      abPitches,
      currentPitcherStats,
      batterGameStats,
      recentPlays,
    })
  } catch {
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
