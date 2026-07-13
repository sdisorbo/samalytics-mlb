'use client'

import { useState, useEffect } from 'react'

const BLUE = '#1467EB'
const MLB_API = 'https://statsapi.mlb.com/api/v1'

// ── Linear weights (runs above average per event) ────────────────────────────
// Source: FanGraphs 2024 linear weights, roughly
const LINEAR_WEIGHTS: Record<string, number> = {
  home_run: 1.380,
  triple: 1.052,
  double: 0.764,
  single: 0.455,
  walk: 0.317,
  intent_walk: 0.317,
  hit_by_pitch: 0.373,
  strikeout: -0.274,
  strikeout_double_play: -0.274,
  field_out: -0.267,
  force_out: -0.267,
  grounded_into_double_play: -0.534,
  double_play: -0.534,
  triple_play: -0.801,
  fielders_choice: -0.267,
  fielders_choice_out: -0.267,
  field_error: 0.100,
  sac_bunt: -0.267,
  sac_fly: 0.050,
  sac_fly_double_play: -0.267,
  catcher_interf: 0.317,
}

// Run value threshold for "out" catch-all
const DEFAULT_OUT_RV = -0.267
// Replacement level per PA (so 4 PA of groundouts still shows negative RAR vs replacement)
const REPL_PER_PA = -0.020

// ── Types ─────────────────────────────────────────────────────────────────────

type Outcome = 'HR' | '3B' | '2B' | '1B' | 'BB' | 'K' | 'OUT' | 'E' | 'SF' | 'DP'

interface GameEvent {
  id: number
  outcome: Outcome
  description: string
  inning: number
  isTop: boolean
  sprayAngle: number
  rv: number   // run value (linear weight)
}

interface PlayerData {
  batterId: number
  name: string
  isAway: boolean
  events: GameEvent[]
  totalRv: number   // sum of linear weights
  rar: number       // totalRv - n_pa * REPL_PER_PA
}

export interface GameBreakdownProps {
  gamePk: number
  awayTeamName: string
  homeTeamName: string
  awayTeamAbbr: string
  homeTeamAbbr: string
  awayScore: number | null
  homeScore: number | null
  gameStatus: string   // "Preview" | "Live" | "Final"
  onClose: () => void
}

// ── MLB eventType → Outcome chip ─────────────────────────────────────────────

function eventTypeToOutcome(eventType: string): Outcome {
  if (eventType === 'home_run') return 'HR'
  if (eventType === 'triple') return '3B'
  if (eventType === 'double') return '2B'
  if (eventType === 'single') return '1B'
  if (eventType === 'walk' || eventType === 'intent_walk' || eventType === 'hit_by_pitch' || eventType === 'catcher_interf') return 'BB'
  if (eventType === 'strikeout' || eventType === 'strikeout_double_play') return 'K'
  if (eventType === 'field_error') return 'E'
  if (eventType === 'sac_fly' || eventType === 'sac_fly_double_play') return 'SF'
  if (eventType === 'grounded_into_double_play' || eventType === 'double_play' || eventType === 'triple_play') return 'DP'
  return 'OUT'
}

// ── Hit coordinates → spray angle ────────────────────────────────────────────
// MLB Stats API field coordinates: home plate ≈ (125, 205) in a ~250x250 diagram

function coordsToSpray(coordX: number, coordY: number): number {
  const dx = coordX - 125.42
  const dy = 204.5 - coordY   // flip y: larger coordY = closer to plate
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return 0
  const angle = Math.atan2(dx, dy) * (180 / Math.PI)
  return Math.max(-45, Math.min(45, angle))
}

// Location code (1–9) fallback when no coords
const LOC_SPRAY: Record<string, number> = {
  '1': 0, '2': 0, '3': 30, '4': 15, '5': -30,
  '6': -15, '7': -38, '8': 0, '9': 38,
}

// ── Fetch & parse play-by-play ────────────────────────────────────────────────

