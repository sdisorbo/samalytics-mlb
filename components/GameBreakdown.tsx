'use client'

import { useState, useEffect } from 'react'
import type { SimBatter, BatterProjection } from '../lib/mlbSimulator'

const BLUE = '#1467EB'
const REPL_AVG_BASES = 0.22

// ── Deterministic RNG ─────────────────────────────────────────────────────────

function mkRng(seed: number) {
  let s = ((seed * 1664525 + 1013904223) & 0x7fffffff) >>> 0
  return () => {
    s = ((s * 1664525 + 1013904223) & 0x7fffffff) >>> 0
    return s / 0x7fffffff
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Outcome = 'HR' | '3B' | '2B' | '1B' | 'BB' | 'K' | 'OUT'

interface GameEvent {
  id: number
  outcome: Outcome
  description: string
  inning: number
  sprayAngle: number
  rar: number
}

interface PlayerBreakdown {
  playerId: number
  name: string
  projRar: number
  avgBases: number
  events: GameEvent[]
}

export interface GameBreakdownProps {
  awayTeamName: string
  homeTeamName: string
  awayTeamAbbr: string
  homeTeamAbbr: string
  awayLineup: SimBatter[]
  homeLineup: SimBatter[]
  awayBatterProjections: BatterProjection[]
  homeBatterProjections: BatterProjection[]
  awayScore: number | null
  homeScore: number | null
  gameStatus: string
  onClose: () => void
}

// ── Event generation ──────────────────────────────────────────────────────────

const OUTCOME_RAR: Record<Outcome, number> = {
  HR:  0.42,
  '3B': 0.26,
  '2B': 0.18,
  '1B': 0.09,
  BB:   0.04,
  OUT: -0.04,
  K:   -0.06,
}

const OUTCOME_DIST: Record<Outcome, number> = {
  HR:  235,
  '3B': 192,
  '2B': 160,
  '1B': 115,
  BB:    0,
  OUT:  90,
  K:     0,
}

const OUTCOME_DESCRIPTIONS: Record<Outcome, string[]> = {
  HR:  ['Solo home run', 'Two-run homer', 'Line drive HR', 'Towering home run'],
  '3B': ['Triple to the gap', 'Triple to right-center'],
  '2B': ['Double to left', 'Double to the right-center gap', 'Double down the line'],
  '1B': ['Single up the middle', 'Infield single', 'Single to left', 'Single through the right side'],
  BB:   ['Walk (4-pitch)', 'Bases on balls', 'Full-count walk'],
  K:    ['Strikeout swinging', 'Called strikeout', 'Strikeout on foul tip'],
  OUT:  ['Groundout to 2B', 'Flyout to CF', 'Lineout to SS', 'Groundout to 3B', 'Pop fly out to 1B'],
}

function generateEvents(batter: SimBatter, n = 4): GameEvent[] {
  const rng = mkRng(Math.abs(batter.playerId) * 7919 + 13)
  const events: GameEvent[] = []

  for (let i = 0; i < n; i++) {
    const r = rng()
    let outcome: Outcome

    if (r < batter.kPct) {
      outcome = 'K'
    } else if (r < batter.kPct + batter.bbPct) {
      outcome = 'BB'
    } else if (r < batter.kPct + batter.bbPct + batter.hrPerAb * (1 - batter.kPct - batter.bbPct)) {
      outcome = 'HR'
    } else {
      const inPlayR = rng()
      if (inPlayR < batter.babip) {
        const hitR = rng()
        const tri = batter.tripleShare ?? 0.04
        const dbl = batter.doubleShare ?? 0.28
        outcome = hitR < tri ? '3B' : hitR < tri + dbl ? '2B' : '1B'
      } else {
        outcome = 'OUT'
      }
    }

    const spray = Math.max(-42, Math.min(42, (rng() * 70 - 35)))
    const descs = OUTCOME_DESCRIPTIONS[outcome]
    const desc = descs[Math.floor(rng() * descs.length)]
    const innings = [1, 2, 3, 4, 5, 6, 7, 8, 9]

    events.push({
      id: i,
      outcome,
      description: desc,
      inning: innings[i % 9],
      sprayAngle: spray,
      rar: OUTCOME_RAR[outcome],
    })
  }

  return events
}

function buildBreakdown(
  lineup: SimBatter[],
  projections: BatterProjection[],
): PlayerBreakdown[] {
  return lineup.map((b, i) => {
    const avgBases = projections[i]?.avgBases ?? 0.3
    return {
      playerId: b.playerId,
      name: b.name,
      projRar: (avgBases - REPL_AVG_BASES) * 1.0,
      avgBases,
      events: generateEvents(b, 4),
    }
  })
}

// ── Baseball field SVG ────────────────────────────────────────────────────────

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
      <div className="text-xs font-bold mb-2 truncate w-full text-center" style={{ color: BLUE }}>
        {playerName}
      </div>
      <svg viewBox="0 0 400 385" style={{ width: '100%', maxWidth: 320, display: 'block' }}>
        {/* Outfield arc */}
        <path d="M 28 102 Q 200 8 372 102" fill="none" stroke={BLUE} strokeWidth="1.5" opacity="0.45" />
        {/* Foul lines */}
        <line x1="200" y1="350" x2="28" y2="102" stroke={BLUE} strokeWidth="1.2" opacity="0.45" />
        <line x1="200" y1="350" x2="372" y2="102" stroke={BLUE} strokeWidth="1.2" opacity="0.45" />
        {/* Diamond */}
        <polygon
          points="200,350 295,255 200,160 105,255"
          fill="none"
          stroke={BLUE}
          strokeWidth="1.5"
          opacity="0.8"
        />
        {/* Mound */}
        <circle cx="200" cy="232" r="7" fill="none" stroke={BLUE} strokeWidth="1" opacity="0.5" />
        {/* Base squares */}
        {[
          { cx: 295, cy: 255 },
          { cx: 200, cy: 160 },
          { cx: 105, cy: 255 },
        ].map(({ cx, cy }, i) => (
          <rect key={i} x={cx - 4} y={cy - 4} width="8" height="8"
            fill={BLUE} opacity="0.35" rx="1" />
        ))}
        {/* Home plate */}
        <polygon points="200,353 206,358 204,365 196,365 194,358"
          fill={BLUE} opacity="0.5" />

        {/* Hit trajectories */}
        {hitEvents.map((e, i) => {
          const [tx, ty] = hitEndpoint(e.sprayAngle, OUTCOME_DIST[e.outcome])
          const isPos = e.rar >= 0
          const lineColor = e.outcome === 'HR' ? BLUE : isPos ? '#3b82f6' : '#ef4444'
          const pathLen = Math.hypot(tx - 200, ty - 350)
          const delay = i * 0.18
          return (
            <g key={`${animKey}-${e.id}`}>
              <path
                d={`M 200 350 L ${tx.toFixed(1)} ${ty.toFixed(1)}`}
                fill="none"
                stroke={lineColor}
                strokeWidth={e.outcome === 'HR' ? 2 : 1.5}
                strokeLinecap="round"
                style={{
                  strokeDasharray: pathLen,
                  strokeDashoffset: pathLen,
                  animation: `gbDraw 0.45s ease ${delay}s forwards`,
                }}
              />
              <circle
                cx={tx}
                cy={ty}
                r={e.outcome === 'HR' ? 4 : 3}
                fill={lineColor}
                style={{
                  opacity: 0,
                  animation: `gbFade 0.15s ease ${delay + 0.4}s forwards`,
                }}
              />
              <text
                x={tx + (tx > 205 ? 7 : tx < 195 ? -7 : 0)}
                y={ty + (ty < 200 ? -5 : 12)}
                fontSize="9"
                fontWeight="bold"
                fill={lineColor}
                textAnchor={tx > 205 ? 'start' : tx < 195 ? 'end' : 'middle'}
                style={{
                  opacity: 0,
                  animation: `gbFade 0.2s ease ${delay + 0.4}s forwards`,
                }}
              >
                {isPos ? '+' : ''}{e.rar.toFixed(2)}
              </text>
            </g>
          )
        })}

        {/* Plate events (K / BB) */}
        {plateEvents.map((e, i) => (
          <text
            key={`${animKey}-plate-${e.id}`}
            x={200 + (i - (plateEvents.length - 1) / 2) * 16}
            y={382}
            fontSize="10"
            fontWeight="bold"
            textAnchor="middle"
            fill={e.outcome === 'K' ? '#ef4444' : BLUE}
            style={{
              opacity: 0,
              animation: `gbFade 0.2s ease ${hitEvents.length * 0.18 + 0.15}s forwards`,
            }}
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

function PlayerRarRow({
  player,
  isSelected,
  maxAbsRar,
  onSelect,
}: {
  player: PlayerBreakdown
  isSelected: boolean
  maxAbsRar: number
  onSelect: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const rar = player.projRar
  const barPct = maxAbsRar > 0 ? (Math.abs(rar) / maxAbsRar) * 100 : 0
  const isPos = rar >= 0

  return (
    <div>
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer rounded transition-colors"
        style={{ backgroundColor: isSelected ? `${BLUE}12` : undefined }}
        onClick={onSelect}
        onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = '#f8f9fa' }}
        onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = '' }}
      >
        <div className="w-28 text-xs font-semibold text-538-text truncate">{player.name}</div>
        <div className="flex-1 h-3 flex items-center">
          <div
            className="h-1.5 rounded-full"
            style={{
              width: `${barPct}%`,
              backgroundColor: isPos ? BLUE : '#ef4444',
              opacity: 0.75,
              transition: 'width 0.3s ease',
            }}
          />
        </div>
        <div
          className="text-xs font-mono font-bold w-14 text-right"
          style={{ color: isPos ? BLUE : '#ef4444' }}
        >
          {isPos ? '+' : ''}{rar.toFixed(2)}
        </div>
        <button
          className="text-538-muted hover:text-538-text text-xs w-4 flex-shrink-0 leading-none"
          onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
          title="Expand events"
        >
          {expanded ? '▲' : '▼'}
        </button>
      </div>

      {expanded && (
        <div
          className="mx-3 mb-1 rounded-sm overflow-hidden text-2xs"
          style={{ borderLeft: `2px solid ${BLUE}40` }}
        >
          {player.events.map(ev => (
            <div key={ev.id} className="flex items-center gap-2 px-3 py-1 border-b border-538-border last:border-0">
              <span
                className="font-bold font-mono rounded px-1 leading-4 flex-shrink-0"
                style={{
                  fontSize: '9px',
                  color: '#fff',
                  backgroundColor:
                    ev.outcome === 'HR' ? BLUE
                    : ev.rar >= 0 ? '#3b82f6'
                    : '#ef4444',
                }}
              >
                {ev.outcome}
              </span>
              <span className="text-538-muted flex-1">{ev.description}</span>
              <span className="font-mono font-bold flex-shrink-0"
                style={{ color: ev.rar >= 0 ? BLUE : '#ef4444' }}
              >
                {ev.rar >= 0 ? '+' : ''}{ev.rar.toFixed(2)}
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
  awayTeamName,
  homeTeamName,
  awayTeamAbbr,
  homeTeamAbbr,
  awayLineup,
  homeLineup,
  awayBatterProjections,
  homeBatterProjections,
  awayScore,
  homeScore,
  gameStatus,
  onClose,
}: GameBreakdownProps) {
  const [tab, setTab] = useState<'away' | 'home'>('away')
  const [selected, setSelected] = useState<PlayerBreakdown | null>(null)
  const [fieldKey, setFieldKey] = useState(0)

  const awayPlayers = buildBreakdown(awayLineup, awayBatterProjections)
  const homePlayers = buildBreakdown(homeLineup, homeBatterProjections)
  const currentPlayers = (tab === 'away' ? awayPlayers : homePlayers)
    .slice()
    .sort((a, b) => b.projRar - a.projRar)
  const maxAbsRar = Math.max(...currentPlayers.map(p => Math.abs(p.projRar)), 0.01)

  function handleSelect(player: PlayerBreakdown) {
    if (selected?.playerId === player.playerId) {
      setSelected(null)
    } else {
      setSelected(player)
      setFieldKey(k => k + 1)
    }
  }

  // Reset selection when switching tabs
  useEffect(() => { setSelected(null) }, [tab])

  const isLive = gameStatus === 'Live'
  const isFinal = gameStatus === 'Final'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3"
      style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="bg-surface border border-538-border rounded-lg shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col"
        style={{ maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-538-border flex-shrink-0">
          <div>
            <div className="font-bold text-538-text text-sm">
              {awayTeamName} <span className="text-538-muted font-normal">@</span> {homeTeamName}
            </div>
            <div className="text-2xs mt-0.5">
              {(isLive || isFinal) && awayScore !== null && homeScore !== null ? (
                <span style={{ color: isLive ? '#16a34a' : '#888' }}>
                  {isFinal ? 'FINAL' : '● LIVE'}: {awayScore} – {homeScore}
                  <span className="text-538-muted ml-2">· RAR based on 500-game projection</span>
                </span>
              ) : (
                <span className="text-538-muted">Projected RAR per player · 500-game simulation</span>
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

        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Left: player list */}
          <div className="flex flex-col flex-1 overflow-hidden border-r border-538-border min-w-0">
            {/* Team tabs */}
            <div className="flex border-b border-538-border flex-shrink-0">
              {(['away', 'home'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className="flex-1 py-2 text-xs font-semibold uppercase tracking-wide transition-colors"
                  style={{
                    color: tab === t ? BLUE : undefined,
                    borderBottom: tab === t ? `2px solid ${BLUE}` : '2px solid transparent',
                  }}
                >
                  {t === 'away' ? `${awayTeamAbbr} (Away)` : `${homeTeamAbbr} (Home)`}
                </button>
              ))}
            </div>

            {/* Column headers */}
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-538-border bg-538-bg flex-shrink-0">
              <div className="w-28 text-2xs font-bold uppercase tracking-widest text-538-muted">Player</div>
              <div className="flex-1 text-2xs font-bold uppercase tracking-widest text-538-muted">RAR</div>
              <div className="w-14 text-right text-2xs font-bold uppercase tracking-widest text-538-muted">Proj.</div>
              <div className="w-4" />
            </div>

            {/* Players */}
            <div className="overflow-y-auto flex-1">
              {currentPlayers.map(p => (
                <PlayerRarRow
                  key={p.playerId}
                  player={p}
                  isSelected={selected?.playerId === p.playerId}
                  maxAbsRar={maxAbsRar}
                  onSelect={() => handleSelect(p)}
                />
              ))}
              <div className="px-3 py-2 text-2xs text-538-muted border-t border-538-border">
                Click player to animate field · ▼ to expand events
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
              <div className="flex flex-col items-center text-center text-538-muted text-xs gap-3 opacity-50">
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
      </div>
    </div>
  )
}
