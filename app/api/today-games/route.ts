import { NextResponse } from 'next/server'
import {
  runSimulations,
  LEAGUE_AVG_BATTER,
  LEAGUE_AVG_PITCHER,
  type SimBatter,
  type SimPitcher,
  type GameSetup,
} from '../../../lib/mlbSimulator'
import { getPitchers, getPlayers } from '../../../lib/data'
import type { Pitcher, Player } from '../../../lib/types'

const MLB_API = 'https://statsapi.mlb.com/api/v1'
const SIM_COUNT = 500  // more sims than the UI for stable ticker %s

// ── Mirrors the same helpers used in MatchupLab ───────────────────────────────

function estimateHrPerAb(slg: number | null, avg: number | null): number {
  if (slg == null || avg == null) return 0.034
  return Math.max(0, Math.min((slg - avg) * 0.28, 0.09))
}

function pitcherFromLocal(p: Pitcher): SimPitcher {
  const ip = p.innings_pitched > 0 ? p.innings_pitched : 1
  return {
    playerId: p.player_id,
    name: p.name,
    teamName: p.team_name,
    handedness: '?',
    era: p.era ?? 4.20,
    whip: p.whip ?? 1.30,
    kPer9: p.k_per_9,
    bbPer9: p.bb_per_9,
    hrPer9: (p.home_runs_allowed / ip) * 9,
  }
}

function batterFromLocal(p: Player): SimBatter {
  const kPct  = p.k_pct  != null ? p.k_pct  / 100 : 0.222
  const bbPct = p.bb_pct != null ? p.bb_pct / 100 : 0.085
  return {
    playerId: p.player_id,
    name: p.name,
    team: p.team,
    kPct:  Math.min(kPct,  0.50),
    bbPct: Math.min(bbPct, 0.25),
    hrPerAb: estimateHrPerAb(p.slg, p.avg),
    babip: 0.295,
    singleShare: 0.65,
    doubleShare: 0.29,
    tripleShare: 0.06,
    avg: p.avg ?? 0.243,
    obp: p.obp ?? 0.314,
    slg: p.slg ?? 0.412,
  }
}

function buildLineup(abbr: string, players: Player[]): SimBatter[] {
  const lineup: SimBatter[] = players
    .filter((p) => p.team === abbr && !['SP', 'RP', 'P'].includes(p.position) && p.avg != null)
    .sort((a, b) => (b.ops ?? 0) - (a.ops ?? 0))
    .slice(0, 9)
    .map(batterFromLocal)

  while (lineup.length < 9) {
    lineup.push({ ...LEAGUE_AVG_BATTER, playerId: -100 - lineup.length, name: 'League Avg Batter', isLeagueAvg: true })
  }
  return lineup
}

function teamAvgPitcher(abbr: string, teamName: string, pitchers: Pitcher[]): SimPitcher {
  const staff = pitchers.filter((p) => p.team === abbr && p.innings_pitched > 5)
  if (staff.length === 0) {
    return { ...LEAGUE_AVG_PITCHER, playerId: -1, name: `${teamName} Staff Avg`, teamName, isTeamAvg: true }
  }
  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length
  return {
    playerId: -1,
    name: `${teamName} Staff Avg`,
    teamName,
    handedness: '?',
    era:   avg(staff.map((p) => p.era  ?? 4.20)),
    whip:  avg(staff.map((p) => p.whip ?? 1.30)),
    kPer9: avg(staff.map((p) => p.k_per_9)),
    bbPer9: avg(staff.map((p) => p.bb_per_9)),
    hrPer9: avg(staff.map((p) => (p.home_runs_allowed / Math.max(p.innings_pitched, 1)) * 9)),
    isTeamAvg: true,
    isTbd: true,
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

    const schedRes = await fetch(
      `${MLB_API}/schedule?sportId=1&date=${today}&hydrate=probablePitcher,team,linescore`,
      { next: { revalidate: 60 } }
    )
    if (!schedRes.ok) throw new Error(`MLB API ${schedRes.status}`)
    const schedData = await schedRes.json()

    // Load local stats data
    let pitchers: Pitcher[] = []
    let players:  Player[]  = []
    try { pitchers = getPitchers() } catch { /* unavailable */ }
    try { players  = getPlayers()  } catch { /* unavailable */ }

    const pitcherById = new Map(pitchers.map((p) => [p.player_id, p]))

    const games: object[] = []

    for (const dateBlock of schedData.dates ?? []) {
      for (const game of dateBlock.games ?? []) {
        const away = game.teams?.away
        const home = game.teams?.home
        const awayAbbr: string = (away?.team?.abbreviation ?? '').toUpperCase()
        const homeAbbr: string = (home?.team?.abbreviation ?? '').toUpperCase()
        const awayTeamName: string = away?.team?.teamName ?? awayAbbr
        const homeTeamName: string = home?.team?.teamName ?? homeAbbr

        const state: string = game.status?.abstractGameState ?? ''
        const isLive  = state === 'Live'
        const isFinal = state === 'Final'

        // Resolve probable pitchers — exact same three-way logic as MatchupLab:
        //   1. Found in pitchers.json → pitcherFromLocal
        //   2. Named in schedule but not in our data → LEAGUE_AVG_PITCHER (named)
        //   3. No pitcher announced → teamAvgPitcher (staff composite)
        const awayProbable = away?.probablePitcher
        const homeProbable = home?.probablePitcher
        const awayPitcherLocal = awayProbable?.id ? pitcherById.get(awayProbable.id) : null
        const homePitcherLocal = homeProbable?.id ? pitcherById.get(homeProbable.id) : null

        const awayPitcher: SimPitcher = awayPitcherLocal
          ? pitcherFromLocal(awayPitcherLocal)
          : awayProbable?.fullName
            ? { ...LEAGUE_AVG_PITCHER, playerId: awayProbable.id ?? -1, name: awayProbable.fullName, isTbd: false }
            : teamAvgPitcher(awayAbbr, awayTeamName, pitchers)

        const homePitcher: SimPitcher = homePitcherLocal
          ? pitcherFromLocal(homePitcherLocal)
          : homeProbable?.fullName
            ? { ...LEAGUE_AVG_PITCHER, playerId: homeProbable.id ?? -1, name: homeProbable.fullName, isTbd: false }
            : teamAvgPitcher(homeAbbr, homeTeamName, pitchers)

        const awayLineup = buildLineup(awayAbbr, players)
        const homeLineup = buildLineup(homeAbbr, players)

        const setup: GameSetup = {
          awayTeamName,
          awayTeamAbbr: awayAbbr,
          homeTeamName,
          homeTeamAbbr: homeAbbr,
          awayLineup,
          homeLineup,
          awayPitcher,
          homePitcher,
        }

        const sim = runSimulations(setup, SIM_COUNT)

        games.push({
          gamePk:     game.gamePk,
          gameTime:   game.gameDate,
          state,
          inning:     game.linescore?.currentInning    ?? null,
          inningHalf: game.linescore?.inningHalf        ?? null,
          away: {
            abbr:    awayAbbr,
            score:   isLive || isFinal ? (away?.score ?? null) : null,
            winProb: Math.round(sim.awayWinPct * 100),
          },
          home: {
            abbr:    homeAbbr,
            score:   isLive || isFinal ? (home?.score ?? null) : null,
            winProb: Math.round(sim.homeWinPct * 100),
          },
        })
      }
    }

    return NextResponse.json(games)
  } catch {
    return NextResponse.json([])
  }
}
