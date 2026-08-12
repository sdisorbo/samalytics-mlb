#!/usr/bin/env npx tsx
/**
 * Matchup Lab Backtest
 * Tests prediction accuracy against actual 2025 regular season results.
 *
 * Run: npx tsx scripts/backtest.ts
 */

import fs from 'fs'
import path from 'path'
import { runSimulations, LEAGUE_AVG_PITCHER, LEAGUE_AVG_BATTER } from '../lib/mlbSimulator'
import type { SimBatter, SimPitcher, GameSetup } from '../lib/mlbSimulator'
import type { Pitcher, Player } from '../lib/types'

const MLB_API = 'https://statsapi.mlb.com/api/v1'
const SIM_N = 500           // sims per game (higher = more stable, ~2–3s total)
const DATA_DIR = path.resolve(process.cwd(), 'data', '2025')

// ── Team ID → abbr ────────────────────────────────────────────────────────────

const TEAM_ID_TO_ABBR: Record<number, string> = {
  110: 'BAL', 111: 'BOS', 147: 'NYY', 139: 'TB',  141: 'TOR',
  145: 'CWS', 114: 'CLE', 116: 'DET', 118: 'KC',  142: 'MIN',
  117: 'HOU', 108: 'LAA', 133: 'ATH', 136: 'SEA', 140: 'TEX',
  144: 'ATL', 146: 'MIA', 121: 'NYM', 143: 'PHI', 120: 'WSH',
  112: 'CHC', 113: 'CIN', 158: 'MIL', 134: 'PIT', 138: 'STL',
  109: 'ARI', 115: 'COL', 119: 'LAD', 135: 'SD',  137: 'SF',
}

// ── Local-data helpers (mirrors MatchupLab.tsx) ────────────────────────────────

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8'))
}

function estimateHrPerAb(slg: number | null, avg: number | null): number {
  if (!slg || !avg) return 0.034
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
  return {
    playerId: p.player_id,
    name: p.name,
    team: p.team,
    kPct: Math.min((p.k_pct ?? 22.2) / 100, 0.5),
    bbPct: Math.min((p.bb_pct ?? 8.5) / 100, 0.25),
    hrPerAb: estimateHrPerAb(p.slg, p.avg),
    babip: 0.295,
    singleShare: 0.65, doubleShare: 0.29, tripleShare: 0.06,
    avg: p.avg ?? 0.243,
    obp: p.obp ?? 0.314,
    slg: p.slg ?? 0.412,
  }
}

function teamAvgPitcher(abbr: string, teamName: string, pitchers: Pitcher[]): SimPitcher {
  const staff = pitchers.filter((p) => p.team === abbr && p.innings_pitched > 5)
  if (!staff.length) return { ...LEAGUE_AVG_PITCHER, playerId: -1, name: teamName, teamName, isTbd: true }
  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length
  return {
    playerId: -1, name: `${teamName} Staff Avg`, teamName, handedness: '?',
    era: avg(staff.map((p) => p.era ?? 4.20)),
    whip: avg(staff.map((p) => p.whip ?? 1.30)),
    kPer9: avg(staff.map((p) => p.k_per_9)),
    bbPer9: avg(staff.map((p) => p.bb_per_9)),
    hrPer9: avg(staff.map((p) => (p.home_runs_allowed / Math.max(p.innings_pitched, 1)) * 9)),
    isTeamAvg: true, isTbd: true,
  }
}

