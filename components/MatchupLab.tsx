'use client'

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import dynamic from 'next/dynamic'
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
import { LogicBreakdown, Code } from './LogicBreakdown'
import { PITCH_COLORS } from '../lib/pitchColors'
const GameBreakdown = dynamic(() => import('./GameBreakdown'), { ssr: false })

// ── Constants ─────────────────────────────────────────────────────────────────

const MLB_STATS_API = 'https://statsapi.mlb.com/api/v1'
const SIM_COUNT = 500

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

// ── Base diamond (live game) ──────────────────────────────────────────────────

function BaseDiamond({ bases, outs }: { bases: { first: boolean; second: boolean; third: boolean }; outs: number }) {
  const sq = (cx: number, cy: number, on: boolean) => (
    <rect x={cx - 4} y={cy - 4} width={8} height={8} transform={`rotate(45 ${cx} ${cy})`}
      fill={on ? '#E5E7EB' : 'transparent'} stroke="#6B7280" strokeWidth={1} rx={0.5} />
  )
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={32} height={28} viewBox="0 0 32 28">
        <polyline points="16,2 28,13 16,24 4,13 16,2" fill="none" stroke="#374151" strokeWidth={1} />
        {sq(16, 2,  bases.second)}
        {sq(28, 13, bases.first)}
        {sq(16, 24, false)}
        {sq(4,  13, bases.third)}
      </svg>
      <div className="flex gap-1">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-2 h-2 rounded-full" style={{ backgroundColor: i < outs ? '#F97316' : '#374151' }} />
        ))}
      </div>
    </div>
  )
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
  awayScore: number | null
  homeScore: number | null
  gameStatus: string  // "Preview" | "Live" | "Final"
  inning: number | null
  inningHalf: string | null
  outs: number | null
  bases: { first: boolean; second: boolean; third: boolean } | null
}

async function fetchSchedule(date: string): Promise<ScheduleGame[]> {
  const url = `${MLB_STATS_API}/schedule?sportId=1&date=${date}&hydrate=probablePitcher,team,linescore`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  const games: ScheduleGame[] = []
  for (const dateEntry of data.dates ?? []) {
    for (const game of dateEntry.games ?? []) {
      const status: string = game.status?.abstractGameState ?? 'Preview'
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
        awayScore: game.teams.away.score ?? null,
        homeScore: game.teams.home.score ?? null,
        gameStatus: status,
        inning: game.linescore?.currentInning ?? null,
        inningHalf: game.linescore?.inningHalf ?? null,
        outs: status === 'Live' ? (game.linescore?.outs ?? null) : null,
        bases: status === 'Live' ? {
          first:  !!game.linescore?.offense?.first,
          second: !!game.linescore?.offense?.second,
          third:  !!game.linescore?.offense?.third,
        } : null,
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
  awayScore: number | null
  homeScore: number | null
  gameStatus: string
  inning: number | null
  inningHalf: string | null
  outs: number | null
  bases: { first: boolean; second: boolean; third: boolean } | null
  breakdownOpen: boolean
  liveOpen: boolean
}

// ── Live Game Panel ───────────────────────────────────────────────────────────

interface AbPitch {
  type: string; desc: string; code: string; result: string
  balls: number; strikes: number; speed: number | null
  pX: number | null; pZ: number | null
}
interface LivePlay {
  description: string; eventType: string
  inning: number; half: string; ordinalNum: string; rbi: number
  awayScore: number | null; homeScore: number | null
}
interface LiveState {
  gameState: string
  awayAbbr: string; homeAbbr: string
  awayScore: number | null; homeScore: number | null
  inning: number | null; inningHalf: string | null; outs: number
  bases: { first: boolean; second: boolean; third: boolean }
  batterId: number | null; batterName: string | null; batterStand: string; batterTeam: string
  pitcherId: number | null; pitcherName: string | null; pitcherHand: string; pitcherTeam: string
  count: { balls: number; strikes: number }
  abPitches: AbPitch[]
  currentPitcherStats: { ip: string; k: number; bb: number; hits: number; er: number; pc: number } | null
  batterGameStats: { ab: number; h: number; hr: number; rbi: number; bb: number; k: number; lob: number } | null
  recentPlays: LivePlay[]
}
interface MiniZoneCell { row: number; col: number; pa: number; avg_rv: number | null; ops: number | null }
interface MiniZoneData {
  zones: MiniZoneCell[][]
  pitchTypeZones: Array<{ code: string; name: string; zones: MiniZoneCell[][] }>
  batterName: string; stand: string
  seasonStats: { k_pct: number; bb_pct: number; avg: number; slg: number; hr: number; pa: number } | null
}
interface PitchMixEntry { type: string; name: string; color: string; pct: number; whiffPct: number | null; strikePct: number | null }
interface BatterPitchStat { type: string; whiff: number | null; ops: number | null; rv: number | null; count: number }

// Use the shared palette from lib/pitchColors (same as pitcher pages)
const PITCH_COLORS_LIVE = PITCH_COLORS
const LIVE_RESULT_COLOR: Record<string, string> = {
  B:'#60a5fa',S:'#f87171',C:'#f87171',F:'#fcd34d',X:'#4ade80',
}
const FB_TYPES = new Set(['FF','SI','FT','FC'])

// Count adjustment multipliers for AB outcome prediction
const COUNT_K_MULT: Record<string, number> = {
  '0-0':1.0,'0-1':1.25,'0-2':1.80,
  '1-0':0.85,'1-1':1.05,'1-2':1.50,
  '2-0':0.65,'2-1':0.90,'2-2':1.30,
  '3-0':0.30,'3-1':0.60,'3-2':1.15,
}
const COUNT_BB_MULT: Record<string, number> = {
  '0-0':1.0,'0-1':0.75,'0-2':0.45,
  '1-0':1.15,'1-1':0.90,'1-2':0.60,
  '2-0':1.40,'2-1':1.15,'2-2':0.80,
  '3-0':2.50,'3-1':1.70,'3-2':1.30,
}

function liveClamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)) }

function rvHeatColor(val: number | null, absMax: number): string {
  if (val == null) return 'transparent'
  const t = liveClamp(val / (absMax || 0.001), -1, 1)
  if (t >= 0) {
    // neutral → red (batter-friendly)
    const r = 220, g = Math.round(220 - 170 * t), b = Math.round(220 - 170 * t)
    return `rgb(${r},${g},${b})`
  } else {
    // neutral → blue (pitcher-friendly)
    const s = -t
    const r = Math.round(220 - 160 * s), g = Math.round(220 - 120 * s), b = 220
    return `rgb(${r},${g},${b})`
  }
}

