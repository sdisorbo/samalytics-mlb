'use client'

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import type { TeamStanding, Pitcher, Player, PitcherArsenal } from '../lib/types'
import {
  runSimulations,
  calcEloDelta,
  LEAGUE_AVG_BATTER,
  LEAGUE_AVG_PITCHER,
  type SimBatter,
  type SimPitcher,
  type SimResults,
  type GameSetup,
} from '../lib/mlbSimulator'

// ── Constants ─────────────────────────────────────────────────────────────────

const MLB_STATS_API = 'https://statsapi.mlb.com/api/v1'
const SIM_COUNT = 100

const MLB_TEAMS = [
  { id: 110, name: 'Baltimore Orioles',    abbr: 'BAL' },
  { id: 111, name: 'Boston Red Sox',       abbr: 'BOS' },
  { id: 147, name: 'New York Yankees',     abbr: 'NYY' },
  { id: 139, name: 'Tampa Bay Rays',       abbr: 'TB'  },
  { id: 141, name: 'Toronto Blue Jays',    abbr: 'TOR' },
  { id: 145, name: 'Chicago White Sox',    abbr: 'CWS' },
  { id: 114, name: 'Cleveland Guardians',  abbr: 'CLE' },
  { id: 116, name: 'Detroit Tigers',       abbr: 'DET' },
  { id: 118, name: 'Kansas City Royals',   abbr: 'KC'  },
  { id: 142, name: 'Minnesota Twins',      abbr: 'MIN' },
  { id: 117, name: 'Houston Astros',       abbr: 'HOU' },
  { id: 108, name: 'Los Angeles Angels',   abbr: 'LAA' },
  { id: 133, name: 'Athletics',            abbr: 'ATH' },
  { id: 136, name: 'Seattle Mariners',     abbr: 'SEA' },
  { id: 140, name: 'Texas Rangers',        abbr: 'TEX' },
  { id: 144, name: 'Atlanta Braves',       abbr: 'ATL' },
  { id: 146, name: 'Miami Marlins',        abbr: 'MIA' },
  { id: 121, name: 'New York Mets',        abbr: 'NYM' },
  { id: 143, name: 'Philadelphia Phillies',abbr: 'PHI' },
  { id: 120, name: 'Washington Nationals', abbr: 'WSH' },
  { id: 112, name: 'Chicago Cubs',         abbr: 'CHC' },
  { id: 113, name: 'Cincinnati Reds',      abbr: 'CIN' },
  { id: 158, name: 'Milwaukee Brewers',    abbr: 'MIL' },
  { id: 134, name: 'Pittsburgh Pirates',   abbr: 'PIT' },
  { id: 138, name: 'St. Louis Cardinals',  abbr: 'STL' },
  { id: 109, name: 'Arizona Diamondbacks', abbr: 'ARI' },
  { id: 115, name: 'Colorado Rockies',     abbr: 'COL' },
  { id: 119, name: 'Los Angeles Dodgers',  abbr: 'LAD' },
  { id: 135, name: 'San Diego Padres',     abbr: 'SD'  },
  { id: 137, name: 'San Francisco Giants', abbr: 'SF'  },
]

const TEAM_ID_TO_ABBR: Record<number, string> = Object.fromEntries(
  MLB_TEAMS.map((t) => [t.id, t.abbr])
)

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Local-data conversion helpers ────────────────────────────────────────────

function estimateHrPerAb(slg: number | null, avg: number | null): number {
  if (slg == null || avg == null) return 0.034
  // Rough: HR contribute ~3 slugging pts per HR per AB; extra power beyond singles
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
  // k_pct and bb_pct stored as percentages (e.g. 22.5 = 22.5%)
  const kPct = p.k_pct != null ? p.k_pct / 100 : 0.222
  const bbPct = p.bb_pct != null ? p.bb_pct / 100 : 0.085
  return {
    playerId: p.player_id,
    name: p.name,
    team: p.team,
    kPct: Math.min(kPct, 0.5),
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
    era: avg(staff.map((p) => p.era ?? 4.20)),
    whip: avg(staff.map((p) => p.whip ?? 1.30)),
    kPer9: avg(staff.map((p) => p.k_per_9)),
    bbPer9: avg(staff.map((p) => p.bb_per_9)),
    hrPer9: avg(staff.map((p) => (p.home_runs_allowed / Math.max(p.innings_pitched, 1)) * 9)),
    isTeamAvg: true,
    isTbd: true,
  }
}

function buildLineup(abbr: string, players: Player[]): SimBatter[] {
  const positionPlayers = players
    .filter((p) => p.team === abbr && !['SP', 'RP', 'P'].includes(p.position) && p.avg != null)
    .sort((a, b) => (b.ops ?? 0) - (a.ops ?? 0))
    .slice(0, 9)

  const lineup: SimBatter[] = positionPlayers.map(batterFromLocal)
  while (lineup.length < 9) {
    lineup.push({
      ...LEAGUE_AVG_BATTER,
      playerId: -100 - lineup.length,
      name: 'League Avg Batter',
      isLeagueAvg: true,
    })
  }
  return lineup
}

// ── API helpers ───────────────────────────────────────────────────────────────

interface ScheduleGame {
  gamePk: number
  gameDate: string
  awayTeamId: number
  homeTeamId: number
  awayTeamName: string
  homeTeamName: string
  awayPitcherId: number | null
  awayPitcherName: string | null
  homePitcherId: number | null
  homePitcherName: string | null
}