async function fetchGameData(gamePk: number): Promise<PlayerData[]> {
  const res = await fetch(`${MLB_API}/game/${gamePk}/playByPlay`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()

  const playerMap = new Map<number, PlayerData>()
  let eventIdx = 0

  for (const play of data.allPlays ?? []) {
    if (play.result?.type !== 'atBat' || !play.about?.isComplete) continue

    const batterId: number = play.matchup?.batter?.id
    const batterName: string = play.matchup?.batter?.fullName ?? 'Unknown'
    const isTop: boolean = play.about?.isTopInning ?? true
    const inning: number = play.about?.inning ?? 1
    const eventType: string = (play.result?.eventType ?? '').toLowerCase()
    const description: string = play.result?.description ?? play.result?.event ?? eventType

    const rv = LINEAR_WEIGHTS[eventType] ?? DEFAULT_OUT_RV
    const outcome = eventTypeToOutcome(eventType)

    // Find spray angle from hitData in playEvents
    let sprayAngle = 0
    for (const ev of play.playEvents ?? []) {
      if (ev.hitData) {
        const { coordX, coordY } = ev.hitData.coordinates ?? {}
        if (coordX != null && coordY != null) {
          sprayAngle = coordsToSpray(coordX, coordY)
        } else if (ev.hitData.location) {
          sprayAngle = LOC_SPRAY[String(ev.hitData.location)] ?? 0
        }
        break
      }
    }

    if (!playerMap.has(batterId)) {
      playerMap.set(batterId, {
        batterId,
        name: batterName,
        isAway: isTop,  // top half = away bats
        events: [],
        totalRv: 0,
        rar: 0,
      })
    }

    const player = playerMap.get(batterId)!
    player.events.push({ id: eventIdx++, outcome, description, inning, isTop, sprayAngle, rv })
    player.totalRv += rv
  }

  // Compute RAR = totalRv - n_pa * REPL_PER_PA
  for (const p of playerMap.values()) {
    p.rar = p.totalRv - p.events.length * REPL_PER_PA
  }

  return Array.from(playerMap.values())
}

// ── Baseball field SVG ────────────────────────────────────────────────────────

const OUTCOME_DIST: Record<Outcome, number> = {
  HR: 235, '3B': 192, '2B': 160, '1B': 115,
  BB: 0, K: 0, OUT: 88, E: 100, SF: 155, DP: 70,
}

function hitEndpoint(spray: number, dist: number): [number, number] {
  const rad = (spray * Math.PI) / 180
  return [200 + dist * Math.sin(rad), 350 - dist * Math.cos(rad)]
}

function BaseballField({ events, playerName, animKey }: {
  events: GameEvent[]
  playerName: string
  animKey: number
}) {
  const hitEvents = events.filter(e => OUTCOME_DIST[e.outcome] > 0)
  const plateEvents = events.filter(e => OUTCOME_DIST[e.outcome] === 0)

  return (
    <div className="flex flex-col items-center">
      <div className="text-xs font-bold mb-1 truncate w-full text-center" style={{ color: BLUE }}>
        {playerName}
      </div>
      <svg viewBox="0 0 400 385" style={{ width: '100%', maxWidth: 300, display: 'block' }}>
        {/* Outfield arc */}
        <path d="M 28 102 Q 200 8 372 102" fill="none" stroke={BLUE} strokeWidth="1.5" opacity="0.4" />
        {/* Foul lines */}
        <line x1="200" y1="350" x2="28" y2="102" stroke={BLUE} strokeWidth="1.2" opacity="0.4" />
        <line x1="200" y1="350" x2="372" y2="102" stroke={BLUE} strokeWidth="1.2" opacity="0.4" />
        {/* Diamond */}
        <polygon points="200,350 295,255 200,160 105,255"
          fill="none" stroke={BLUE} strokeWidth="1.5" opacity="0.8" />
        {/* Mound */}
        <circle cx="200" cy="232" r="7" fill="none" stroke={BLUE} strokeWidth="1" opacity="0.45" />
        {/* Bases */}
        {[{ cx: 295, cy: 255 }, { cx: 200, cy: 160 }, { cx: 105, cy: 255 }].map(({ cx, cy }, i) => (
          <rect key={i} x={cx - 4} y={cy - 4} width="8" height="8" fill={BLUE} opacity="0.3" rx="1" />
        ))}
        {/* Home plate */}
        <polygon points="200,353 206,358 204,365 196,365 194,358" fill={BLUE} opacity="0.45" />

        {/* Hit trajectories */}
        {hitEvents.map((e, i) => {
          const [tx, ty] = hitEndpoint(e.sprayAngle, OUTCOME_DIST[e.outcome])
          const isPos = e.rv >= 0
          const color = e.outcome === 'HR' ? BLUE : isPos ? '#3b82f6' : '#ef4444'
          const pathLen = Math.hypot(tx - 200, ty - 350)
          const delay = i * 0.18
          return (
            <g key={`${animKey}-${e.id}`}>
              <path
                d={`M 200 350 L ${tx.toFixed(1)} ${ty.toFixed(1)}`}
                fill="none" stroke={color}
                strokeWidth={e.outcome === 'HR' ? 2 : 1.5}
                strokeLinecap="round"
                style={{
                  strokeDasharray: pathLen,
                  strokeDashoffset: pathLen,
                  animation: `gbDraw 0.45s ease ${delay}s forwards`,
                }}
              />
              <circle cx={tx} cy={ty} r={e.outcome === 'HR' ? 4 : 3} fill={color}
                style={{ opacity: 0, animation: `gbFade 0.15s ease ${delay + 0.42}s forwards` }} />
              <text
                x={tx + (tx > 205 ? 7 : tx < 195 ? -7 : 0)}
                y={ty + (ty < 200 ? -5 : 12)}
                fontSize="9" fontWeight="bold" fill={color}
                textAnchor={tx > 205 ? 'start' : tx < 195 ? 'end' : 'middle'}
                style={{ opacity: 0, animation: `gbFade 0.2s ease ${delay + 0.42}s forwards` }}
              >
                {isPos ? '+' : ''}{e.rv.toFixed(2)}
              </text>
            </g>
          )
        })}

        {/* Plate events (K / BB) */}
        {plateEvents.map((e, i) => (
          <text
            key={`${animKey}-plate-${e.id}`}
            x={200 + (i - (plateEvents.length - 1) / 2) * 16}
            y={382} fontSize="10" fontWeight="bold" textAnchor="middle"
            fill={e.outcome === 'K' ? '#ef4444' : BLUE}
            style={{ opacity: 0, animation: `gbFade 0.2s ease ${hitEvents.length * 0.18 + 0.1}s forwards` }}
          >
            {e.outcome}
          </text>
        ))}
      </svg>

      <style>{`
        @keyframes gbDraw { to { stroke-dashoffset: 0; } }
        @keyframes gbFade { to { opacity: 1; } }
      `}</style>
    </div>
  )
}

// ── Player row ────────────────────────────────────────────────────────────────

const CHIP_COLOR: Record<Outcome, string> = {
  HR: BLUE, '3B': '#7c3aed', '2B': '#2563eb', '1B': '#0ea5e9',
  BB: '#16a34a', K: '#ef4444', OUT: '#64748b', E: '#f59e0b', SF: '#0284c7', DP: '#dc2626',
}

function PlayerRarRow({ player, isSelected, maxAbsRar, onSelect }: {
  player: PlayerData
  isSelected: boolean
  maxAbsRar: number
  onSelect: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const rar = player.rar
  const barPct = maxAbsRar > 0 ? (Math.abs(rar) / maxAbsRar) * 100 : 0
  const isPos = rar >= 0

  return (
    <div>
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors"
        style={{ backgroundColor: isSelected ? `${BLUE}14` : undefined }}
        onClick={onSelect}
      >
        <div className="w-28 text-xs font-semibold text-538-text truncate">{player.name}</div>
        <div className="flex-1 h-3 flex items-center">
          <div className="h-1.5 rounded-full" style={{
            width: `${barPct}%`,
            backgroundColor: isPos ? BLUE : '#ef4444',
            opacity: 0.75,
          }} />
        </div>
        <div className="text-xs font-mono font-bold w-14 text-right"
          style={{ color: isPos ? BLUE : '#ef4444' }}>
          {isPos ? '+' : ''}{rar.toFixed(2)}
        </div>
        <button
          className="text-538-muted hover:text-538-text text-xs w-4 flex-shrink-0"
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
        >
          {expanded ? '▲' : '▼'}
        </button>
      </div>

      {expanded && (
        <div className="mx-3 mb-1 text-2xs" style={{ borderLeft: `2px solid ${BLUE}35` }}>
          {player.events.map(ev => (
            <div key={ev.id} className="flex items-center gap-2 px-3 py-1 border-b border-538-border last:border-0">
              <span className="font-bold font-mono rounded px-1 leading-4 flex-shrink-0 text-white"
                style={{ fontSize: '9px', backgroundColor: CHIP_COLOR[ev.outcome] ?? '#64748b' }}>
                {ev.outcome}
              </span>
              <span className="text-538-muted flex-1 truncate">
                Inn. {ev.inning} — {ev.description}
              </span>
              <span className="font-mono font-bold flex-shrink-0"
                style={{ color: ev.rv >= 0 ? BLUE : '#ef4444' }}>
                {ev.rv >= 0 ? '+' : ''}{ev.rv.toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function GameBreakdown({
  gamePk,
  awayTeamName,
  homeTeamName,
  awayTeamAbbr,
  homeTeamAbbr,
  awayScore,
  homeScore,
  gameStatus,
  onClose,
}: GameBreakdownProps) {
  const [tab, setTab] = useState<'away' | 'home'>('away')
  const [players, setPlayers] = useState<PlayerData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<PlayerData | null>(null)
  const [fieldKey, setFieldKey] = useState(0)

  const isPreview = gameStatus === 'Preview'

  useEffect(() => {
    if (isPreview) { setLoading(false); return }
    setLoading(true)
    setError(null)
    fetchGameData(gamePk)
      .then(data => { setPlayers(data); setLoading(false) })
      .catch(err => { setError(String(err)); setLoading(false) })
  }, [gamePk, isPreview])

  useEffect(() => { setSelected(null) }, [tab])

  const currentPlayers = players
    .filter(p => tab === 'away' ? p.isAway : !p.isAway)
    .slice()
    .sort((a, b) => b.rar - a.rar)
  const maxAbsRar = Math.max(...currentPlayers.map(p => Math.abs(p.rar)), 0.01)

  const isLive = gameStatus === 'Live'
  const isFinal = gameStatus === 'Final'

  function handleSelect(p: PlayerData) {
    if (selected?.batterId === p.batterId) { setSelected(null); return }
    setSelected(p)
    setFieldKey(k => k + 1)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="bg-surface border border-538-border rounded-lg shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-538-border flex-shrink-0">
          <div>
            <div className="font-bold text-538-text text-sm">
              {awayTeamName} <span className="font-normal text-538-muted">@</span> {homeTeamName}
            </div>
            <div className="text-2xs mt-0.5">
              {(isLive || isFinal) && awayScore !== null ? (
                <span style={{ color: isLive ? '#16a34a' : '#888' }}>
                  {isFinal ? 'FINAL' : '● LIVE'}: {awayScore} – {homeScore}
                  <span className="text-538-muted ml-2">· Run values via linear weights</span>
                </span>
              ) : (
                <span className="text-538-muted">Game not yet started</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-538-muted hover:text-538-text text-base leading-none w-7 h-7 flex items-center justify-center rounded-full hover:bg-538-bg flex-shrink-0"
          >
            ✕
          </button>
        </div>

        {isPreview ? (
          <div className="flex-1 flex items-center justify-center text-center text-538-muted text-sm p-8">
            Game hasn't started yet. Check back once the game is Live or Final.
          </div>
        ) : loading ? (
          <div className="flex-1 flex items-center justify-center text-538-muted text-sm">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: `${BLUE} transparent` }} />
              Loading play-by-play…
            </div>
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center text-center p-8">
            <div>
              <div className="text-sm text-red-500 mb-2">Could not load game data</div>
              <div className="text-2xs text-538-muted">{error}</div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden min-h-0">
            {/* Left: player list */}
            <div className="flex flex-col flex-1 overflow-hidden border-r border-538-border min-w-0">
              {/* Team tabs */}
              <div className="flex border-b border-538-border flex-shrink-0">
                {(['away', 'home'] as const).map(t => (
                  <button key={t} onClick={() => setTab(t)}
                    className="flex-1 py-2 text-xs font-semibold uppercase tracking-wide transition-colors"
                    style={{
                      color: tab === t ? BLUE : undefined,
                      borderBottom: tab === t ? `2px solid ${BLUE}` : '2px solid transparent',
                    }}>
                    {t === 'away' ? `${awayTeamAbbr} (Away)` : `${homeTeamAbbr} (Home)`}
                  </button>
                ))}
              </div>

              {/* Column headers */}
              <div className="flex items-center gap-2 px-3 py-1.5 border-b border-538-border bg-538-bg flex-shrink-0">
                <div className="w-28 text-2xs font-bold uppercase tracking-widest text-538-muted">Player</div>
                <div className="flex-1 text-2xs font-bold uppercase tracking-widest text-538-muted">Run Value</div>
                <div className="w-14 text-right text-2xs font-bold uppercase tracking-widest text-538-muted">RAR</div>
                <div className="w-4" />
              </div>

              {/* Players */}
              <div className="overflow-y-auto flex-1">
                {currentPlayers.length === 0 ? (
                  <div className="text-center text-538-muted text-xs py-8">
                    {isLive ? 'Waiting for plate appearances…' : 'No batter data found.'}
                  </div>
                ) : (
                  currentPlayers.map(p => (
                    <PlayerRarRow
                      key={p.batterId}
                      player={p}
                      isSelected={selected?.batterId === p.batterId}
                      maxAbsRar={maxAbsRar}
                      onSelect={() => handleSelect(p)}
                    />
                  ))
                )}
                <div className="px-3 py-2 text-2xs text-538-muted border-t border-538-border">
                  RAR = linear weights − replacement baseline · Click player for field · ▼ for events
                </div>
              </div>
            </div>

            {/* Right: baseball field */}
            <div className="w-64 flex-shrink-0 flex flex-col items-center justify-center p-3 overflow-hidden">
              {selected ? (
                <BaseballField
                  events={selected.events}
                  playerName={selected.name}
                  animKey={fieldKey}
                />
              ) : (
                <div className="flex flex-col items-center text-center text-538-muted text-xs gap-3 opacity-40">
                  <svg viewBox="0 0 80 76" style={{ width: 56, height: 54 }}>
                    <polygon points="40,68 58,50 40,32 22,50" fill="none" stroke="currentColor" strokeWidth="2" />
                    <path d="M 8 20 Q 40 4 72 20" fill="none" stroke="currentColor" strokeWidth="1.5" />
                    <line x1="40" y1="68" x2="8" y2="20" stroke="currentColor" strokeWidth="1.5" />
                    <line x1="40" y1="68" x2="72" y2="20" stroke="currentColor" strokeWidth="1.5" />
                  </svg>
                  <span>Select a player<br/>to view field</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