// Savant-style smooth heatmap using SVG blur filter
// Strike zone is a vertical rectangle (~1.45:1 H:W ratio like real zone)
function SavantHeatmap({ zones, pitchLabel }: { zones: MiniZoneCell[][]; pitchLabel?: string }) {
  const CW = 30, CH = 44, COLS = 5, ROWS = 5
  const W = CW * COLS, H = CH * ROWS
  const vals = zones.flat().map(c => c.avg_rv).filter((v): v is number => v != null)
  if (!vals.length) return (
    <div style={{width: W, height: H}} className="flex items-center justify-center bg-538-border/10 rounded">
      <span className="text-xs text-538-muted">No data</span>
    </div>
  )
  const absMax = Math.max(Math.abs(Math.min(...vals)), Math.abs(Math.max(...vals)), 0.01)
  const filterId = `blur-${(pitchLabel ?? 'all').replace(/\W/g, '')}`
  return (
    <div style={{ position: 'relative', display: 'inline-block', lineHeight: 0 }}>
      <svg width={W} height={H} style={{ display: 'block', borderRadius: 4 }}>
        <defs>
          <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" />
          </filter>
        </defs>
        {/* Blurred color layer */}
        <g filter={`url(#${filterId})`}>
          {zones.map((row, r) => row.map((cell, c) => (
            <rect key={`${r}-${c}`}
              x={c * CW} y={r * CH} width={CW} height={CH}
              fill={rvHeatColor(cell.avg_rv, absMax)} />
          )))}
        </g>
        {/* Strike zone overlay — sharp, inner 3×3 cells */}
        <rect x={CW} y={CH} width={CW * 3} height={CH * 3}
          fill="none" stroke="rgba(148,163,184,0.85)" strokeWidth={2} />
        {/* Plate center line */}
        <line x1={CW * 2.5} y1={CH * 4 + 3} x2={CW * 2.5} y2={H}
          stroke="rgba(100,116,139,0.4)" strokeWidth={1} strokeDasharray="3,3" />
      </svg>
      {pitchLabel && (
        <div className="absolute top-1.5 left-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded"
          style={{ background: 'rgba(15,23,42,0.75)', color: '#94A3B8' }}>
          {pitchLabel}
        </div>
      )}
    </div>
  )
}

// Mini pitch-location zone — plots each pitch in the current AB on a strike zone
function AbPitchZone({ pitches }: { pitches: AbPitch[] }) {
  const W = 116, H = 148
  // MLB coordinate bounds for the view window
  const VX1 = -1.65, VX2 = 1.65, VZ1 = 0.8, VZ2 = 4.3
  // Strike zone (rule book: SZ_X = ±8.5in = ±0.708ft, SZ_Z = 1.5–3.5ft)
  const SZX1 = -0.83, SZX2 = 0.83, SZZ1 = 1.5, SZZ2 = 3.5

  function sx(px: number) { return (px - VX1) / (VX2 - VX1) * W }
  function sy(pz: number) { return (1 - (pz - VZ1) / (VZ2 - VZ1)) * H }

  const zoneX = sx(SZX1), zoneY = sy(SZZ2)
  const zoneW = sx(SZX2) - zoneX, zoneH = sy(SZZ1) - zoneY

  // Pitch dot color by result type
  function dotStyle(p: AbPitch): { fill: string; stroke: string } {
    const color = PITCH_COLORS_LIVE[p.type] ?? '#78909C'
    const isBall = p.code === 'B'
    return { fill: isBall ? 'transparent' : color, stroke: isBall ? '#4ade80' : color }
  }

  return (
    <div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {/* Strike zone */}
        <rect x={zoneX} y={zoneY} width={zoneW} height={zoneH}
          fill="rgba(255,255,255,0.04)" stroke="rgba(148,163,184,0.65)" strokeWidth={1.5} rx={1} />
        {/* Thirds grid */}
        {[1/3, 2/3].map(t => (
          <g key={t}>
            <line x1={zoneX + zoneW*t} y1={zoneY} x2={zoneX + zoneW*t} y2={zoneY+zoneH} stroke="rgba(148,163,184,0.18)" strokeWidth={0.8}/>
            <line x1={zoneX} y1={zoneY + zoneH*t} x2={zoneX+zoneW} y2={zoneY + zoneH*t} stroke="rgba(148,163,184,0.18)" strokeWidth={0.8}/>
          </g>
        ))}
        {/* Home plate silhouette */}
        <polygon
          points={`${W/2-9},${H-6} ${W/2+9},${H-6} ${W/2+11},${H-4} ${W/2},${H-1} ${W/2-11},${H-4}`}
          fill="rgba(148,163,184,0.25)" />
        {/* Pitches — oldest first so latest is on top */}
        {pitches.map((p, i) => {
          if (p.pX == null || p.pZ == null) return null
          const x = sx(p.pX), y = sy(p.pZ)
          const { fill, stroke } = dotStyle(p)
          const isStrike = p.code !== 'B'
          return (
            <g key={i}>
              <circle cx={x} cy={y} r={7} fill={fill} stroke={stroke} strokeWidth={isStrike ? 0 : 2} opacity={0.88} />
              <text x={x} y={y} textAnchor="middle" dominantBaseline="middle"
                fontSize={5.5} fontWeight="bold" fill={isStrike ? '#fff' : stroke}>
                {i + 1}
              </text>
            </g>
          )
        })}
      </svg>
      <p className="text-[9px] text-538-muted mt-0.5 text-center">Catcher&apos;s view · filled = strike</p>
    </div>
  )
}

function LivePitchDot({ pitch, idx }: { pitch: AbPitch; idx: number }) {
  const ptColor = PITCH_COLORS_LIVE[pitch.type] ?? '#78909C'
  const resColor = LIVE_RESULT_COLOR[pitch.code] ?? '#9CA3AF'
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-xs font-mono text-538-muted w-4 text-right shrink-0">{idx + 1}</span>
      <span className="text-xs font-bold w-8 shrink-0" style={{ color: ptColor }}>{pitch.type || '??'}</span>
      {pitch.speed && <span className="text-xs font-mono text-538-muted w-8 shrink-0">{pitch.speed}</span>}
      <span className="text-xs font-mono flex-1" style={{ color: resColor }}>{pitch.result || pitch.code}</span>
      <span className="text-xs font-mono text-538-muted shrink-0">{pitch.balls}-{pitch.strikes}</span>
    </div>
  )
}

