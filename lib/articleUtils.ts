import type { Pitcher, Player } from './types'

// ── Aggregated stats ──────────────────────────────────────────────────────────

export interface TeamPitchingStats {
  teamAbbr: string
  teamName: string
  avgEra: number
  avgFip: number
  avgXfip: number
  avgK9: number
  avgBb9: number
  avgWhip: number
  totalIp: number
  pitcherCount: number
  // Averaged percentiles (0–100)
  eraPercentile: number
  fipPercentile: number
  k9Percentile: number
  bb9Percentile: number
  whipPercentile: number
  overallPercentile: number
}

export interface TeamBattingStats {
  teamAbbr: string
  teamName: string
  avgAvg: number
  avgObp: number
  avgSlg: number
  avgOps: number
  avgKPct: number
  avgBbPct: number
  playerCount: number
  // Averaged percentiles (0–100)
  avgPercentile: number
  obpPercentile: number
  slgPercentile: number
  opsPercentile: number
  kPctPercentile: number
  bbPctPercentile: number
  overallPercentile: number
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0
  return nums.reduce((s, v) => s + v, 0) / nums.length
}

export function getTeamPitchingStats(
  abbr: string,
  pitchers: Pitcher[]
): TeamPitchingStats | null {
  const staff = pitchers.filter(
    (p) => p.team === abbr && p.innings_pitched >= 10
  )
  if (staff.length === 0) return null

  const teamName = staff[0].team_name

  const eraPercentile  = Math.round(avg(staff.map((p) => p.era_percentile)))
  const fipPercentile  = Math.round(avg(staff.map((p) => p.fip_percentile)))
  const k9Percentile   = Math.round(avg(staff.map((p) => p.k9_percentile)))
  const bb9Percentile  = Math.round(avg(staff.map((p) => p.bb9_percentile)))
  const whipPercentile = Math.round(avg(staff.map((p) => p.whip_percentile)))
  const overallPercentile = Math.round(
    avg([eraPercentile, fipPercentile, k9Percentile, bb9Percentile, whipPercentile])
  )

  return {
    teamAbbr: abbr,
    teamName,
    avgEra:   parseFloat(avg(staff.filter((p) => p.era  != null).map((p) => p.era  as number)).toFixed(2)),
    avgFip:   parseFloat(avg(staff.filter((p) => p.fip  != null).map((p) => p.fip  as number)).toFixed(2)),
    avgXfip:  parseFloat(avg(staff.filter((p) => p.xfip != null).map((p) => p.xfip as number)).toFixed(2)),
    avgK9:    parseFloat(avg(staff.map((p) => p.k_per_9)).toFixed(1)),
    avgBb9:   parseFloat(avg(staff.map((p) => p.bb_per_9)).toFixed(1)),
    avgWhip:  parseFloat(avg(staff.filter((p) => p.whip != null).map((p) => p.whip as number)).toFixed(2)),
    totalIp:  Math.round(staff.reduce((s, p) => s + p.innings_pitched, 0)),
    pitcherCount: staff.length,
    eraPercentile,
    fipPercentile,
    k9Percentile,
    bb9Percentile,
    whipPercentile,
    overallPercentile,
  }
}

export function getTeamBattingStats(
  abbr: string,
  players: Player[]
): TeamBattingStats | null {
  const hitters = players.filter(
    (p) =>
      p.team === abbr &&
      !['SP', 'RP', 'P'].includes(p.position) &&
      p.avg != null &&
      p.ops != null
  )
  if (hitters.length === 0) return null

  const teamName = hitters[0].team_name

  const avgPercentile  = Math.round(avg(hitters.map((p) => p.avg_percentile)))
  const obpPercentile  = Math.round(avg(hitters.map((p) => p.obp_percentile)))
  const slgPercentile  = Math.round(avg(hitters.map((p) => p.slg_percentile)))
  const opsPercentile  = Math.round(avg(hitters.map((p) => p.ops_percentile)))
  const kPctPercentile = Math.round(avg(hitters.map((p) => p.k_pct_percentile)))
  const bbPctPercentile = Math.round(avg(hitters.map((p) => p.bb_pct_percentile)))
  const overallPercentile = Math.round(
    avg([avgPercentile, obpPercentile, slgPercentile, opsPercentile])
  )

  return {
    teamAbbr: abbr,
    teamName,
    avgAvg:  parseFloat(avg(hitters.filter((p) => p.avg != null).map((p) => p.avg as number)).toFixed(3)),
    avgObp:  parseFloat(avg(hitters.filter((p) => p.obp != null).map((p) => p.obp as number)).toFixed(3)),
    avgSlg:  parseFloat(avg(hitters.filter((p) => p.slg != null).map((p) => p.slg as number)).toFixed(3)),
    avgOps:  parseFloat(avg(hitters.filter((p) => p.ops != null).map((p) => p.ops as number)).toFixed(3)),
    avgKPct: parseFloat(avg(hitters.filter((p) => p.k_pct != null).map((p) => p.k_pct as number)).toFixed(1)),
    avgBbPct: parseFloat(avg(hitters.filter((p) => p.bb_pct != null).map((p) => p.bb_pct as number)).toFixed(1)),
    playerCount: hitters.length,
    avgPercentile,
    obpPercentile,
    slgPercentile,
    opsPercentile,
    kPctPercentile,
    bbPctPercentile,
    overallPercentile,
  }
}