async function fetchSchedule(date: string): Promise<ScheduleGame[]> {
  const url = `${MLB_STATS_API}/schedule?sportId=1&date=${date}&hydrate=probablePitcher,team`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  const games: ScheduleGame[] = []
  for (const dateEntry of data.dates ?? []) {
    for (const game of dateEntry.games ?? []) {
      games.push({
        gamePk: game.gamePk,
        gameDate: game.gameDate,
        awayTeamId: game.teams.away.team.id,
        homeTeamId: game.teams.home.team.id,
        awayTeamName: game.teams.away.team.name,
        homeTeamName: game.teams.home.team.name,
        awayPitcherId: game.teams.away.probablePitcher?.id ?? null,
        awayPitcherName: game.teams.away.probablePitcher?.fullName ?? null,
        homePitcherId: game.teams.home.probablePitcher?.id ?? null,
        homePitcherName: game.teams.home.probablePitcher?.fullName ?? null,
      })
    }
  }
  return games
}

// ── Component types ───────────────────────────────────────────────────────────

type SwapTarget =
  | { type: 'away-pitcher' }
  | { type: 'home-pitcher' }
  | { type: 'away-batter'; idx: number }
  | { type: 'home-batter'; idx: number }

interface GameState {
  gameId: number
  awayTeamId: number
  homeTeamId: number
  awayTeamName: string
  homeTeamName: string
  awayTeamAbbr: string
  homeTeamAbbr: string
  awayPitcher: SimPitcher
  homePitcher: SimPitcher
  origAwayPitcher: SimPitcher
  origHomePitcher: SimPitcher
  awayLineup: SimBatter[]
  homeLineup: SimBatter[]
  origAwayLineup: SimBatter[]
  origHomeLineup: SimBatter[]
  simResults: SimResults | null
  expanded: boolean
  swapTarget: SwapTarget | null
}

// ── Run Distribution Chart ────────────────────────────────────────────────────

function RunDistChart({
  simResults,
  awayAbbr,
  homeAbbr,
}: {
  simResults: SimResults
  awayAbbr: string
  homeAbbr: string
}) {
  const data = simResults.runDistribution.filter((b) => b.awayFreq > 0 || b.homeFreq > 0)
  return (
    <div>
      <div className="text-2xs font-semibold uppercase tracking-widest text-538-muted mb-2">
        Simulated Run Distribution (n={SIM_COUNT})
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: -8 }}>
          <XAxis dataKey="runs" tick={{ fontSize: 10, fill: '#8A6248' }} />
          <YAxis tick={{ fontSize: 10, fill: '#8A6248' }} />
          <Tooltip
            contentStyle={{ fontSize: 11, borderColor: '#DDD0C0', borderRadius: 4, color: '#2A1610' }}
            formatter={(v, name) => [`${v} sims`, name]}
          />
          <Legend wrapperStyle={{ fontSize: 10, paddingTop: 4 }} />
          <Bar dataKey="awayFreq" name={awayAbbr} fill="#7C2B1A" radius={[2, 2, 0, 0]} />
          <Bar dataKey="homeFreq" name={homeAbbr} fill="#DDD0C0" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <div className="flex gap-6 text-2xs text-538-muted mt-1">
        <span>Most common: <span className="font-bold text-538-text">{simResults.mostCommonScore}</span></span>
        <span>Highest: <span className="font-medium text-538-text">{simResults.highScore}</span></span>
        <span>Lowest: <span className="font-medium text-538-text">{simResults.lowScore}</span></span>
      </div>
    </div>
  )
}

// ── Inline swap search ────────────────────────────────────────────────────────

