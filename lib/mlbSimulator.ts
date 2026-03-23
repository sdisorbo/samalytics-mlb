// ── Seeded PRNG (Mulberry32) ──────────────────────────────────────────────────
// Using a seeded generator keeps results deterministic for the same matchup,
// so "re-run" doesn't change the numbers unless the lineup/pitchers change.

let _seed = 0

function seedRng(seed: number) {
  _seed = seed >>> 0
}

function rand(): number {
  _seed = (_seed + 0x6d2b79f5) >>> 0
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0
  return ((t ^ (t >>> 14)) >>> 0) / 0x100000000
}

export function hashSetup(setup: GameSetup): number {
  // Deterministic hash from pitcher IDs + lineup player IDs
  const ids = [
    setup.awayPitcher.playerId,
    setup.homePitcher.playerId,
    ...setup.awayLineup.map((b) => b.playerId),
    ...setup.homeLineup.map((b) => b.playerId),
  ]
  let h = 0x12345678
  for (const id of ids) {
    h = Math.imul(h ^ id, 0x9e3779b9) >>> 0
  }
  return h
}

// ── League averages (2025 MLB) ────────────────────────────────────────────────
const LEAGUE_K_PCT = 0.222
const LEAGUE_BB_PCT = 0.085
const LEAGUE_HR_PER_AB = 0.034
const LEAGUE_BABIP = 0.295
const LEAGUE_K_PER_9 = 8.7
const LEAGUE_BB_PER_9 = 3.2
const LEAGUE_HR_PER_9 = 1.2