function MatchupTable({ pitchMix, batterStats }: {
  pitchMix: PitchMixEntry[]
  batterStats: BatterPitchStat[] | null
}) {
  const headerCls = "text-xs font-bold uppercase tracking-wider text-538-muted pb-2 text-right px-2"
  const cellCls   = "text-xs font-mono text-right py-1 px-2"
  const batMap = new Map(batterStats?.map(b => [b.type, b]) ?? [])

  return (
    <div className="overflow-x-auto">
      <table style={{ borderCollapse: 'collapse', minWidth: 520 }}>
        <thead>
          <tr>
            <th className="text-left pb-2 text-xs font-bold uppercase tracking-wider text-538-muted px-2">Pitch</th>
            <th className={headerCls}>Use%</th>
            <th className={headerCls}>P Whiff%</th>
            <th className={headerCls}>P Str%</th>
            <th className={headerCls}>B Whiff%</th>
            <th className={headerCls}>B OPS</th>
            <th className={headerCls}>B RV/100</th>
            <th className="pb-2 px-2" />
          </tr>
        </thead>
        <tbody>
          {pitchMix.slice(0, 7).map(p => {
            const b = batMap.get(p.type)
            const edgeScore =
              ((p.whiffPct ?? 22) - 22) / 22 * 0.35
              + ((p.strikePct ?? 62) - 62) / 20 * 0.25
              - ((b?.ops ?? 0.700) - 0.700) / 0.300 * 0.40
            const edgeLabel = edgeScore > 0.15 ? '← P' : edgeScore < -0.12 ? 'B →' : '~'
            const edgeColor = edgeScore > 0.15 ? '#4ade80' : edgeScore < -0.12 ? '#f87171' : '#6b7280'
            return (
              <tr key={p.type} className="border-t border-538-border/40">
                <td className="py-1.5 px-2">
                  <span className="text-sm font-bold" style={{ color: p.color }}>{p.type}</span>
                  <span className="text-xs text-538-muted ml-2">{p.name}</span>
                </td>
                <td className={cellCls}>{p.pct}%</td>
                <td className={cellCls + (p.whiffPct != null && p.whiffPct > 28 ? ' text-green-400' : '')}>
                  {p.whiffPct != null ? p.whiffPct.toFixed(0) + '%' : '—'}
                </td>
                <td className={cellCls}>
                  {p.strikePct != null ? p.strikePct.toFixed(0) + '%' : '—'}
                </td>
                <td className={cellCls + (b?.whiff != null && b.whiff > 28 ? ' text-green-400' : b?.whiff != null && b.whiff < 18 ? ' text-red-400' : '')}>
                  {b?.whiff != null ? b.whiff.toFixed(0) + '%' : '—'}
                </td>
                <td className={cellCls + (b?.ops != null && b.ops > 0.800 ? ' text-red-400' : b?.ops != null && b.ops < 0.600 ? ' text-green-400' : '')}>
                  {b?.ops != null ? b.ops.toFixed(3) : '—'}
                </td>
                <td className={cellCls + (b?.rv != null && b.rv > 0 ? ' text-red-400' : b?.rv != null && b.rv < 0 ? ' text-green-400' : '')}>
                  {b?.rv != null ? (b.rv >= 0 ? '+' : '') + b.rv.toFixed(1) : '—'}
                </td>
                <td className="py-1.5 px-2 text-right text-xs font-bold" style={{ color: edgeColor }}>{edgeLabel}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="text-xs text-538-muted mt-1 px-2">← P = pitcher edge &nbsp;·&nbsp; B → = batter edge</p>
    </div>
  )
}

function AbOutcomeBar({ k, bb, hr, h, out }: { k: number; bb: number; hr: number; h: number; out: number }) {
  const segments = [
    { label: 'K',   pct: k,   color: '#f87171' },
    { label: 'BB',  pct: bb,  color: '#60a5fa' },
    { label: 'HR',  pct: hr,  color: '#fbbf24' },
    { label: 'H',   pct: h,   color: '#4ade80' },
    { label: 'Out', pct: out, color: '#6b7280' },
  ]
  return (
    <div className="space-y-2">
      {segments.map(s => (
        <div key={s.label} className="flex items-center gap-2">
          <span className="text-xs font-bold text-538-muted w-7 text-right shrink-0">{s.label}</span>
          <div className="flex-1 bg-538-border/20 rounded-full overflow-hidden h-3">
            <div className="h-full rounded-full" style={{ width: `${Math.round(s.pct * 100)}%`, backgroundColor: s.color }} />
          </div>
          <span className="text-xs font-mono text-538-text w-9 text-left shrink-0">{(s.pct * 100).toFixed(0)}%</span>
        </div>
      ))}
    </div>
  )
}

function NextPitchPred({ pitchMix, balls, strikes, lastType }: {
  pitchMix: PitchMixEntry[]
  balls: number; strikes: number; lastType: string | null
}) {
  const fbAdj = balls >= 3 ? 1.4 : balls >= 2 ? 1.15 : strikes >= 2 ? 0.8 : 1.0
  const raw: Record<string, number> = {}
  pitchMix.forEach(p => {
    const isFb = FB_TYPES.has(p.type)
    const mult = isFb ? fbAdj : (fbAdj > 1 ? 1 / Math.sqrt(fbAdj) : 1)
    const seqPenalty = p.type === lastType && !isFb ? 0.72 : 1.0
    raw[p.type] = (p.pct / 100) * mult * seqPenalty
  })
  const total = Object.values(raw).reduce((s, v) => s + v, 0) || 1
  const preds = pitchMix
    .map(p => ({ ...p, adjPct: Math.round((raw[p.type] ?? 0) / total * 100) }))
    .sort((a, b) => b.adjPct - a.adjPct)
    .slice(0, 4)
  return (
    <div className="space-y-2">
      {preds.map(p => (
        <div key={p.type} className="flex items-center gap-2">
          <span className="text-xs font-bold w-7 shrink-0" style={{ color: p.color }}>{p.type}</span>
          <div className="flex-1 bg-538-border/20 rounded-full overflow-hidden h-3">
            <div className="h-full rounded-full" style={{ width: `${p.adjPct}%`, backgroundColor: p.color }} />
          </div>
          <span className="text-xs font-mono text-538-text w-9 text-left shrink-0">{p.adjPct}%</span>
        </div>
      ))}
    </div>
  )
}

function PlayByPlayFeed({ plays, batterGameStats, batterName, awayAbbr, homeAbbr, batterId }: {
  plays: LivePlay[]
  batterGameStats: LiveState['batterGameStats']
  batterName: string | null; awayAbbr: string; homeAbbr: string; batterId: number | null
}) {
  const [showBox, setShowBox] = useState(false)
  const HALF_ICONS: Record<string, string> = { top: '▲', bottom: '▼', 'Top': '▲', 'Bottom': '▼' }
  const RESULT_COLORS: Record<string, string> = {
    home_run:'#FBBF24', single:'#4ADE80', double:'#34D399', triple:'#34D399',
    walk:'#60A5FA', hit_by_pitch:'#60A5FA', strikeout:'#9CA3AF', strikeout_double_play:'#9CA3AF',
  }
  return (
    <div className="border-t border-538-border/50 pt-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold uppercase tracking-widest text-538-muted">Recent Plays</div>
        {batterGameStats && (
          <button onClick={() => setShowBox(v => !v)}
            className="text-xs font-bold text-538-muted hover:text-538-text transition-colors">
            {batterName?.split(' ').slice(-1)[0]} today {showBox ? '▲' : '▼'}
          </button>
        )}
      </div>
      {showBox && batterGameStats && (
        <div className="bg-538-border/10 rounded-lg px-4 py-3 flex gap-5 flex-wrap">
          {[
            ['AB', batterGameStats.ab], ['H', batterGameStats.h],
            ['HR', batterGameStats.hr], ['RBI', batterGameStats.rbi],
            ['BB', batterGameStats.bb], ['K', batterGameStats.k],
          ].map(([label, val]) => (
            <div key={label} className="text-center">
              <div className="text-xs text-538-muted">{label}</div>
              <div className="text-lg font-black text-538-text">{val}</div>
            </div>
          ))}
          {batterId && (
            <a href={`/batters/${batterId}`} target="_blank" rel="noreferrer"
              className="self-center text-xs text-538-orange hover:underline ml-auto">Season →</a>
          )}
        </div>
      )}
      <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
        {plays.length === 0 && <p className="text-xs text-538-muted">No plays yet</p>}
        {plays.map((play, i) => {
          if (!play.description) return null
          const col = RESULT_COLORS[play.eventType] ?? '#9CA3AF'
          const half = HALF_ICONS[play.half] ?? ''
          return (
            <div key={i} className="flex items-start gap-3 py-0.5">
              <span className="text-xs font-mono text-538-muted shrink-0 w-10">
                {half}{play.inning}
              </span>
              <span className="text-xs leading-snug flex-1 min-w-0 break-words" style={{ color: col }}>{play.description}</span>
              {play.awayScore != null && (
                <span className="text-xs font-mono text-538-muted shrink-0">
                  {awayAbbr} {play.awayScore}–{play.homeScore} {homeAbbr}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function LiveGamePanel({ gamePk, awayAbbr, homeAbbr }: { gamePk: number; awayAbbr: string; homeAbbr: string }) {
  const [live, setLive] = useState<LiveState | null>(null)
  const [error, setError] = useState(false)
  const [zoneData, setZoneData] = useState<MiniZoneData | null>(null)
  const [pitchMix, setPitchMix] = useState<PitchMixEntry[] | null>(null)
  const [batterStats, setBatterStats] = useState<BatterPitchStat[] | null>(null)
  const [pitchToggle, setPitchToggle] = useState('ALL')
  const lastBatterRef  = useRef<number | null>(null)
  const lastPitcherRef = useRef<number | null>(null)
  const season = new Date().getFullYear()

  const fetchLive = useCallback(async () => {
    try {
      const r = await fetch(`/api/live-game/${gamePk}`, { cache: 'no-store' })
      if (!r.ok) { setError(true); return }
      const d: LiveState = await r.json()
      setLive(d); setError(false)
    } catch { setError(true) }
  }, [gamePk])

  // Batter data: zones + scenario stats
  useEffect(() => {
    if (!live?.batterId || live.batterId === lastBatterRef.current) return
    lastBatterRef.current = live.batterId
    setZoneData(null); setBatterStats(null); setPitchToggle('ALL')

    fetch(`/api/batter-season/zones?batterId=${live.batterId}&season=${season}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.zones) return
        setZoneData({
          zones: d.zones,
          pitchTypeZones: (d.pitchTypes ?? []).map((p: Record<string,unknown>) => ({
            code: p.code as string,
            name: p.name as string,
            zones: p.zones as MiniZoneCell[][],
          })),
          batterName: d.batterName,
          stand: d.stand ?? 'R',
          seasonStats: d.seasonStats ? {
            k_pct: (d.seasonStats as Record<string,number>).k_pct,
            bb_pct: (d.seasonStats as Record<string,number>).bb_pct,
            avg: (d.seasonStats as Record<string,number>).avg,
            slg: (d.seasonStats as Record<string,number>).slg,
            hr: (d.seasonStats as Record<string,number>).hr,
            pa: (d.seasonStats as Record<string,number>).pa,
          } : null,
        })
      }).catch(() => null)

    fetch(`/api/batter-scenario?batterId=${live.batterId}&season=${season}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.byPT) return
        const stats: BatterPitchStat[] = Object.entries(d.byPT as Record<string, Record<string, Record<string, {count:number;swings:number;whiffs:number;pa:number;h:number;bb:number;ab:number;tb:number;rv_sum:number}>>>)
          .map(([type, byHand]) => {
            const agg = { count:0, swings:0, whiffs:0, pa:0, h:0, bb:0, ab:0, tb:0, rv_sum:0 }
            Object.values(byHand).forEach(byCount =>
              Object.values(byCount).forEach(b => {
                agg.count += b.count; agg.swings += b.swings; agg.whiffs += b.whiffs
                agg.pa += b.pa; agg.h += b.h; agg.bb += b.bb
                agg.ab += b.ab; agg.tb += b.tb; agg.rv_sum += b.rv_sum
              })
            )
            if (agg.count < 15) return null
            const obp = agg.pa >= 15 ? (agg.h + agg.bb) / agg.pa : null
            const slg = agg.ab >= 15 ? agg.tb / agg.ab : null
            return {
              type,
              whiff: agg.swings >= 8 ? (agg.whiffs / agg.swings) * 100 : null,
              ops: obp != null && slg != null ? obp + slg : null,
              rv: agg.pa >= 15 ? (agg.rv_sum / agg.pa) * 100 : null,
              count: agg.count,
            }
          })
          .filter((s): s is BatterPitchStat => s !== null)
        setBatterStats(stats)
      }).catch(() => null)
  }, [live?.batterId, season])

  // Pitcher pitch mix
  useEffect(() => {
    if (!live?.pitcherId || live.pitcherId === lastPitcherRef.current) return
    lastPitcherRef.current = live.pitcherId
    setPitchMix(null)

    fetch(`/api/pitcher-pitch-mix?pitcherId=${live.pitcherId}&season=${season}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.pitchTypes) return
        // Aggregate byAbPitch to get whiff% and strike% per pitch type
        const agg: Record<string, {count:number;whiffs:number;strikes:number}> = {}
        if (d.byAbPitch) {
          Object.values(d.byAbPitch as Record<string, Record<string,{count:number;whiffs:number;strikes:number}>>).forEach(byPT => {
            Object.entries(byPT).forEach(([pt, s]) => {
              agg[pt] ??= {count:0, whiffs:0, strikes:0}
              agg[pt].count += s.count; agg[pt].whiffs += s.whiffs; agg[pt].strikes += s.strikes
            })
          })
        }
        const total = d.pitchTypes.reduce((s: number, p: Record<string,unknown>) => s + (p.count as number), 0)
        setPitchMix(d.pitchTypes.map((p: Record<string,unknown>) => {
          const a = agg[p.type as string]
          return {
            type:      p.type as string,
            name:      p.name as string,
            color:     PITCH_COLORS_LIVE[p.type as string] ?? '#78909C',
            pct:       total > 0 ? Math.round(((p.count as number) / total) * 100) : 0,
            whiffPct:  a && a.count >= 20 ? Math.round((a.whiffs / a.count) * 100) : null,
            strikePct: a && a.count >= 20 ? Math.round((a.strikes / a.count) * 100) : null,
          }
        }))
      }).catch(() => null)
  }, [live?.pitcherId, season])

  // Poll every 15 seconds
  useEffect(() => {
    fetchLive()
    const id = setInterval(fetchLive, 15000)
    return () => clearInterval(id)
  }, [fetchLive])

  // Derived: AB outcome prediction
  const abOutcome = useMemo(() => {
    const ss = zoneData?.seasonStats
    if (!live || !ss || ss.pa < 50) return null
    const k  = ss.k_pct / 100, bb = ss.bb_pct / 100
    const { balls, strikes } = live.count
    const key = `${balls}-${strikes}`
    const kAdj  = liveClamp(k  * (COUNT_K_MULT[key]  ?? 1), 0, 0.65)
    const bbAdj = liveClamp(bb * (COUNT_BB_MULT[key] ?? 1), 0, 0.50)
    const hrBase = ss.pa > 0 ? ss.hr / ss.pa : 0
    const hBase  = liveClamp(ss.avg * (1 - bb) - hrBase, 0, 0.35)
    const inPlayBase = hrBase + hBase + Math.max(0, 1 - k - bb - hrBase - hBase)
    const inPlayAdj  = liveClamp(1 - kAdj - bbAdj, 0, 1)
    const scale = inPlayBase > 0 ? inPlayAdj / inPlayBase : 1
    const hrAdj  = liveClamp(hrBase * scale, 0, 0.15)
    const hAdj   = liveClamp(hBase  * scale, 0, 0.35)
    const outAdj = liveClamp(1 - kAdj - bbAdj - hrAdj - hAdj, 0, 0.80)
    return { k: kAdj, bb: bbAdj, hr: hrAdj, h: hAdj, out: outAdj }
  }, [live?.count, zoneData])

  // Derived: next pitch prediction
  const nextPitches = useMemo(() => {
    if (!pitchMix || !live) return null
    const { balls, strikes } = live.count
    const lastType = live.abPitches.length > 0 ? live.abPitches[live.abPitches.length - 1].type : null
    return { pitchMix, balls, strikes, lastType }
  }, [pitchMix, live?.count, live?.abPitches])

  if (error) return (
    <div className="border-t border-538-border px-4 py-3 text-2xs text-538-muted">
      Could not load live feed — will retry automatically.
    </div>
  )
  if (!live) return (
    <div className="border-t border-538-border px-4 py-3 text-2xs text-538-muted animate-pulse">
      Loading live data…
    </div>
  )

  const { count, abPitches } = live
  const halfArrow  = live.inningHalf === 'Top' ? '▲' : live.inningHalf === 'Bottom' ? '▼' : ''
  const ballDots   = Array.from({ length: 4 }, (_, i) => i < count.balls)
  const strikeDots = Array.from({ length: 3 }, (_, i) => i < count.strikes)
  const outDots    = Array.from({ length: 3 }, (_, i) => i < (live.outs ?? 0))

  // Zones to show in heatmap
  const activePTZones = pitchToggle !== 'ALL'
    ? zoneData?.pitchTypeZones.find(p => p.code === pitchToggle)?.zones ?? null
    : zoneData?.zones ?? null

  return (
    <div className="border-t border-538-border bg-538-bg/50 px-4 py-5 space-y-6 w-full min-w-0">

      {/* ── Row 1: Scoreboard + Matchup Table side by side ── */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">

        {/* Scoreboard block — fixed width on desktop, wraps naturally on mobile */}
        <div className="flex flex-wrap gap-4 items-start shrink-0 lg:min-w-[340px] max-w-full">
          {/* Score */}
          <div className="flex items-center gap-3">
            <div className="text-center">
              <div className="text-xs font-bold uppercase tracking-widest text-538-muted">{live.awayAbbr}</div>
              <div className="text-4xl font-black text-538-text leading-none">{live.awayScore ?? '—'}</div>
            </div>
            <div className="text-2xl text-538-muted font-black">–</div>
            <div className="text-center">
              <div className="text-xs font-bold uppercase tracking-widest text-538-muted">{live.homeAbbr}</div>
              <div className="text-4xl font-black text-538-text leading-none">{live.homeScore ?? '—'}</div>
            </div>
          </div>

          {/* Inning + count + outs + live pitch zone */}
          <div className="pl-4 border-l border-538-border flex flex-col gap-1">
            <div className="text-sm font-bold text-green-400">{halfArrow}{live.inning ?? '—'} {live.inningHalf ?? ''}</div>
            <div className="flex gap-1.5 items-center">
              {outDots.map((on, i) => <span key={i} className={`inline-block w-2.5 h-2.5 rounded-full border-2 ${on ? 'bg-yellow-400 border-yellow-400' : 'border-538-muted'}`} />)}
              <span className="text-xs text-538-muted ml-1">{live.outs} out{live.outs !== 1 ? 's' : ''}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-xs font-bold text-538-muted w-4">B</span>
              {ballDots.map((on, i) => <span key={i} className={`inline-block w-2 h-2 rounded-full border-2 ${on ? 'bg-green-400 border-green-400' : 'border-538-muted'}`} />)}
              <span className="text-xs font-bold text-538-muted ml-2 w-4">S</span>
              {strikeDots.map((on, i) => <span key={i} className={`inline-block w-2 h-2 rounded-full border-2 ${on ? 'bg-red-400 border-red-400' : 'border-538-muted'}`} />)}
            </div>
            {/* Live at-bat pitch location zone */}
            <div className="mt-1">
              <AbPitchZone pitches={abPitches} />
            </div>
          </div>

          {/* Bases diamond */}
          {live.bases && (
            <div className="pl-4 border-l border-538-border">
              <svg viewBox="0 0 52 52" width={52} height={52}>
                <rect x={18} y={2}  width={14} height={14} rx={1} transform="rotate(45 25 9)"  fill={live.bases.second ? '#fbbf24':'#374151'} stroke="#4b5563" strokeWidth={1.5}/>
                <rect x={2}  y={18} width={14} height={14} rx={1} transform="rotate(45 9 25)"  fill={live.bases.third  ? '#fbbf24':'#374151'} stroke="#4b5563" strokeWidth={1.5}/>
                <rect x={34} y={18} width={14} height={14} rx={1} transform="rotate(45 41 25)" fill={live.bases.first  ? '#fbbf24':'#374151'} stroke="#4b5563" strokeWidth={1.5}/>
                <rect x={18} y={34} width={14} height={14} rx={1} transform="rotate(45 25 41)" fill="#374151" stroke="#4b5563" strokeWidth={1.5}/>
              </svg>
            </div>
          )}

          {/* Pitcher / Batter */}
          <div className="pl-4 border-l border-538-border flex flex-col gap-2">
            <div>
              <div className="text-xs text-538-muted uppercase tracking-wider font-bold mb-0.5">Pitcher</div>
              {live.pitcherName
                ? <a href={`/pitchers/${live.pitcherId}`} target="_blank" rel="noreferrer"
                    className="text-base font-bold text-538-text hover:text-538-orange leading-none">{live.pitcherName}</a>
                : <span className="text-base text-538-muted">—</span>}
              <div className="text-xs text-538-muted mt-0.5">
                {live.pitcherTeam} · {live.pitcherHand}HP
                {live.currentPitcherStats && ` · ${live.currentPitcherStats.ip} IP · ${live.currentPitcherStats.pc}P · ${live.currentPitcherStats.k}K`}
              </div>
            </div>
            <div>
              <div className="text-xs text-538-muted uppercase tracking-wider font-bold mb-0.5">Batter</div>
              {live.batterName
                ? <a href={`/batters/${live.batterId}`} target="_blank" rel="noreferrer"
                    className="text-base font-bold text-538-text hover:text-538-orange leading-none">{live.batterName}</a>
                : <span className="text-base text-538-muted">—</span>}
              <div className="text-xs text-538-muted mt-0.5">
                {live.batterTeam} · {live.batterStand === 'L' ? 'LHB' : live.batterStand === 'S' ? 'Switch' : 'RHB'}
              </div>
            </div>
          </div>
        </div>

        {/* Matchup table — fills remaining horizontal space */}
        {pitchMix && pitchMix.length > 0 && (
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold uppercase tracking-widest text-538-muted mb-2">Pitcher Arsenal vs Batter</div>
            <MatchupTable pitchMix={pitchMix} batterStats={batterStats} />
          </div>
        )}
      </div>

      {/* ── Row 2: Zone heatmap · Outcome · Next Pitch ── */}
      <div className="flex flex-col sm:flex-row gap-8 items-start overflow-x-auto pb-1">

        {/* Savant heatmap */}
        {zoneData && (
          <div className="shrink-0">
            <div className="mb-2">
              <div className="text-xs font-bold uppercase tracking-widest text-538-muted">
                {zoneData.batterName ? `${zoneData.batterName.split(' ').slice(-1)[0]}'s` : 'Batter'} Season Zone Performance
              </div>
              <div className="text-[9px] text-538-muted mb-1">Run value per pitch by zone — toggle by pitch type below</div>
            </div>
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <div className="inline-flex border border-538-border rounded overflow-hidden">
                <button onClick={() => setPitchToggle('ALL')}
                  className={`px-2 py-1 text-xs font-bold transition-colors ${pitchToggle === 'ALL' ? 'bg-538-orange text-white' : 'text-538-muted'}`}>
                  All
                </button>
                {(pitchMix ?? []).slice(0, 5).map(p => (
                  <button key={p.type} onClick={() => setPitchToggle(p.type)}
                    className={`px-2 py-1 text-xs font-bold transition-colors ${pitchToggle === p.type ? 'bg-538-orange text-white' : ''}`}
                    style={pitchToggle === p.type ? {} : { color: p.color }}>
                    {p.type}
                  </button>
                ))}
              </div>
            </div>
            {activePTZones
              ? <SavantHeatmap zones={activePTZones} pitchLabel={pitchToggle !== 'ALL' ? pitchToggle : undefined} />
              : <div className="text-xs text-538-muted py-4">No zone data for {pitchToggle}</div>
            }
            <p className="text-xs text-538-muted mt-1.5">
              Catcher&apos;s view · season averages<br/>
              <span className="text-red-400">Red</span> = batter-friendly (+ RV) &nbsp;·&nbsp; <span className="text-blue-400">Blue</span> = pitcher-friendly (− RV)
            </p>
          </div>
        )}

        {/* Outcome + Next pitch — expand to fill */}
        <div className="flex flex-col sm:flex-row gap-8 flex-1">
          {abOutcome && (
            <div className="flex-1">
              <div className="text-xs font-bold uppercase tracking-widest text-538-muted mb-3">
                AB Outcome ({count.balls}–{count.strikes})
              </div>
              <AbOutcomeBar {...abOutcome} />
              <p className="text-xs text-538-muted mt-2">Season rates · count-adjusted</p>
            </div>
          )}

          {nextPitches && (
            <div className="flex-1">
              <div className="text-xs font-bold uppercase tracking-widest text-538-muted mb-3">
                Likely Next Pitch
              </div>
              <NextPitchPred {...nextPitches} />
              <p className="text-xs text-538-muted mt-2">Usage + count + sequence heuristic</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Row 3: This AB pitch sequence ── */}
      {abPitches.length > 0 && (
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-538-muted mb-2">This AB</div>
          <div className="flex flex-wrap gap-x-6">
            {abPitches.map((p, i) => <LivePitchDot key={i} pitch={p} idx={i} />)}
          </div>
        </div>
      )}

      {/* ── Row 4: Play-by-play + box score ── */}
      <PlayByPlayFeed
        plays={live.recentPlays ?? []}
        batterGameStats={live.batterGameStats}
        batterName={live.batterName}
        awayAbbr={live.awayAbbr}
        homeAbbr={live.homeAbbr}
        batterId={live.batterId}
      />

      <p className="text-xs text-538-muted">Auto-refreshes every 15s</p>
    </div>
  )
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
          <Bar dataKey="awayFreq" name={awayAbbr} fill="#3D405B" radius={[2, 2, 0, 0]} />
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
    <div className="border border-538-border rounded-sm bg-surface shadow-lg mt-1 z-30">
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
                style={{ background: '#3D405B' }}
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
    <div className="border border-538-border rounded-sm bg-surface overflow-hidden">
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
                    SP: TBD
                  </span>
                ) : (
                  <span className="truncate block max-w-[140px] sm:max-w-none">SP: {game.awayPitcher.name}</span>
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
                    SP: TBD
                  </span>
                ) : (
                  <span className="truncate block max-w-[140px] sm:max-w-none text-right">SP: {game.homePitcher.name}</span>
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
          <div
            className="grid grid-cols-3 gap-2 mb-3 text-center cursor-pointer"
            onClick={() => onUpdate({ breakdownOpen: true })}
            title="Click to open game breakdown"
          >
            <div>
              <div className="text-2xs text-538-muted uppercase tracking-wider mb-0.5">Away Win</div>
              <div className="text-2xl font-black text-538-orange">{(sr.awayWinPct * 100).toFixed(0)}%</div>
              <div className="text-2xs text-538-muted">±{(sr.confidenceInterval * 100).toFixed(1)}%</div>
            </div>
            <div>
              {(game.gameStatus === 'Final' || game.gameStatus === 'Live') &&
               game.awayScore !== null && game.homeScore !== null ? (
                <>
                  <div className="text-2xs uppercase tracking-wider mb-0.5 font-bold"
                    style={{ color: game.gameStatus === 'Live' ? '#16a34a' : '#888' }}>
                    {game.gameStatus === 'Live'
                      ? `● ${game.inningHalf === 'Top' ? '▲' : game.inningHalf === 'Bottom' ? '▼' : ''}${game.inning ?? ''} Live`
                      : 'Final'}
                  </div>
                  <div className="text-xl font-black text-538-text">
                    {game.awayScore} – {game.homeScore}
                  </div>
                  {game.gameStatus === 'Live' && game.bases && (
                    <div className="flex justify-center mt-1">
                      <BaseDiamond bases={game.bases} outs={game.outs ?? 0} />
                    </div>
                  )}
                  <div className="text-2xs text-538-muted mt-0.5">
                    proj. {sr.avgAwayRuns.toFixed(1)} – {sr.avgHomeRuns.toFixed(1)}
                  </div>
                </>
              ) : (
                <>
                  <div className="text-2xs text-538-muted uppercase tracking-wider mb-0.5">Proj. Score</div>
                  <div className="text-base font-bold text-538-text mt-1">
                    {sr.avgAwayRuns.toFixed(1)} — {sr.avgHomeRuns.toFixed(1)}
                  </div>
                </>
              )}
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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between text-2xs mb-3 border-t border-538-border pt-2 gap-1">
          <div className="flex gap-2 flex-wrap">
            <span className="text-538-muted font-semibold">{game.awayTeamAbbr}</span>
            <span className="text-538-muted">ELO {awayElo.toFixed(0)}</span>
            <span className="text-538-border hidden sm:inline">·</span>
            <span>W: <span className="font-bold text-538-green">+{awayDelta.winDelta}</span></span>
            <span>L: <span className="font-bold text-538-red">{awayDelta.lossDelta}</span></span>
          </div>
          <div className="flex gap-2 flex-wrap sm:justify-end">
            <span className="text-538-muted font-semibold">{game.homeTeamAbbr}</span>
            <span className="text-538-muted">ELO {homeElo.toFixed(0)}</span>
            <span className="text-538-border hidden sm:inline">·</span>
            <span>W: <span className="font-bold text-538-green">+{homeDelta.winDelta}</span></span>
            <span>L: <span className="font-bold text-538-red">{homeDelta.lossDelta}</span></span>
          </div>
        </div>

        {/* Action row */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => onUpdate({ breakdownOpen: true })}
            className="text-2xs border rounded px-2.5 py-1.5 font-semibold transition-colors hover:opacity-80"
            style={{ borderColor: '#1467EB', color: '#1467EB' }}
          >
            Game Breakdown
          </button>
          {game.gameStatus === 'Live' && (
            <button
              onClick={() => onUpdate({ liveOpen: !game.liveOpen })}
              className={`text-2xs border rounded px-2.5 py-1.5 font-semibold transition-colors ${game.liveOpen ? 'bg-green-900/30 border-green-500 text-green-400' : 'border-green-700 text-green-500 hover:bg-green-900/20'}`}
            >
              {game.liveOpen ? '● Following Live' : '● Follow Live'}
            </button>
          )}
          <button
            onClick={() => onUpdate({ swapTarget: swapTarget?.type === 'away-pitcher' ? null : { type: 'away-pitcher' } })}
            className="text-2xs border border-538-border rounded px-2 py-1.5 text-538-muted hover:border-538-orange hover:text-538-orange transition-colors hidden sm:block"
          >
            {game.awayPitcher.isTbd ? '+ Away SP' : `Swap ${game.awayTeamAbbr} SP`}
          </button>
          <button
            onClick={() => onUpdate({ swapTarget: swapTarget?.type === 'home-pitcher' ? null : { type: 'home-pitcher' } })}
            className="text-2xs border border-538-border rounded px-2 py-1.5 text-538-muted hover:border-538-orange hover:text-538-orange transition-colors hidden sm:block"
          >
            {game.homePitcher.isTbd ? '+ Home SP' : `Swap ${game.homeTeamAbbr} SP`}
          </button>
          <button
            onClick={handleSimulate}
            className="text-2xs border border-538-border rounded px-2 py-1.5 text-538-muted hover:border-538-orange hover:text-538-orange transition-colors ml-auto"
          >
            Re-run
          </button>
          <button
            onClick={() => onUpdate({ expanded: !game.expanded })}
            className="text-2xs border border-538-border rounded px-2 py-1.5 text-538-muted hover:bg-538-bg transition-colors flex items-center gap-1"
          >
            <span className={`inline-block transition-transform ${game.expanded ? 'rotate-180' : ''}`}>▼</span>
            <span className="hidden sm:inline">{game.expanded ? 'Collapse' : 'Details'}</span>
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

      {/* Game breakdown modal */}
      {game.breakdownOpen && (
        <GameBreakdown
          gamePk={game.gameId}
          awayTeamName={game.awayTeamName}
          homeTeamName={game.homeTeamName}
          awayTeamAbbr={game.awayTeamAbbr}
          homeTeamAbbr={game.homeTeamAbbr}
          awayScore={game.awayScore}
          homeScore={game.homeScore}
          gameStatus={game.gameStatus}
          onClose={() => onUpdate({ breakdownOpen: false })}
        />
      )}

      {/* Live game panel */}
      {game.liveOpen && game.gameStatus === 'Live' && (
        <LiveGamePanel gamePk={game.gameId} awayAbbr={game.awayTeamAbbr} homeAbbr={game.homeTeamAbbr} />
      )}

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

          {/* NRFI / YRFI */}
          <div className="border border-538-border rounded-sm bg-surface p-4">
            <div className="text-2xs font-semibold uppercase tracking-widest text-538-muted mb-3">
              First Inning Scoring
              <span className="font-normal normal-case ml-1 text-538-muted">(top of order vs SP — projected lineup)</span>
            </div>
            <div className="grid grid-cols-2 gap-4 text-center mb-3">
              <div>
                <div className="text-2xs text-538-muted uppercase tracking-wider mb-1">NRFI</div>
                <div className="text-3xl font-black text-538-orange">{(sr.nrfiPct * 100).toFixed(0)}%</div>
                <div className="text-2xs text-538-muted mt-0.5">No run first inning</div>
              </div>
              <div>
                <div className="text-2xs text-538-muted uppercase tracking-wider mb-1">YRFI</div>
                <div className="text-3xl font-black text-538-text">{(sr.yrfiPct * 100).toFixed(0)}%</div>
                <div className="text-2xs text-538-muted mt-0.5">Yes run first inning</div>
              </div>
            </div>
            <div className="h-2 rounded-full overflow-hidden bg-538-border">
              <div
                className="h-full rounded-full bg-538-orange"
                style={{ width: `${sr.nrfiPct * 100}%` }}
              />
            </div>
          </div>

          {/* Run distribution */}
          <div className="border border-538-border rounded-sm bg-surface p-4">
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
        awayScore: sg.awayScore,
        homeScore: sg.homeScore,
        gameStatus: sg.gameStatus ?? 'Preview',
        inning: sg.inning ?? null,
        inningHalf: sg.inningHalf ?? null,
        outs: sg.outs ?? null,
        bases: sg.bases ?? null,
        breakdownOpen: false,
        liveOpen: false,
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
      awayScore: null,
      homeScore: null,
      gameStatus: 'Preview',
      inning: null,
      inningHalf: null,
      outs: null,
      bases: null,
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
            className="border border-538-border rounded-sm px-3 py-1.5 text-sm text-538-text bg-surface outline-none focus:border-538-orange"
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
              className="border border-538-border rounded-sm px-3 py-1.5 text-sm text-538-text bg-surface outline-none focus:border-538-orange"
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
              className="border border-538-border rounded-sm px-3 py-1.5 text-sm text-538-text bg-surface outline-none focus:border-538-orange"
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
              className="border border-538-border rounded-sm px-3 py-1.5 text-sm text-538-text bg-surface outline-none focus:border-538-orange"
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
            <div key={i} className="border border-538-border rounded-sm bg-surface p-4 animate-pulse">
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
        <div className="border border-538-border rounded-sm bg-surface px-4 py-10 text-center text-538-muted text-sm">
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

      <LogicBreakdown sections={MATCHUP_LAB_SECTIONS} />
    </div>
  )
}

const MATCHUP_LAB_SECTIONS = [
  {
    title: 'Plate appearance model',
    body: (
      <>
        <p>
          Every PA is one random draw from {`{K, BB, HR, in-play hit, in-play out}`}.
          The probabilities start from the batter&apos;s rate stats, then get multiplied
          by ratios of the pitcher&apos;s rate stats to the league average.
        </p>
        <Code>{`kAdj  = pitcher.kPer9  / LEAGUE_K_PER_9
bbAdj = pitcher.bbPer9 / LEAGUE_BB_PER_9
hrAdj = pitcher.hrPer9 / LEAGUE_HR_PER_9

rawK  = batter.kPct  × kAdj × kMod        // kMod = 0.85 if fatigued
rawBB = batter.bbPct × bbAdj
rawHR = batter.hrPerAb × (1 − batter.bbPct) × hrAdj

inPlayBase = max(0, 1 − batter.kPct − batter.bbPct − hrPerPa)
rawHit     = inPlayBase × batter.babip × hitMod   // 1.10 if fatigued
rawOut     = inPlayBase × (1 − batter.babip)`}</Code>
        <p>
          Each in-play hit gets resolved into 1B/2B/3B by the batter&apos;s extra-base
          share. Outcome chosen by cumulative weighted sample.
        </p>
      </>
    ),
  },
  {
    title: 'Game simulation',
    body: (
      <>
        <p>
          Each game is {SIM_COUNT} Monte Carlo runs. Innings advance batter-by-batter
          through both lineups; the starter exits when pitch count crosses ~100 and a
          fatigue modifier kicks in before bullpen takes over. Results are aggregated
          across all sims for win %, run distribution, and per-player projections.
        </p>
        <Code>{`for sim in 1..SIM_COUNT:
  for each half-inning:
    while outs < 3:
      outcome = simulatePa(batter, pitcher, fatigued)
      pitches += PITCHES_PER_PA[outcome]
      apply outcome → bases, runs, outs

awayWinPct = (away_wins / SIM_COUNT)
avgAwayRuns = mean(sim.awayRuns for sim in sims)`}</Code>
      </>
    ),
  },
  {
    title: 'Seeded randomness',
    body: (
      <>
        <p>
          The PRNG is Mulberry32 seeded by a hash of the matchup (pitcher IDs + lineup
          IDs). Same matchup → same numbers every time. Change the lineup or pitcher and
          you get a fresh seed.
        </p>
        <Code>{`hashSetup = (setup) => {
  let h = 0x12345678
  for id of [pitchers, ...lineups]:
    h = imul(h ^ id, 0x9e3779b9)
  return h
}

// Mulberry32 PRNG, deterministic for a given seed
seedRng(hashSetup(setup))`}</Code>
      </>
    ),
  },
  {
    title: 'League averages (2025 MLB)',
    body: (
      <>
        <p>Used as denominators for the pitcher adjustment ratios.</p>
        <Code>{`K%       = 0.222    BB%      = 0.085
HR/AB    = 0.034    BABIP    = 0.295
K/9      = 8.7      BB/9     = 3.2     HR/9 = 1.2`}</Code>
      </>
    ),
  },
  {
    title: 'Sim outputs',
    body: (
      <>
        <p>
          Win %, expected runs, run distribution histogram, NRFI/YRFI probability, plus
          per-batter (avg bases, avg K) and per-pitcher (avg K, BB, IP) projections all
          come from aggregating the {SIM_COUNT} sims.
        </p>
      </>
    ),
  },
]

// Re-export helpers so the page component can use them
export { pitcherFromLocal, batterFromLocal }