function SwapSearch({
  pitchers,
  players,
  target,
  onSelect,
  onReset,
  onClose,
}: {
  pitchers: Pitcher[]
  players: Player[]
  target: SwapTarget
  onSelect: (item: Pitcher | Player) => void
  onReset: () => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const isPitcher = target.type === 'away-pitcher' || target.type === 'home-pitcher'

  useEffect(() => { inputRef.current?.focus() }, [])

  const results = useMemo(() => {
    const q = query.toLowerCase()
    if (isPitcher) {
      return pitchers
        .filter((p) => p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
        .sort((a, b) => (b.innings_pitched ?? 0) - (a.innings_pitched ?? 0))
        .slice(0, 20)
    } else {
      return players
        .filter(
          (p) =>
            !['SP', 'RP', 'P'].includes(p.position) &&
            (p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)),
        )
        .sort((a, b) => (b.ops ?? 0) - (a.ops ?? 0))
        .slice(0, 20)
    }
  }, [query, isPitcher, pitchers, players])

  return (
    <div className="border border-538-border rounded-sm bg-white shadow-lg mt-1 z-30">
      <div className="flex items-center border-b border-538-border px-3 py-2 gap-2">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 text-xs outline-none text-538-text placeholder:text-538-muted bg-transparent"
          placeholder={isPitcher ? 'Search pitcher...' : 'Search batter...'}
        />
        <button onClick={onReset} className="text-2xs text-538-muted hover:text-538-orange underline">
          Reset
        </button>
        <button onClick={onClose} className="text-538-muted hover:text-538-text ml-1 text-xs leading-none">
          ✕
        </button>
      </div>
      <div className="max-h-52 overflow-y-auto">
        {results.length === 0 && (
          <div className="px-3 py-3 text-2xs text-538-muted">No results</div>
        )}
        {results.map((item) => {
          const isP = 'k_per_9' in item
          return (
            <button
              key={item.player_id}
              className="w-full text-left px-3 py-2 text-2xs hover:bg-538-bg border-b border-538-border last:border-0 flex items-center gap-2"
              onClick={() => onSelect(item)}
            >
              <span className="font-semibold text-538-text text-xs">{item.name}</span>
              <span
                className="px-1 py-0.5 rounded text-white font-bold text-2xs"
                style={{ background: '#7C2B1A' }}
              >
                {item.team}
              </span>
              {isP ? (
                <span className="ml-auto text-538-muted">
                  ERA {(item as Pitcher).era?.toFixed(2) ?? '—'} · K/9 {(item as Pitcher).k_per_9.toFixed(1)}
                </span>
              ) : (
                <span className="ml-auto text-538-muted">
                  {(item as Player).avg?.toFixed(3) ?? '—'} / {(item as Player).obp?.toFixed(3) ?? '—'} / {(item as Player).slg?.toFixed(3) ?? '—'}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Pitcher panel (expanded) ──────────────────────────────────────────────────

function PitcherPanel({
  pitcher,
  projection,
  pitcherArsenals,
  teamAbbr,
  isTbd,
}: {
  pitcher: SimPitcher
  projection: { avgKs: number; avgBb: number; avgIP: number }
  pitcherArsenals: PitcherArsenal[]
  teamAbbr: string
  isTbd: boolean
}) {
  const arsenal = pitcherArsenals.find((a) => a.player_id === pitcher.playerId)

  return (
    <div>
      <div className="text-2xs font-semibold uppercase tracking-widest text-538-muted mb-2">
        Pitcher Breakdown
      </div>
      <div className="text-sm font-bold text-538-text mb-0.5">{pitcher.name}</div>
      {isTbd && (
        <div className="text-2xs text-amber-700 font-medium mb-2">
          {pitcher.isTeamAvg
            ? `Using ${teamAbbr} staff average stats`
            : 'Using league average stats'}
        </div>
      )}
      {/* Season stats */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        {[
          { label: 'ERA', value: pitcher.era.toFixed(2) },
          { label: 'WHIP', value: pitcher.whip.toFixed(2) },
          { label: 'K/9', value: pitcher.kPer9.toFixed(1) },
          { label: 'BB/9', value: pitcher.bbPer9.toFixed(1) },
        ].map(({ label, value }) => (
          <div key={label} className="text-center">
            <div className="text-2xs text-538-muted uppercase tracking-wider">{label}</div>
            <div className="text-sm font-bold text-538-text">{value}</div>
          </div>
        ))}
      </div>
      {/* Sim projections */}
      <div className="border-t border-538-border pt-2 mb-3">
        <div className="text-2xs text-538-muted mb-1.5 uppercase tracking-wider">Sim Projections (avg/game)</div>
        <div className="flex gap-4 text-xs">
          <div>
            <span className="text-2xs text-538-muted">K </span>
            <span className="font-bold text-538-text text-sm">{projection.avgKs.toFixed(1)}</span>
          </div>
          <div>
            <span className="text-2xs text-538-muted">BB </span>
            <span className="font-semibold text-538-text">{projection.avgBb.toFixed(1)}</span>
          </div>
          <div>
            <span className="text-2xs text-538-muted">IP </span>
            <span className="font-semibold text-538-text">{projection.avgIP.toFixed(1)}</span>
          </div>
        </div>
      </div>
      {/* Pitch arsenal */}
      {arsenal && arsenal.pitches.length > 0 && (
        <div>
          <div className="text-2xs font-semibold uppercase tracking-widest text-538-muted mb-1.5">
            Pitch Arsenal
          </div>
          <table className="w-full text-2xs">
            <thead>
              <tr className="border-b border-538-border text-538-muted">
                <th className="text-left py-1 font-semibold">Pitch</th>
                <th className="text-right py-1 font-semibold">Use%</th>
                <th className="text-right py-1 font-semibold">Velo</th>
                <th className="text-right py-1 font-semibold">BA</th>
              </tr>
            </thead>
            <tbody>
              {arsenal.pitches.slice(0, 6).map((p) => (
                <tr key={p.pitch_type} className="border-b border-538-border last:border-0">
                  <td className="py-1 text-538-text font-medium">{p.pitch_name}</td>
                  <td className="text-right py-1 text-538-text">{p.usage_pct != null ? `${p.usage_pct.toFixed(1)}%` : '—'}</td>
                  <td className="text-right py-1 text-538-text">{p.avg_speed != null ? p.avg_speed.toFixed(1) : '—'}</td>
                  <td className="text-right py-1 text-538-text">{p.woba_against != null ? p.woba_against.toFixed(3).replace(/^0/, '') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Lineup panel (expanded) ───────────────────────────────────────────────────

function LineupPanel({
  lineup,
  projections,
  onSwapBatter,
  onResetBatter,
  origLineup,
}: {
  lineup: SimBatter[]
  projections: { avgBases: number; avgKs: number }[]
  onSwapBatter: (idx: number) => void
  onResetBatter: (idx: number) => void
  origLineup: SimBatter[]
}) {
  return (
    <div>
      <div className="text-2xs font-semibold uppercase tracking-widest text-538-muted mb-1.5">
        Projected Lineup
        <span className="font-normal normal-case ml-1">(sorted by season OPS)</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-2xs">
          <thead>
            <tr className="border-b border-538-border text-538-muted">
              <th className="text-left py-1 font-semibold w-5">#</th>
              <th className="text-left py-1 font-semibold">Player</th>
              <th className="text-right py-1 font-semibold">AVG</th>
              <th className="text-right py-1 font-semibold">OBP</th>
              <th className="text-right py-1 font-semibold">SLG</th>
              <th className="text-right py-1 font-semibold">Exp. Bases</th>
              <th className="text-right py-1 font-semibold">Exp. K</th>
              <th className="py-1 w-5" />
            </tr>
          </thead>
          <tbody>
            {lineup.map((b, i) => {
              const proj = projections[i]
              const changed = b.playerId !== origLineup[i]?.playerId
              return (
                <tr key={i} className="border-b border-538-border last:border-0">
                  <td className="py-1 text-538-muted">{i + 1}</td>
                  <td className="py-1">
                    <span className={`font-medium ${b.isLeagueAvg ? 'text-538-muted italic' : 'text-538-text'}`}>
                      {b.name}
                    </span>
                    {b.team && !b.isLeagueAvg && (
                      <span className="text-538-muted ml-1">{b.team}</span>
                    )}
                    {changed && (
                      <button
                        onClick={() => onResetBatter(i)}
                        className="ml-1 text-2xs text-538-orange underline"
                      >
                        reset
                      </button>
                    )}
                  </td>
                  <td className="text-right py-1 text-538-text">{b.avg.toFixed(3)}</td>
                  <td className="text-right py-1 text-538-text">{b.obp.toFixed(3)}</td>
                  <td className="text-right py-1 text-538-text">{b.slg.toFixed(3)}</td>
                  <td className="text-right py-1 font-semibold text-538-text">{proj?.avgBases.toFixed(1) ?? '—'}</td>
                  <td className="text-right py-1 text-538-text">{proj?.avgKs.toFixed(1) ?? '—'}</td>
                  <td className="py-1 pl-1">
                    <button
                      onClick={() => onSwapBatter(i)}
                      className="text-538-muted hover:text-538-orange text-xs leading-none"
                      title="Swap batter"
                    >
                      ↔
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Matchup Card ──────────────────────────────────────────────────────────────

function MatchupCard({
  game,
  pitchers,
  players,
  pitcherArsenals,
  standings,
  onUpdate,
}: {
  game: GameState
  pitchers: Pitcher[]
  players: Player[]
  pitcherArsenals: PitcherArsenal[]
  standings: TeamStanding[]
  onUpdate: (updates: Partial<GameState>) => void
}) {
  const awayStanding = standings.find((s) => s.team_abbr === game.awayTeamAbbr)
  const homeStanding = standings.find((s) => s.team_abbr === game.homeTeamAbbr)
  const awayElo = awayStanding?.elo_rating ?? 1500
  const homeElo = homeStanding?.elo_rating ?? 1500
  const awayDelta = calcEloDelta(awayElo, homeElo)
  const homeDelta = calcEloDelta(homeElo, awayElo)

  const sr = game.simResults

  const handleSimulate = useCallback(() => {
    const setup: GameSetup = {
      awayTeamName: game.awayTeamName,
      awayTeamAbbr: game.awayTeamAbbr,
      homeTeamName: game.homeTeamName,
      homeTeamAbbr: game.homeTeamAbbr,
      awayLineup: game.awayLineup,
      homeLineup: game.homeLineup,
      awayPitcher: game.awayPitcher,
      homePitcher: game.homePitcher,
    }
    const results = runSimulations(setup, SIM_COUNT)
    onUpdate({ simResults: results })
  }, [game, onUpdate])

  // Auto-simulate when lineup/pitchers are ready
  useEffect(() => {
    if (!game.simResults) handleSimulate()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSwapPitcher(item: Pitcher | Player) {
    const isPitcher = 'k_per_9' in item
    if (!isPitcher) return
    const newPitcher = pitcherFromLocal(item as Pitcher)
    const target = game.swapTarget
    const updates: Partial<GameState> = { swapTarget: null }
    if (target?.type === 'away-pitcher') updates.awayPitcher = newPitcher
    else if (target?.type === 'home-pitcher') updates.homePitcher = newPitcher
    onUpdate(updates)
    // Re-simulate after pitcher change
    setTimeout(() => {
      const setup: GameSetup = {
        awayTeamName: game.awayTeamName,
        awayTeamAbbr: game.awayTeamAbbr,
        homeTeamName: game.homeTeamName,
        homeTeamAbbr: game.homeTeamAbbr,
        awayLineup: game.awayLineup,
        homeLineup: game.homeLineup,
        awayPitcher: target?.type === 'away-pitcher' ? newPitcher : game.awayPitcher,
        homePitcher: target?.type === 'home-pitcher' ? newPitcher : game.homePitcher,
      }
      onUpdate({ simResults: runSimulations(setup, SIM_COUNT) })
    }, 0)
  }

  function handleSwapBatter(team: 'away' | 'home', idx: number, item: Pitcher | Player) {
    if ('k_per_9' in item) return
    const newBatter = batterFromLocal(item as Player)
    const newLineup = team === 'away' ? [...game.awayLineup] : [...game.homeLineup]
    newLineup[idx] = newBatter
    const updates: Partial<GameState> = { swapTarget: null }
    if (team === 'away') updates.awayLineup = newLineup
    else updates.homeLineup = newLineup
    onUpdate(updates)
    setTimeout(() => {
      const setup: GameSetup = {
        awayTeamName: game.awayTeamName,
        awayTeamAbbr: game.awayTeamAbbr,
        homeTeamName: game.homeTeamName,
        homeTeamAbbr: game.homeTeamAbbr,
        awayLineup: team === 'away' ? newLineup : game.awayLineup,
        homeLineup: team === 'home' ? newLineup : game.homeLineup,
        awayPitcher: game.awayPitcher,
        homePitcher: game.homePitcher,
      }
      onUpdate({ simResults: runSimulations(setup, SIM_COUNT) })
    }, 0)
  }

  function handleResetPitcher(side: 'away' | 'home') {
    const updates: Partial<GameState> = { swapTarget: null }
    if (side === 'away') updates.awayPitcher = game.origAwayPitcher
    else updates.homePitcher = game.origHomePitcher
    onUpdate(updates)
    setTimeout(() => {
      const setup: GameSetup = {
        awayTeamName: game.awayTeamName,
        awayTeamAbbr: game.awayTeamAbbr,
        homeTeamName: game.homeTeamName,
        homeTeamAbbr: game.homeTeamAbbr,
        awayLineup: game.awayLineup,
        homeLineup: game.homeLineup,
        awayPitcher: side === 'away' ? game.origAwayPitcher : game.awayPitcher,
        homePitcher: side === 'home' ? game.origHomePitcher : game.homePitcher,
      }
      onUpdate({ simResults: runSimulations(setup, SIM_COUNT) })
    }, 0)
  }

  function handleResetBatter(team: 'away' | 'home', idx: number) {
    const orig = team === 'away' ? game.origAwayLineup : game.origHomeLineup
    const newLineup = team === 'away' ? [...game.awayLineup] : [...game.homeLineup]
    newLineup[idx] = orig[idx]
    const updates: Partial<GameState> = {}
    if (team === 'away') updates.awayLineup = newLineup
    else updates.homeLineup = newLineup
    onUpdate(updates)
    setTimeout(() => {
      const setup: GameSetup = {
        awayTeamName: game.awayTeamName,
        awayTeamAbbr: game.awayTeamAbbr,
        homeTeamName: game.homeTeamName,
        homeTeamAbbr: game.homeTeamAbbr,
        awayLineup: team === 'away' ? newLineup : game.awayLineup,
        homeLineup: team === 'home' ? newLineup : game.homeLineup,
        awayPitcher: game.awayPitcher,
        homePitcher: game.homePitcher,
      }
      onUpdate({ simResults: runSimulations(setup, SIM_COUNT) })
    }, 0)
  }

  const swapTarget = game.swapTarget

  return (
    <div className="border border-538-border rounded-sm bg-white overflow-hidden">
      {/* Collapsed header */}
      <div className="p-4">
        {/* Teams row */}
        <div className="flex items-center justify-between gap-2 mb-3">
          {/* Away */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <img
              src={`https://www.mlbstatic.com/team-logos/${game.awayTeamId}.svg`}
              alt={game.awayTeamAbbr}
              className="w-8 h-8 object-contain flex-shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
            <div className="min-w-0">
              <div className="font-bold text-538-text text-sm leading-tight truncate">{game.awayTeamName}</div>
              <div className="text-2xs text-538-muted leading-tight">
                {game.awayPitcher.isTbd ? (
                  <span className="text-amber-700">
                    SP: TBD — {game.awayPitcher.isTeamAvg ? `${game.awayTeamAbbr} staff avg` : 'league avg'}
                  </span>
                ) : (
                  <span>SP: {game.awayPitcher.name} ({game.awayPitcher.handedness === '?' ? 'RHP' : `${game.awayPitcher.handedness}HP`})</span>
                )}
              </div>
            </div>
          </div>

          <div className="text-538-muted font-light text-lg px-2 flex-shrink-0">vs</div>

          {/* Home */}
          <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
            <div className="min-w-0 text-right">
              <div className="font-bold text-538-text text-sm leading-tight truncate">{game.homeTeamName}</div>
              <div className="text-2xs text-538-muted leading-tight">
                {game.homePitcher.isTbd ? (
                  <span className="text-amber-700">
                    SP: TBD — {game.homePitcher.isTeamAvg ? `${game.homeTeamAbbr} staff avg` : 'league avg'}
                  </span>
                ) : (
                  <span>SP: {game.homePitcher.name} ({game.homePitcher.handedness === '?' ? 'RHP' : `${game.homePitcher.handedness}HP`})</span>
                )}
              </div>
            </div>
            <img
              src={`https://www.mlbstatic.com/team-logos/${game.homeTeamId}.svg`}
              alt={game.homeTeamAbbr}
              className="w-8 h-8 object-contain flex-shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          </div>
        </div>

        {/* Sim results row */}
        {sr ? (
          <div className="grid grid-cols-3 gap-2 mb-3 text-center">
            <div>
              <div className="text-2xs text-538-muted uppercase tracking-wider mb-0.5">Away Win</div>
              <div className="text-2xl font-black text-538-orange">{(sr.awayWinPct * 100).toFixed(0)}%</div>
              <div className="text-2xs text-538-muted">±{(sr.confidenceInterval * 100).toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-2xs text-538-muted uppercase tracking-wider mb-0.5">Proj. Score</div>
              <div className="text-base font-bold text-538-text mt-1">
                {sr.avgAwayRuns.toFixed(1)} — {sr.avgHomeRuns.toFixed(1)}
              </div>
            </div>
            <div>
              <div className="text-2xs text-538-muted uppercase tracking-wider mb-0.5">Home Win</div>
              <div className="text-2xl font-black text-538-orange">{(sr.homeWinPct * 100).toFixed(0)}%</div>
              <div className="text-2xs text-538-muted">±{(sr.confidenceInterval * 100).toFixed(1)}%</div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center py-4 text-2xs text-538-muted">
            Simulating…
          </div>
        )}

        {/* ELO deltas */}
        <div className="flex items-center justify-between text-2xs mb-3 border-t border-538-border pt-2">
          <div className="flex gap-3">
            <span>ELO win: <span className="font-bold text-538-green">+{awayDelta.winDelta}</span></span>
            <span>lose: <span className="font-bold text-538-red">{awayDelta.lossDelta}</span></span>
            <span className="text-538-border">|</span>
            <span className="text-538-muted">{game.awayTeamAbbr} ELO: {awayElo.toFixed(0)}</span>
          </div>
          <div className="flex gap-3">
            <span className="text-538-muted">{game.homeTeamAbbr} ELO: {homeElo.toFixed(0)}</span>
            <span className="text-538-border">|</span>
            <span>ELO win: <span className="font-bold text-538-green">+{homeDelta.winDelta}</span></span>
            <span>lose: <span className="font-bold text-538-red">{homeDelta.lossDelta}</span></span>
          </div>
        </div>

        {/* Action row */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => onUpdate({ swapTarget: swapTarget?.type === 'away-pitcher' ? null : { type: 'away-pitcher' } })}
            className="text-2xs border border-538-border rounded px-2 py-1 text-538-muted hover:border-538-orange hover:text-538-orange transition-colors"
          >
            {game.awayPitcher.isTbd ? '+ Select Away SP' : 'Swap Away SP'}
          </button>
          <button
            onClick={() => onUpdate({ swapTarget: swapTarget?.type === 'home-pitcher' ? null : { type: 'home-pitcher' } })}
            className="text-2xs border border-538-border rounded px-2 py-1 text-538-muted hover:border-538-orange hover:text-538-orange transition-colors"
          >
            {game.homePitcher.isTbd ? '+ Select Home SP' : 'Swap Home SP'}
          </button>
          <button
            onClick={handleSimulate}
            className="text-2xs border border-538-border rounded px-2 py-1 text-538-muted hover:border-538-orange hover:text-538-orange transition-colors ml-auto"
          >
            Re-run
          </button>
          <button
            onClick={() => onUpdate({ expanded: !game.expanded })}
            className="text-2xs border border-538-border rounded px-2 py-1 text-538-muted hover:bg-538-bg transition-colors flex items-center gap-1"
          >
            <span className={`inline-block transition-transform ${game.expanded ? 'rotate-180' : ''}`}>▼</span>
            {game.expanded ? 'Collapse' : 'Expand Details'}
          </button>
        </div>

        {/* Swap pitcher search */}
        {(swapTarget?.type === 'away-pitcher' || swapTarget?.type === 'home-pitcher') && (
          <SwapSearch
            pitchers={pitchers}
            players={players}
            target={swapTarget}
            onSelect={(item) => handleSwapPitcher(item)}
            onReset={() => handleResetPitcher(swapTarget.type === 'away-pitcher' ? 'away' : 'home')}
            onClose={() => onUpdate({ swapTarget: null })}
          />
        )}
      </div>

      {/* Expanded details */}
      {game.expanded && sr && (
        <div className="border-t border-538-border bg-538-bg px-4 py-4 space-y-6">
          {/* Swap batter search (inline above lineup) */}
          {(swapTarget?.type === 'away-batter' || swapTarget?.type === 'home-batter') && (
            <SwapSearch
              pitchers={pitchers}
              players={players}
              target={swapTarget}
              onSelect={(item) => {
                if (swapTarget.type === 'away-batter' || swapTarget.type === 'home-batter') {
                  const team = swapTarget.type === 'away-batter' ? 'away' : 'home'
                  handleSwapBatter(team, swapTarget.idx, item)
                }
              }}
              onReset={() => {
                const team = swapTarget.type === 'away-batter' ? 'away' : 'home'
                handleResetBatter(team, swapTarget.idx)
              }}
              onClose={() => onUpdate({ swapTarget: null })}
            />
          )}

          {/* Two-column pitch/lineup panels */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Away side */}
            <div className="space-y-4">
              <div className="text-2xs font-bold uppercase tracking-widest text-538-muted border-b border-538-border pb-1">
                {game.awayTeamAbbr} — Away
              </div>
              <PitcherPanel
                pitcher={game.awayPitcher}
                projection={sr.awayPitcherProjection}
                pitcherArsenals={pitcherArsenals}
                teamAbbr={game.awayTeamAbbr}
                isTbd={!!game.awayPitcher.isTbd}
              />
              <LineupPanel
                lineup={game.awayLineup}
                projections={sr.awayBatterProjections}
                onSwapBatter={(idx) => onUpdate({ swapTarget: { type: 'away-batter', idx } })}
                onResetBatter={(idx) => handleResetBatter('away', idx)}
                origLineup={game.origAwayLineup}
              />
            </div>

            {/* Home side */}
            <div className="space-y-4">
              <div className="text-2xs font-bold uppercase tracking-widest text-538-muted border-b border-538-border pb-1">
                {game.homeTeamAbbr} — Home
              </div>
              <PitcherPanel
                pitcher={game.homePitcher}
                projection={sr.homePitcherProjection}
                pitcherArsenals={pitcherArsenals}
                teamAbbr={game.homeTeamAbbr}
                isTbd={!!game.homePitcher.isTbd}
              />
              <LineupPanel
                lineup={game.homeLineup}
                projections={sr.homeBatterProjections}
                onSwapBatter={(idx) => onUpdate({ swapTarget: { type: 'home-batter', idx } })}
                onResetBatter={(idx) => handleResetBatter('home', idx)}
                origLineup={game.origHomeLineup}
              />
            </div>
          </div>

          {/* Run distribution */}
          <div className="border border-538-border rounded-sm bg-white p-4">
            <RunDistChart
              simResults={sr}
              awayAbbr={game.awayTeamAbbr}
              homeAbbr={game.homeTeamAbbr}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main MatchupLab component ─────────────────────────────────────────────────

export default function MatchupLab({
  standings,
  pitchers,
  players,
  pitcherArsenals,
}: {
  standings: TeamStanding[]
  pitchers: Pitcher[]
  players: Player[]
  pitcherArsenals: PitcherArsenal[]
}) {
  const [mode, setMode] = useState<'date' | 'teams'>('date')
  const [date, setDate] = useState(todayStr)
  const [awayTeamId, setAwayTeamId] = useState<number>(147)  // NYY default
  const [homeTeamId, setHomeTeamId] = useState<number>(111)  // BOS default
  const [games, setGames] = useState<GameState[]>([])
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [scheduleError, setScheduleError] = useState<string | null>(null)

  // Build a GameState from schedule info + local data
  const buildGameState = useCallback(
    (sg: ScheduleGame): GameState => {
      const awayAbbr = TEAM_ID_TO_ABBR[sg.awayTeamId] ?? 'UNK'
      const homeAbbr = TEAM_ID_TO_ABBR[sg.homeTeamId] ?? 'UNK'

      // Probable pitcher lookup
      const awayLocalP = sg.awayPitcherId
        ? pitchers.find((p) => p.player_id === sg.awayPitcherId)
        : null
      const homeLocalP = sg.homePitcherId
        ? pitchers.find((p) => p.player_id === sg.homePitcherId)
        : null

      const awayPitcher = awayLocalP
        ? pitcherFromLocal(awayLocalP)
        : sg.awayPitcherName
          ? { ...LEAGUE_AVG_PITCHER, playerId: sg.awayPitcherId ?? -1, name: sg.awayPitcherName, isTbd: false }
          : teamAvgPitcher(awayAbbr, sg.awayTeamName, pitchers)
      const homePitcher = homeLocalP
        ? pitcherFromLocal(homeLocalP)
        : sg.homePitcherName
          ? { ...LEAGUE_AVG_PITCHER, playerId: sg.homePitcherId ?? -1, name: sg.homePitcherName, isTbd: false }
          : teamAvgPitcher(homeAbbr, sg.homeTeamName, pitchers)

      const awayLineup = buildLineup(awayAbbr, players)
      const homeLineup = buildLineup(homeAbbr, players)

      return {
        gameId: sg.gamePk,
        awayTeamId: sg.awayTeamId,
        homeTeamId: sg.homeTeamId,
        awayTeamName: sg.awayTeamName,
        homeTeamName: sg.homeTeamName,
        awayTeamAbbr: awayAbbr,
        homeTeamAbbr: homeAbbr,
        awayPitcher,
        homePitcher,
        origAwayPitcher: awayPitcher,
        origHomePitcher: homePitcher,
        awayLineup,
        homeLineup,
        origAwayLineup: awayLineup,
        origHomeLineup: homeLineup,
        simResults: null,
        expanded: false,
        swapTarget: null,
      }
    },
    [pitchers, players],
  )

  // Load date schedule
  const loadDateSchedule = useCallback(async () => {
    setScheduleLoading(true)
    setScheduleError(null)
    setGames([])
    try {
      const schedule = await fetchSchedule(date)
      const newGames = schedule.map(buildGameState)
      setGames(newGames)
    } catch (err) {
      setScheduleError(String(err))
    } finally {
      setScheduleLoading(false)
    }
  }, [date, buildGameState])

  // Build two-team matchup (no API needed)
  const buildTeamMatchup = useCallback(() => {
    const awayTeam = MLB_TEAMS.find((t) => t.id === awayTeamId)!
    const homeTeam = MLB_TEAMS.find((t) => t.id === homeTeamId)!
    const sg: ScheduleGame = {
      gamePk: Date.now(),
      gameDate: date,
      awayTeamId,
      homeTeamId,
      awayTeamName: awayTeam.name,
      homeTeamName: homeTeam.name,
      awayPitcherId: null,
      awayPitcherName: null,
      homePitcherId: null,
      homePitcherName: null,
    }
    setGames([buildGameState(sg)])
    setScheduleError(null)
  }, [awayTeamId, homeTeamId, date, buildGameState])

  // Auto-load date mode on mount
  useEffect(() => {
    if (mode === 'date') loadDateSchedule()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function updateGame(gameId: number, updates: Partial<GameState>) {
    setGames((prev) =>
      prev.map((g) => (g.gameId === gameId ? { ...g, ...updates } : g)),
    )
  }

  return (
    <div className="space-y-6">
      {/* Mode toggle */}
      <div className="flex items-center gap-2">
        {(['date', 'teams'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-1.5 text-xs font-semibold uppercase tracking-wide rounded-sm border transition-colors ${
              mode === m
                ? 'bg-538-orange text-white border-538-orange'
                : 'border-538-border text-538-muted hover:text-538-text hover:border-538-text'
            }`}
          >
            {m === 'date' ? 'By Date' : 'Two Teams'}
          </button>
        ))}
      </div>

      {/* Controls */}
      {mode === 'date' && (
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-538-border rounded-sm px-3 py-1.5 text-sm text-538-text bg-white outline-none focus:border-538-orange"
          />
          <button
            onClick={loadDateSchedule}
            disabled={scheduleLoading}
            className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide rounded-sm bg-538-orange text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {scheduleLoading ? 'Loading…' : 'Load Schedule'}
          </button>
        </div>
      )}

      {mode === 'teams' && (
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <label className="block text-2xs font-semibold uppercase tracking-widest text-538-muted mb-1">
              Away
            </label>
            <select
              value={awayTeamId}
              onChange={(e) => setAwayTeamId(Number(e.target.value))}
              className="border border-538-border rounded-sm px-3 py-1.5 text-sm text-538-text bg-white outline-none focus:border-538-orange"
            >
              {MLB_TEAMS.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="text-538-muted text-lg mt-4">@</div>
          <div>
            <label className="block text-2xs font-semibold uppercase tracking-widest text-538-muted mb-1">
              Home
            </label>
            <select
              value={homeTeamId}
              onChange={(e) => setHomeTeamId(Number(e.target.value))}
              className="border border-538-border rounded-sm px-3 py-1.5 text-sm text-538-text bg-white outline-none focus:border-538-orange"
            >
              {MLB_TEAMS.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-2xs font-semibold uppercase tracking-widest text-538-muted mb-1">
              Date (optional)
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border border-538-border rounded-sm px-3 py-1.5 text-sm text-538-text bg-white outline-none focus:border-538-orange"
            />
          </div>
          <div className="mt-4">
            <button
              onClick={buildTeamMatchup}
              className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide rounded-sm bg-538-orange text-white hover:opacity-90 transition-opacity"
            >
              Run Simulation
            </button>
          </div>
        </div>
      )}

      {/* Error state */}
      {scheduleError && (
        <div className="border border-red-200 bg-red-50 rounded-sm px-4 py-3 text-sm text-red-700">
          Could not load game data. MLB Stats API may be unavailable.{' '}
          <button
            onClick={mode === 'date' ? loadDateSchedule : buildTeamMatchup}
            className="underline font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading skeletons */}
      {scheduleLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="border border-538-border rounded-sm bg-white p-4 animate-pulse">
              <div className="flex justify-between mb-3">
                <div className="h-8 bg-538-border rounded w-40" />
                <div className="h-8 bg-538-border rounded w-40" />
              </div>
              <div className="grid grid-cols-3 gap-4 mb-3">
                <div className="h-10 bg-538-bg rounded" />
                <div className="h-10 bg-538-bg rounded" />
                <div className="h-10 bg-538-bg rounded" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No games state */}
      {!scheduleLoading && !scheduleError && games.length === 0 && mode === 'date' && (
        <div className="border border-538-border rounded-sm bg-white px-4 py-10 text-center text-538-muted text-sm">
          No games found for {date}. Try a different date or switch to Two Teams mode.
        </div>
      )}

      {/* Game cards */}
      {!scheduleLoading && games.length > 0 && (
        <div className="space-y-4">
          {mode === 'date' && games.length > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-2xs text-538-muted">{games.length} games on {date}</span>
              <button
                onClick={() => {
                  setGames((prev) =>
                    prev.map((g) => {
                      const setup: GameSetup = {
                        awayTeamName: g.awayTeamName,
                        awayTeamAbbr: g.awayTeamAbbr,
                        homeTeamName: g.homeTeamName,
                        homeTeamAbbr: g.homeTeamAbbr,
                        awayLineup: g.awayLineup,
                        homeLineup: g.homeLineup,
                        awayPitcher: g.awayPitcher,
                        homePitcher: g.homePitcher,
                      }
                      return { ...g, simResults: runSimulations(setup, SIM_COUNT) }
                    }),
                  )
                }}
                className="text-xs font-semibold border border-538-border rounded-sm px-3 py-1 text-538-muted hover:text-538-orange hover:border-538-orange transition-colors"
              >
                Simulate All Games
              </button>
            </div>
          )}
          {games.map((game) => (
            <MatchupCard
              key={game.gameId}
              game={game}
              pitchers={pitchers}
              players={players}
              pitcherArsenals={pitcherArsenals}
              standings={standings}
              onUpdate={(updates) => updateGame(game.gameId, updates)}
            />
          ))}
        </div>
      )}

      {/* Footer note */}
      <p className="text-2xs text-538-muted">
        <strong>Sim methodology —</strong> Each game runs {SIM_COUNT} Monte Carlo simulations using batter season K%, BB%, BABIP, and HR rate adjusted by pitcher K/9, BB/9, and HR/9 relative to league averages. Pitcher fatigue applies after ~100 pitches. Lineups are sorted by season OPS. Stats from 2025 season data; probable pitchers from MLB Stats API.
      </p>
    </div>
  )
}

// Re-export helpers so the page component can use them
export { pitcherFromLocal, batterFromLocal }