// Estimated pitches thrown per PA outcome (for starter fatigue tracking)
const PITCHES_PER_PA: Record<PAOutcome, number> = {
  K: 5.1, BB: 5.3, '1B': 3.8, '2B': 3.8, '3B': 3.8, HR: 3.5, OUT: 3.2,
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SimBatter {
  playerId: number
  name: string
  team?: string
  isLeagueAvg?: boolean
  kPct: number        // 0–1
  bbPct: number       // 0–1
  hrPerAb: number     // 0–1
  babip: number       // 0–1
  singleShare: number // fraction of non-HR hits
  doubleShare: number
  tripleShare: number
  avg: number
  obp: number
  slg: number
}

export interface PitchArsenalEntry {
  pitchType: string
  pitchName: string
  usagePct: number
  avgVelo: number | null
  baAgainst: number | null
}

export interface SimPitcher {
  playerId: number
  name: string
  teamName?: string
  handedness: 'R' | 'L' | '?'
  era: number
  whip: number
  kPer9: number
  bbPer9: number
  hrPer9: number
  isTbd?: boolean
  isTeamAvg?: boolean
  pitchArsenal?: PitchArsenalEntry[]
}

export type PAOutcome = 'K' | 'BB' | '1B' | '2B' | '3B' | 'HR' | 'OUT'

export interface GameResult {
  awayRuns: number
  homeRuns: number
  innings: number
  // per-batter outcome lists indexed by lineup slot [0..8]
  awayBatterOutcomes: PAOutcome[][]
  homeBatterOutcomes: PAOutcome[][]
  awayPitcherKs: number
  awayPitcherBb: number
  awayPitcherOuts: number
  homePitcherKs: number
  homePitcherBb: number
  homePitcherOuts: number
}

export interface BatterProjection {
  playerId: number
  name: string
  avgBases: number
  avgKs: number
}

export interface PitcherProjection {
  avgKs: number
  avgBb: number
  avgIP: number
}

export interface RunDistBucket {
  runs: number
  awayFreq: number
  homeFreq: number
}

export interface SimResults {
  awayWinPct: number
  homeWinPct: number
  tiePct: number
  avgAwayRuns: number
  avgHomeRuns: number
  confidenceInterval: number
  runDistribution: RunDistBucket[]
  awayBatterProjections: BatterProjection[]
  homeBatterProjections: BatterProjection[]
  awayPitcherProjection: PitcherProjection
  homePitcherProjection: PitcherProjection
  mostCommonScore: string
  highScore: string
  lowScore: string
}

export interface GameSetup {
  awayTeamName: string
  awayTeamAbbr: string
  homeTeamName: string
  homeTeamAbbr: string
  awayLineup: SimBatter[]
  homeLineup: SimBatter[]
  awayPitcher: SimPitcher
  homePitcher: SimPitcher
}

// ── Default profiles ──────────────────────────────────────────────────────────

export const LEAGUE_AVG_BATTER: SimBatter = {
  playerId: -1,
  name: 'League Avg Batter',
  isLeagueAvg: true,
  kPct: LEAGUE_K_PCT,
  bbPct: LEAGUE_BB_PCT,
  hrPerAb: LEAGUE_HR_PER_AB,
  babip: LEAGUE_BABIP,
  singleShare: 0.65,
  doubleShare: 0.29,
  tripleShare: 0.06,
  avg: 0.243,
  obp: 0.314,
  slg: 0.412,
}

export const LEAGUE_AVG_PITCHER: SimPitcher = {
  playerId: -1,
  name: 'League Avg Pitcher',
  handedness: '?',
  era: 4.20,
  whip: 1.30,
  kPer9: LEAGUE_K_PER_9,
  bbPer9: LEAGUE_BB_PER_9,
  hrPer9: LEAGUE_HR_PER_9,
  isTbd: true,
}

// ── Simulation core ───────────────────────────────────────────────────────────

function weightedRandom(weights: number[]): number {
  const r = rand()
  let cum = 0
  for (let i = 0; i < weights.length; i++) {
    cum += weights[i]
    if (r <= cum) return i
  }
  return weights.length - 1
}

export function simulatePa(
  batter: SimBatter,
  pitcher: SimPitcher,
  fatigued = false,
): PAOutcome {
  const kAdj = pitcher.kPer9 / LEAGUE_K_PER_9
  const bbAdj = pitcher.bbPer9 / LEAGUE_BB_PER_9
  const hrAdj = pitcher.hrPer9 / LEAGUE_HR_PER_9
  const kMod = fatigued ? 0.85 : 1.0
  const hitMod = fatigued ? 1.10 : 1.0

  // Convert HR from AB-based to PA-based
  const hrPerPa = batter.hrPerAb * (1 - batter.bbPct)

  const rawK = batter.kPct * kAdj * kMod
  const rawBb = batter.bbPct * bbAdj
  const rawHr = hrPerPa * hrAdj

  // In-play (balls not resulting in K/BB/HR)
  const inPlayBase = Math.max(0, 1 - batter.kPct - batter.bbPct - hrPerPa)
  const rawHitInPlay = inPlayBase * batter.babip * hitMod
  const rawOutInPlay = inPlayBase * (1 - batter.babip)

  // Split hits into types
  const rawSingle = rawHitInPlay * batter.singleShare
  const rawDouble = rawHitInPlay * batter.doubleShare
  const rawTriple = rawHitInPlay * batter.tripleShare

  // Normalize
  const total = rawK + rawBb + rawHr + rawSingle + rawDouble + rawTriple + rawOutInPlay
  if (total <= 0) return 'OUT'
  const n = (x: number) => x / total

  const outcomes: PAOutcome[] = ['K', 'BB', 'HR', '1B', '2B', '3B', 'OUT']
  const weights = [
    n(rawK), n(rawBb), n(rawHr),
    n(rawSingle), n(rawDouble), n(rawTriple),
    n(rawOutInPlay),
  ]
  return outcomes[weightedRandom(weights)]
}

function advanceRunners(
  runners: [boolean, boolean, boolean],
  outcome: PAOutcome,
): { newRunners: [boolean, boolean, boolean]; runs: number } {
  let [r1, r2, r3] = runners
  let runs = 0

  switch (outcome) {
    case 'BB':
      if (r1 && r2 && r3) { runs++; /* bases stay loaded */ }
      else if (r1 && r2) { r3 = true }
      else if (r1) { r2 = true }
      r1 = true
      break
    case '1B':
      if (r3) { runs++; r3 = false }
      if (r2) { r3 = true; r2 = false }
      if (r1) { r2 = true; r1 = false }
      r1 = true
      break
    case '2B':
      if (r3) { runs++; r3 = false }
      if (r2) { runs++; r2 = false }
      if (r1) { r3 = true; r1 = false }
      r2 = true
      break
    case '3B':
      if (r3) { runs++; r3 = false }
      if (r2) { runs++; r2 = false }
      if (r1) { runs++; r1 = false }
      r3 = true
      break
    case 'HR':
      runs += (r1 ? 1 : 0) + (r2 ? 1 : 0) + (r3 ? 1 : 0) + 1
      r1 = r2 = r3 = false
      break
    // K and OUT: no runner advancement (simplified)
  }

  return { newRunners: [r1, r2, r3], runs }
}

interface HalfInningResult {
  runs: number
  nextBatterIdx: number
  pitchesThrown: number
  batterOutcomes: Map<number, PAOutcome[]>
  ks: number
  bbs: number
}

function simulateHalfInning(
  lineup: SimBatter[],
  pitcher: SimPitcher,
  startBatterIdx: number,
  pitchesThrown: number,
): HalfInningResult {
  let outs = 0
  let runs = 0
  let runners: [boolean, boolean, boolean] = [false, false, false]
  let idx = startBatterIdx
  let pitches = pitchesThrown
  const batterOutcomes = new Map<number, PAOutcome[]>()
  let ks = 0
  let bbs = 0

  while (outs < 3) {
    const bIdx = idx % lineup.length
    const fatigued = pitches > 100
    const outcome = simulatePa(lineup[bIdx], pitcher, fatigued)

    const existing = batterOutcomes.get(bIdx)
    if (existing) existing.push(outcome)
    else batterOutcomes.set(bIdx, [outcome])

    pitches += PITCHES_PER_PA[outcome]

    if (outcome === 'K') { outs++; ks++ }
    else if (outcome === 'OUT') { outs++ }
    else if (outcome === 'BB') {
      bbs++
      const { newRunners, runs: r } = advanceRunners(runners, outcome)
      runners = newRunners
      runs += r
    } else {
      const { newRunners, runs: r } = advanceRunners(runners, outcome)
      runners = newRunners
      runs += r
    }
    idx++
  }

  return { runs, nextBatterIdx: idx % lineup.length, pitchesThrown: pitches, batterOutcomes, ks, bbs }
}

export function simulateGame(setup: GameSetup): GameResult {
  const { awayLineup, homeLineup, awayPitcher, homePitcher } = setup
  let awayRuns = 0
  let homeRuns = 0
  let innings = 9
  let awayBatterIdx = 0
  let homeBatterIdx = 0
  let awayPitcherPitches = 0
  let homePitcherPitches = 0
  let awayPitcherKs = 0; let awayPitcherBb = 0; let awayPitcherOuts = 0
  let homePitcherKs = 0; let homePitcherBb = 0; let homePitcherOuts = 0

  const awayBatterOutcomes: PAOutcome[][] = awayLineup.map(() => [])
  const homeBatterOutcomes: PAOutcome[][] = homeLineup.map(() => [])

  for (let inn = 1; inn <= 9; inn++) {
    // Top: away bats vs home pitcher
    const top = simulateHalfInning(awayLineup, homePitcher, awayBatterIdx, homePitcherPitches)
    awayRuns += top.runs
    awayBatterIdx = top.nextBatterIdx
    homePitcherPitches = top.pitchesThrown
    homePitcherKs += top.ks; homePitcherBb += top.bbs; homePitcherOuts += 3
    for (const [bIdx, outs] of top.batterOutcomes) awayBatterOutcomes[bIdx].push(...outs)

    // Bottom: home bats vs away pitcher
    const bot = simulateHalfInning(homeLineup, awayPitcher, homeBatterIdx, awayPitcherPitches)
    homeRuns += bot.runs
    homeBatterIdx = bot.nextBatterIdx
    awayPitcherPitches = bot.pitchesThrown
    awayPitcherKs += bot.ks; awayPitcherBb += bot.bbs; awayPitcherOuts += 3
    for (const [bIdx, outs] of bot.batterOutcomes) homeBatterOutcomes[bIdx].push(...outs)
  }

  // Extra innings (capped at 15 to prevent infinite loops)
  let extra = 10
  while (awayRuns === homeRuns && extra <= 15) {
    const top = simulateHalfInning(awayLineup, homePitcher, awayBatterIdx, homePitcherPitches + 60)
    awayRuns += top.runs; awayBatterIdx = top.nextBatterIdx
    for (const [i, o] of top.batterOutcomes) awayBatterOutcomes[i].push(...o)

    const bot = simulateHalfInning(homeLineup, awayPitcher, homeBatterIdx, awayPitcherPitches + 60)
    homeRuns += bot.runs; homeBatterIdx = bot.nextBatterIdx
    for (const [i, o] of bot.batterOutcomes) homeBatterOutcomes[i].push(...o)

    extra++; innings++
  }

  return {
    awayRuns, homeRuns, innings,
    awayBatterOutcomes, homeBatterOutcomes,
    awayPitcherKs, awayPitcherBb, awayPitcherOuts,
    homePitcherKs, homePitcherBb, homePitcherOuts,
  }
}

// ── Aggregation ───────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (arr.length === 0) return 0
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

function outcomeToBases(o: PAOutcome): number {
  if (o === '1B') return 1
  if (o === '2B') return 2
  if (o === '3B') return 3
  if (o === 'HR') return 4
  return 0
}

export function runSimulations(setup: GameSetup, n = 100): SimResults {
  // Seed from the matchup so identical setups always produce identical results
  seedRng(hashSetup(setup))
  const results: GameResult[] = Array.from({ length: n }, () => simulateGame(setup))

  const awayWins = results.filter((r) => r.awayRuns > r.homeRuns).length
  const homeWins = results.filter((r) => r.homeRuns > r.awayRuns).length
  const ties = n - awayWins - homeWins
  const awayWinPct = awayWins / n
  const homeWinPct = homeWins / n
  const ci = 1.96 * Math.sqrt((awayWinPct * (1 - awayWinPct)) / n)

  const awayRunsArr = results.map((r) => r.awayRuns)
  const homeRunsArr = results.map((r) => r.homeRuns)

  const maxRuns = Math.max(Math.max(...awayRunsArr), Math.max(...homeRunsArr), 10)
  const runDistribution: RunDistBucket[] = Array.from({ length: maxRuns + 1 }, (_, runs) => ({
    runs,
    awayFreq: awayRunsArr.filter((v) => v === runs).length,
    homeFreq: homeRunsArr.filter((v) => v === runs).length,
  }))

  // Batter projections
  const awayBatterProjections: BatterProjection[] = setup.awayLineup.map((b, i) => {
    const allOutcomes = results.flatMap((r) => r.awayBatterOutcomes[i] ?? [])
    return {
      playerId: b.playerId,
      name: b.name,
      avgBases: allOutcomes.length > 0 ? mean(allOutcomes.map(outcomeToBases)) * (allOutcomes.length / n) : 0,
      avgKs: allOutcomes.filter((o) => o === 'K').length / n,
    }
  })
  const homeBatterProjections: BatterProjection[] = setup.homeLineup.map((b, i) => {
    const allOutcomes = results.flatMap((r) => r.homeBatterOutcomes[i] ?? [])
    return {
      playerId: b.playerId,
      name: b.name,
      avgBases: allOutcomes.length > 0 ? mean(allOutcomes.map(outcomeToBases)) * (allOutcomes.length / n) : 0,
      avgKs: allOutcomes.filter((o) => o === 'K').length / n,
    }
  })

  // Pitcher projections (away pitcher pitches to home lineup, home pitcher pitches to away lineup)
  const awayPitcherProjection: PitcherProjection = {
    avgKs: mean(results.map((r) => r.awayPitcherKs)),
    avgBb: mean(results.map((r) => r.awayPitcherBb)),
    avgIP: mean(results.map((r) => r.awayPitcherOuts / 3)),
  }
  const homePitcherProjection: PitcherProjection = {
    avgKs: mean(results.map((r) => r.homePitcherKs)),
    avgBb: mean(results.map((r) => r.homePitcherBb)),
    avgIP: mean(results.map((r) => r.homePitcherOuts / 3)),
  }

  // Score summaries
  const scoreMap = new Map<string, number>()
  for (const r of results) {
    const key = `${r.awayRuns}-${r.homeRuns}`
    scoreMap.set(key, (scoreMap.get(key) ?? 0) + 1)
  }
  const mostCommonScore = [...scoreMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '0-0'
  const allTotals = results.map((r) => r.awayRuns + r.homeRuns)
  const maxIdx = allTotals.indexOf(Math.max(...allTotals))
  const minIdx = allTotals.indexOf(Math.min(...allTotals))

  return {
    awayWinPct,
    homeWinPct,
    tiePct: ties / n,
    avgAwayRuns: mean(awayRunsArr),
    avgHomeRuns: mean(homeRunsArr),
    confidenceInterval: ci,
    runDistribution,
    awayBatterProjections,
    homeBatterProjections,
    awayPitcherProjection,
    homePitcherProjection,
    mostCommonScore,
    highScore: `${results[maxIdx].awayRuns}-${results[maxIdx].homeRuns}`,
    lowScore: `${results[minIdx].awayRuns}-${results[minIdx].homeRuns}`,
  }
}

// ── ELO delta ─────────────────────────────────────────────────────────────────

export function calcEloDelta(
  teamElo: number,
  opponentElo: number,
): { winDelta: number; lossDelta: number } {
  const K = 20
  const expected = 1 / (1 + Math.pow(10, (opponentElo - teamElo) / 400))
  return {
    winDelta: Math.round(K * (1 - expected)),
    lossDelta: Math.round(K * (0 - expected)),
  }
}