// ── Qualitative helpers ───────────────────────────────────────────────────────

function pctLabel(pct: number): string {
  if (pct >= 85) return 'elite'
  if (pct >= 70) return 'above-average'
  if (pct >= 50) return 'solid'
  if (pct >= 35) return 'below-average'
  return 'poor'
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0])
}

// ── Article copy — pitching ───────────────────────────────────────────────────

export function pitchingHeadline(teamName: string, stats: TeamPitchingStats): string {
  const label = pctLabel(stats.overallPercentile)
  return `Breaking Down the ${teamName} Rotation: ${label.charAt(0).toUpperCase() + label.slice(1)} Marks Across the Board`
}

export function pitchingBlurb(teamName: string, stats: TeamPitchingStats): string {
  return `The ${teamName} staff ranks in the ${ordinal(stats.overallPercentile)} percentile overall, posting a ${stats.avgEra} ERA and ${stats.avgK9} K/9 across their qualified starters.`
}

export function pitchingArticleBody(teamName: string, stats: TeamPitchingStats): string[] {
  const paragraphs: string[] = []

  // Overall summary
  paragraphs.push(
    `The ${teamName} pitching staff sits in the ${ordinal(stats.overallPercentile)} percentile league-wide when ERA, FIP, K/9, BB/9, and WHIP are averaged together across ${stats.pitcherCount} qualified starters. ` +
    `Their collective ERA of ${stats.avgEra} ranks in the ${ordinal(stats.eraPercentile)} percentile, while their FIP of ${stats.avgFip} tells a ${Math.abs(stats.eraPercentile - stats.fipPercentile) > 10 ? 'somewhat different' : 'consistent'} story at the ${ordinal(stats.fipPercentile)} percentile. ` +
    `Over ${stats.totalIp} combined innings, this rotation has been ${pctLabel(stats.overallPercentile)} relative to the rest of the league.`
  )

  // Strikeout / walk paragraph
  const kStrength = stats.k9Percentile >= 65
  const bbStrength = stats.bb9Percentile >= 65
  if (kStrength && bbStrength) {
    paragraphs.push(
      `Strikeout ability and walk prevention are both clear strengths. The staff averages ${stats.avgK9} K/9 (${ordinal(stats.k9Percentile)} percentile) and ${stats.avgBb9} BB/9 (${ordinal(stats.bb9Percentile)} percentile). ` +
      `That combination of missing bats while avoiding free passes is a hallmark of a top-tier rotation and gives the offense a significant margin for error.`
    )
  } else if (!kStrength && !bbStrength) {
    paragraphs.push(
      `Neither strikeout rate nor walk prevention stand out as strengths. The rotation averages ${stats.avgK9} K/9 (${ordinal(stats.k9Percentile)} percentile) and ${stats.avgBb9} BB/9 (${ordinal(stats.bb9Percentile)} percentile). ` +
      `Generating weak contact consistently becomes more important when a staff does not miss many bats or command the zone at an above-average clip.`
    )
  } else {
    paragraphs.push(
      `Strikeout ability ${kStrength ? 'is a clear strength' : 'has been a weakness'} — the staff averages ${stats.avgK9} K/9, ranking in the ${ordinal(stats.k9Percentile)} percentile. ` +
      `Walk prevention ${bbStrength ? 'has been solid' : 'remains an area of concern'}, with the rotation posting ${stats.avgBb9} BB/9 (${ordinal(stats.bb9Percentile)} percentile). ` +
      `${bbStrength ? 'The ability to avoid free passes helps offset any limitations in pure swing-and-miss stuff.' : 'Too many free passes can amplify the effects of below-average strikeout numbers.'}`
    )
  }

  // WHIP / contact paragraph
  paragraphs.push(
    `Contact management has been ${pctLabel(stats.whipPercentile)} — the staff carries a ${stats.avgWhip} WHIP (${ordinal(stats.whipPercentile)} percentile). ` +
    `${stats.whipPercentile >= 60
      ? `Limiting baserunners has been a consistent theme for this staff, keeping opposing offenses from stringing together big innings.`
      : `The rotation has allowed baserunners at a rate that makes them vulnerable to a crooked number if their defense does not perform behind them.`} ` +
    `Their xFIP of ${stats.avgXfip} suggests their results are ${Math.abs(stats.avgEra - stats.avgXfip) < 0.3 ? 'in line with' : stats.avgEra < stats.avgXfip ? 'somewhat better than' : 'somewhat worse than'} what the underlying peripherals would predict going forward.`
  )

  return paragraphs
}