function buildLineup(abbr: string, players: Player[]): SimBatter[] {
  const lineup = players
    .filter((p) => p.team === abbr && !['SP', 'RP', 'P'].includes(p.position) && p.avg != null)
    .sort((a, b) => (b.ops ?? 0) - (a.ops ?? 0))
    .slice(0, 9)
    .map(batterFromLocal)
  while (lineup.length < 9) {
    lineup.push({ ...LEAGUE_AVG_BATTER, playerId: -100 - lineup.length, name: 'League Avg' })
  }
  return lineup
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function progressBar(done: number, total: number) {
  const filled = Math.round((done / total) * 40)
  const bar = '█'.repeat(filled) + '░'.repeat(40 - filled)
  process.stdout.write(`\r  [${bar}] ${done}/${total}`)
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface RawGame {
  gamePk: number
  awayTeamId: number; homeTeamId: number
  awayTeamName: string; homeTeamName: string
  awayPitcherId: number | null
  homePitcherId: number | null
  awayRuns: number; homeRuns: number
  firstInningAwayRuns: number | null
  firstInningHomeRuns: number | null
}

async function main() {
  console.log('\n══════════════════════════════════════════════════════')
  console.log('  Matchup Lab Backtest — 2025 Regular Season (Sept)')
  console.log('══════════════════════════════════════════════════════\n')

  // Load local 2025 data
  const pitchers: Pitcher[] = readJson('pitchers.json')
  const players: Player[] = readJson('players.json')
  console.log(`  Loaded ${pitchers.length} pitchers, ${players.length} players from 2025 data`)

  // Fetch completed games — use final 4 weeks of regular season so
  // full-season stats are an accurate proxy for what was available
  console.log('  Fetching Sep 1 – Sep 28 2025 schedule from MLB Stats API...\n')
  const url =
    `${MLB_API}/schedule?sportId=1` +
    `&startDate=2025-09-01&endDate=2025-09-28` +
    `&gameType=R&hydrate=linescore(innings),probablePitcher,team`

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const resp = await fetch(url)
  const data = await resp.json() as any

  const games: RawGame[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const d of data.dates ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const g of d.games ?? []) {
      if (g.status?.abstractGameState !== 'Final') continue
      const awayRuns: number = g.linescore?.teams?.away?.runs
      const homeRuns: number = g.linescore?.teams?.home?.runs
      if (awayRuns == null || homeRuns == null || awayRuns === homeRuns) continue
      games.push({
        gamePk: g.gamePk,
        awayTeamId: g.teams.away.team.id,
        homeTeamId: g.teams.home.team.id,
        awayTeamName: g.teams.away.team.name,
        homeTeamName: g.teams.home.team.name,
        awayPitcherId: g.teams.away.probablePitcher?.id ?? null,
        homePitcherId: g.teams.home.probablePitcher?.id ?? null,
        awayRuns, homeRuns,
        firstInningAwayRuns: g.linescore?.innings?.[0]?.away?.runs ?? null,
        firstInningHomeRuns: g.linescore?.innings?.[0]?.home?.runs ?? null,
      })
    }
  }

  if (games.length === 0) {
    console.log('  No completed games found. Check network or date range.')
    return
  }
  console.log(`  Found ${games.length} completed regular season games\n`)
  console.log(`  Running ${SIM_N} simulations per game...\n`)

  // ── Simulate & score ──────────────────────────────────────────────────────

  let correct = 0
  let brierSum = 0
  let logLossSum = 0
  let pitcherHits = 0
  let nrfiCorrect = 0; let nrfiTotal = 0
  let nrfiBrierSum = 0
  const nrfiBuckets = [
    { label: '<40%',  lo: 0.00, hi: 0.40, actual: 0, n: 0 },
    { label: '40–45%',lo: 0.40, hi: 0.45, actual: 0, n: 0 },
    { label: '45–50%',lo: 0.45, hi: 0.50, actual: 0, n: 0 },
    { label: '50–55%',lo: 0.50, hi: 0.55, actual: 0, n: 0 },
    { label: '55–60%',lo: 0.55, hi: 0.60, actual: 0, n: 0 },
    { label: '60–65%',lo: 0.60, hi: 0.65, actual: 0, n: 0 },
    { label: '65%+',  lo: 0.65, hi: 1.01, actual: 0, n: 0 },
  ]

  // Run accuracy accumulators
  let awayRunsAbsErrSum = 0
  let homeRunsAbsErrSum = 0
  let totalRunsAbsErrSum = 0
  let awayRunsSqErrSum = 0
  let homeRunsSqErrSum = 0
  let totalRunsSqErrSum = 0
  const totalRunsErrors: number[] = []  // for median

  // Calibration: bucket by predicted win prob of the favored team (50–100%)
  // 5 buckets: 50-55, 55-60, 60-65, 65-70, 70+
  const calibBuckets = [
    { label: '50–55%', lo: 0.50, hi: 0.55, wins: 0, n: 0 },
    { label: '55–60%', lo: 0.55, hi: 0.60, wins: 0, n: 0 },
    { label: '60–65%', lo: 0.60, hi: 0.65, wins: 0, n: 0 },
    { label: '65–70%', lo: 0.65, hi: 0.70, wins: 0, n: 0 },
    { label: '70%+',   lo: 0.70, hi: 1.01, wins: 0, n: 0 },
  ]

  for (let i = 0; i < games.length; i++) {
    const g = games[i]
    const awayAbbr = TEAM_ID_TO_ABBR[g.awayTeamId] ?? 'UNK'
    const homeAbbr = TEAM_ID_TO_ABBR[g.homeTeamId] ?? 'UNK'

    const awayLP = g.awayPitcherId ? pitchers.find((p) => p.player_id === g.awayPitcherId) : null
    const homeLP = g.homePitcherId ? pitchers.find((p) => p.player_id === g.homePitcherId) : null
    if (awayLP || homeLP) pitcherHits++

    const setup: GameSetup = {
      awayTeamName: g.awayTeamName, awayTeamAbbr: awayAbbr,
      homeTeamName: g.homeTeamName, homeTeamAbbr: homeAbbr,
      awayPitcher: awayLP ? pitcherFromLocal(awayLP) : teamAvgPitcher(awayAbbr, g.awayTeamName, pitchers),
      homePitcher: homeLP ? pitcherFromLocal(homeLP) : teamAvgPitcher(homeAbbr, g.homeTeamName, pitchers),
      awayLineup: buildLineup(awayAbbr, players),
      homeLineup: buildLineup(homeAbbr, players),
    }

    const result = runSimulations(setup, SIM_N)
    const awayWinProb = result.awayWinPct
    const awayWon = g.awayRuns > g.homeRuns

    // Run accuracy
    const awayRunErr = Math.abs(result.avgAwayRuns - g.awayRuns)
    const homeRunErr = Math.abs(result.avgHomeRuns - g.homeRuns)
    const projTotal = result.avgAwayRuns + result.avgHomeRuns
    const actualTotal = g.awayRuns + g.homeRuns
    const totalErr = Math.abs(projTotal - actualTotal)
    awayRunsAbsErrSum += awayRunErr
    homeRunsAbsErrSum += homeRunErr
    totalRunsAbsErrSum += totalErr
    awayRunsSqErrSum += awayRunErr ** 2
    homeRunsSqErrSum += homeRunErr ** 2
    totalRunsSqErrSum += totalErr ** 2
    totalRunsErrors.push(totalErr)

    // Accuracy
    if ((awayWinProb > 0.5) === awayWon) correct++

    // Brier score (lower = better; 0.25 = random coin flip)
    brierSum += Math.pow(awayWinProb - (awayWon ? 1 : 0), 2)

    // Log loss
    const p = Math.max(0.001, Math.min(0.999, awayWinProb))
    logLossSum += -(
      (awayWon ? 1 : 0) * Math.log(p) +
      (awayWon ? 0 : 1) * Math.log(1 - p)
    )

    // Calibration — bucket by the model's confidence in the favored team
    const favoredProb = Math.max(awayWinProb, 1 - awayWinProb)
    const favoredWon = (awayWinProb >= 0.5 && awayWon) || (awayWinProb < 0.5 && !awayWon)
    for (const b of calibBuckets) {
      if (favoredProb >= b.lo && favoredProb < b.hi) {
        b.n++
        if (favoredWon) b.wins++
        break
      }
    }

    // NRFI accuracy
    if (g.firstInningAwayRuns != null && g.firstInningHomeRuns != null) {
      const actualNrfi = g.firstInningAwayRuns === 0 && g.firstInningHomeRuns === 0
      const predictNrfi = result.nrfiPct > 0.5
      if (predictNrfi === actualNrfi) nrfiCorrect++
      nrfiBrierSum += Math.pow(result.nrfiPct - (actualNrfi ? 1 : 0), 2)
      nrfiTotal++
      for (const b of nrfiBuckets) {
        if (result.nrfiPct >= b.lo && result.nrfiPct < b.hi) {
          b.n++
          if (actualNrfi) b.actual++
          break
        }
      }
    }

    progressBar(i + 1, games.length)
  }

  // ── Print results ─────────────────────────────────────────────────────────

  const n = games.length
  const accuracy = correct / n
  const brier = brierSum / n
  const logLoss = logLossSum / n

  console.log('\n\n══════════════════════════════════════════════════════')
  console.log('  RESULTS')
  console.log('══════════════════════════════════════════════════════')
  console.log(`  Games tested:          ${n}`)
  console.log(`  Correct predictions:   ${correct} / ${n}  (${(accuracy * 100).toFixed(1)}%)`)
  console.log(`  Random baseline:       50.0%`)
  console.log(`  Vegas typical:         ~55–57%`)
  console.log()
  console.log(`  Brier score:           ${brier.toFixed(4)}  (random = 0.2500, lower is better)`)
  console.log(`  Log loss:              ${logLoss.toFixed(4)}  (random = 0.6931, lower is better)`)
  console.log()
  console.log(`  Pitcher data matched:  ${pitcherHits} / ${n} games had ≥1 SP in local data`)
  console.log()
  if (nrfiTotal > 0) {
    console.log('  NRFI Accuracy')
    console.log('  ─────────────────────────────────────────────────────')
    console.log(`  Games with 1st inning data:  ${nrfiTotal}`)
    console.log(`  Correct NRFI predictions:    ${nrfiCorrect} / ${nrfiTotal}  (${(nrfiCorrect / nrfiTotal * 100).toFixed(1)}%)`)
    console.log(`  NRFI Brier score:            ${(nrfiBrierSum / nrfiTotal).toFixed(4)}  (random = 0.2500)`)
    console.log()
    console.log('  Calibration — predicted NRFI% vs actual NRFI rate:')
    console.log('  ┌──────────┬────────────┬────────┐')
    console.log('  │ Pred %   │ Actual %   │ Games  │')
    console.log('  ├──────────┼────────────┼────────┤')
    for (const b of nrfiBuckets) {
      if (b.n === 0) continue
      const actual = b.actual / b.n
      const diff = actual - (b.lo + b.hi) / 2
      const flag = Math.abs(diff) > 0.08 ? ' !' : '  '
      console.log(`  │ ${b.label.padEnd(8)} │ ${(actual * 100).toFixed(1).padStart(6)}%   │ ${String(b.n).padStart(5)}  │${flag}`)
    }
    console.log('  └──────────┴────────────┴────────┘')
    console.log()
  }

  // Run accuracy
  totalRunsErrors.sort((a, b) => a - b)
  const medianTotalErr = totalRunsErrors[Math.floor(totalRunsErrors.length / 2)]
  console.log('  Run Total Accuracy (projected vs actual)')
  console.log('  ─────────────────────────────────────────────────────')
  console.log(`  Away runs  MAE:  ${(awayRunsAbsErrSum / n).toFixed(2)}  RMSE: ${Math.sqrt(awayRunsSqErrSum / n).toFixed(2)}`)
  console.log(`  Home runs  MAE:  ${(homeRunsAbsErrSum / n).toFixed(2)}  RMSE: ${Math.sqrt(homeRunsSqErrSum / n).toFixed(2)}`)
  console.log(`  Total runs MAE:  ${(totalRunsAbsErrSum / n).toFixed(2)}  RMSE: ${Math.sqrt(totalRunsSqErrSum / n).toFixed(2)}  Median err: ${medianTotalErr.toFixed(2)}`)
  console.log()

  console.log('  Calibration — when model favors a team by X%, how often do they win?')
  console.log('  ┌──────────┬────────────┬────────────┬───────────────────────────────┐')
  console.log('  │ Pred %   │ Actual win │  Games     │                               │')
  console.log('  ├──────────┼────────────┼────────────┼───────────────────────────────┤')
  for (const b of calibBuckets) {
    if (b.n === 0) continue
    const actual = b.wins / b.n
    const bar = '█'.repeat(Math.round(actual * 20)).padEnd(20)
    const predStr = b.label.padEnd(8)
    const actStr = `${(actual * 100).toFixed(1)}%`.padStart(8)
    const nStr = `n=${b.n}`.padStart(8)
    console.log(`  │ ${predStr} │ ${actStr}   │ ${nStr}   │ ${bar} │`)
  }
  console.log('  └──────────┴────────────┴────────────┴───────────────────────────────┘')
  console.log()
}

main().catch((err) => {
  console.error('\nError:', err.message)
  process.exit(1)
})