// ── Article copy — batting ────────────────────────────────────────────────────

export function battingHeadline(teamName: string, stats: TeamBattingStats): string {
  const label = pctLabel(stats.overallPercentile)
  return `${teamName} Offense in Focus: A ${label.charAt(0).toUpperCase() + label.slice(1)} Lineup by the Numbers`
}

export function battingBlurb(teamName: string, stats: TeamBattingStats): string {
  return `${teamName} hitters rank in the ${ordinal(stats.overallPercentile)} percentile overall, batting .${String(Math.round(stats.avgAvg * 1000)).padStart(3, '0')} with a ${stats.avgOps} OPS across their active roster.`
}

export function battingArticleBody(teamName: string, stats: TeamBattingStats): string[] {
  const paragraphs: string[] = []

  // Overall summary
  paragraphs.push(
    `The ${teamName} lineup ranks in the ${ordinal(stats.overallPercentile)} percentile across the four core offensive rate stats — AVG, OBP, SLG, and OPS — when averaged across ${stats.playerCount} qualified hitters. ` +
    `The team posts a collective .${String(Math.round(stats.avgAvg * 1000)).padStart(3, '0')} batting average (${ordinal(stats.avgPercentile)} percentile) and a ${stats.avgOps} OPS (${ordinal(stats.opsPercentile)} percentile). ` +
    `Their .${String(Math.round(stats.avgObp * 1000)).padStart(3, '0')} on-base percentage (${ordinal(stats.obpPercentile)} percentile) and .${String(Math.round(stats.avgSlg * 1000)).padStart(3, '0')} slugging (${ordinal(stats.slgPercentile)} percentile) round out a picture of a lineup that is ${pctLabel(stats.overallPercentile)} at generating offense.`
  )

  // Plate discipline paragraph
  const kIssue = stats.kPctPercentile < 45
  const bbStrength = stats.bbPctPercentile >= 60
  paragraphs.push(
    `At the plate, this lineup strikes out at a ${pctLabel(100 - stats.kPctPercentile)} rate — their ${stats.avgKPct}% K% ranks in the ${ordinal(stats.kPctPercentile)} percentile. ` +
    `Walk rate is ${pctLabel(stats.bbPctPercentile)}, with the team drawing free passes ${stats.avgBbPct}% of the time (${ordinal(stats.bbPctPercentile)} percentile). ` +
    `${kIssue && !bbStrength
      ? 'High strikeout rates combined with modest walk numbers limit the lineup\'s ability to keep rallies alive without a big hit.'
      : bbStrength && !kIssue
        ? 'The combination of plate discipline and contact rate is a genuine strength, giving pitchers few easy outs.'
        : 'Their plate discipline profile is a mixed bag, with certain lineup spots carrying the approach while others represent exploitable weaknesses.'}`
  )

  // Power / contact paragraph
  paragraphs.push(
    `Their slugging percentage of .${String(Math.round(stats.avgSlg * 1000)).padStart(3, '0')} places the lineup in the ${ordinal(stats.slgPercentile)} percentile for raw power, while their .${String(Math.round(stats.avgObp * 1000)).padStart(3, '0')} OBP (${ordinal(stats.obpPercentile)} percentile) reflects how often they reach base by any means. ` +
    `${stats.slgPercentile >= 65 && stats.obpPercentile >= 60
      ? 'The ability to both get on base and do damage when they do makes this one of the more complete lineups in the league.'
      : stats.slgPercentile < 45 && stats.obpPercentile < 45
        ? 'Low production in both categories means this lineup needs opposing pitchers to beat themselves in order to generate runs consistently.'
        : stats.slgPercentile >= 65
          ? 'When they make contact, the power is there. Improving their on-base rate would unlock significant additional run-scoring potential.'
          : 'Getting on base at a decent clip keeps opponents honest, but the lineup needs more impact at the end of rallies to turn that into runs.'}`
  )

  return paragraphs
}
