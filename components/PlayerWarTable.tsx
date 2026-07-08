'use client'

import { useState } from 'react'
import Image from 'next/image'
import type { PlayerWar, LegendWar } from '../lib/types'
import dynamic from 'next/dynamic'

const WarComparisonModal = dynamic(() => import('./WarComparisonModal'), { ssr: false })

// bRef team abbr → ESPN team abbr for logo CDN
const ESPN_ABBR: Record<string, string> = {
  BAL: 'bal', BOS: 'bos', NYY: 'nyy', TBR: 'tb',  TOR: 'tor',
  CHW: 'cws', CLE: 'cle', DET: 'det', KCR: 'kc',  MIN: 'min',
  HOU: 'hou', LAA: 'laa', OAK: 'oak', SEA: 'sea', TEX: 'tex',
  ATL: 'atl', MIA: 'mia', NYM: 'nym', PHI: 'phi', WSN: 'wsh',
  CHC: 'chc', CIN: 'cin', MIL: 'mil', PIT: 'pit', STL: 'stl',
  ARI: 'ari', COL: 'col', LAD: 'lad', SDP: 'sd',  SFG: 'sf',
  ATH: 'oak',
}

function TeamLogo({ team, size = 20 }: { team: string; size?: number }) {
  const abbr = ESPN_ABBR[team]
  if (!abbr) return null
  return (
    <Image
      src={`https://a.espncdn.com/i/teamlogos/mlb/500/${abbr}.png`}
      alt={team}
      width={size}
      height={size}
      className="object-contain flex-shrink-0"
      unoptimized
    />
  )
}

export interface PlayerWarWithPos extends PlayerWar {
  position?: string
}

// ── Position groups ───────────────────────────────────────────────────────────
const ALL_POSITIONS = ['All', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'DH']

// ── Multi-stop teal/pink WAR color scale ──────────────────────────────────────
function lerpHex(a: string, b: string, t: number): string {
  const ah = parseInt(a.slice(1), 16), bh = parseInt(b.slice(1), 16)
  const ar = (ah >> 16) & 0xff, ag = (ah >> 8) & 0xff, ab2 = ah & 0xff
  const br = (bh >> 16) & 0xff, bg = (bh >> 8) & 0xff, bb2 = bh & 0xff
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const b3 = Math.round(ab2 + (bb2 - ab2) * t)
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b3.toString(16).padStart(2,'0')}`
}
function multiStop(stops: string[], t: number): string {
  if (t <= 0) return stops[0]
  if (t >= 1) return stops[stops.length - 1]
  const seg = (stops.length - 1) * t
  const lo = Math.floor(seg)
  return lerpHex(stops[lo], stops[lo + 1], seg - lo)
}
const TEAL = ['#CFE8E8','#8EC6C8','#5BAEB3','#3C999E']
const PINK = ['#F3D6DB','#E5A8B5','#C96E85','#9B405A']

function warColor(value: number, min: number, max: number): string {
  if (max === min) return '#F3D6DB'
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)))
  return t >= 0.5
    ? multiStop(TEAL, (t - 0.5) * 2)
    : multiStop(PINK, 1 - t * 2)
}

type SortKey = 'war' | 'off_war' | 'def_war' | 'g' | 'pa'

function getVal(p: PlayerWarWithPos, key: SortKey): number {
  if (key === 'war')     return p.war
  if (key === 'off_war') return p.off_war
  if (key === 'def_war') return p.def_war
  if (key === 'g')       return p.g
  if (key === 'pa')      return p.pa
  return 0
}

interface Props {
  players: PlayerWarWithPos[]
  legendWar: LegendWar
}

export default function PlayerWarTable({ players, legendWar }: Props) {
  const [position, setPosition]   = useState('All')
  const [team, setTeam]           = useState('All')
  const [search, setSearch]       = useState('')
  const [sortKey, setSortKey]     = useState<SortKey>('war')
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('desc')
  const [selected, setSelected]   = useState<PlayerWarWithPos | null>(null)

  // Sorted unique team list derived from qualified players
  const teamOptions = ['All', ...Array.from(
    new Set(players.filter((p) => p.pa >= 50).map((p) => p.team))
  ).sort()]

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  // Compute inline — no useMemo so state changes always immediately take effect
  let filtered = players.filter((p) => p.pa >= 50)

  if (search.trim()) {
    const q = search.trim().toLowerCase()
    filtered = filtered.filter(
      (p) => p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q),
    )
  }

  if (position !== 'All') {
    filtered = filtered.filter((p) => {
      const pos = p.position ?? ''
      if (position === 'OF') return ['LF', 'CF', 'RF', 'OF'].includes(pos)
      return pos === position
    })
  }

  if (team !== 'All') {
    filtered = filtered.filter((p) => p.team === team)
  }

  filtered = [...filtered].sort((a, b) => {
    const av = getVal(a, sortKey)
    const bv = getVal(b, sortKey)
    return sortDir === 'desc' ? bv - av : av - bv
  })

  const wars    = filtered.map((p) => p.war)
  const offWars = filtered.map((p) => p.off_war)
  const defWars = filtered.map((p) => p.def_war)
  const minWar  = wars.length    ? Math.min(...wars)    : 0
  const maxWar  = wars.length    ? Math.max(...wars)    : 0
  const minOff  = offWars.length ? Math.min(...offWars) : 0
  const maxOff  = offWars.length ? Math.max(...offWars) : 0
  const minDef  = defWars.length ? Math.min(...defWars) : 0
  const maxDef  = defWars.length ? Math.max(...defWars) : 0

  const cols: { key: SortKey; label: string; title: string }[] = [
    { key: 'g',       label: 'G',   title: 'Games played' },
    { key: 'pa',      label: 'PA',  title: 'Plate appearances' },
    { key: 'off_war', label: 'Off', title: 'Offensive WAR' },
    { key: 'def_war', label: 'Def', title: 'Defensive WAR' },
    { key: 'war',     label: 'WAR', title: 'Total Wins Above Replacement (bRef bWAR)' },
  ]

  return (
    <>
      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <input
          type="text"
          placeholder="Search player…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-538-border rounded px-3 py-1.5 text-sm bg-surface text-538-text placeholder-538-muted focus:outline-none focus:ring-1 focus:ring-538-orange w-44"
        />
        <select
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          className="border border-538-border rounded px-3 py-1.5 text-sm bg-surface text-538-text focus:outline-none focus:ring-1 focus:ring-538-orange"
        >
          {teamOptions.map((t) => (
            <option key={t} value={t}>{t === 'All' ? 'All Teams' : t}</option>
          ))}
        </select>
        <div className="flex flex-wrap gap-1">
          {ALL_POSITIONS.map((pos) => (
            <button
              key={pos}
              onClick={() => setPosition(pos)}
              className={`px-2.5 py-1 text-xs font-semibold rounded transition-colors border ${
                position === pos
                  ? 'bg-538-orange text-white border-538-orange'
                  : 'text-538-muted border-538-border hover:text-538-text'
              }`}
            >
              {pos}
            </button>
          ))}
        </div>
        <span className="text-xs text-538-muted ml-auto">
          {filtered.length} players
        </span>
      </div>

      {/* ── Table ── */}
      <div className="overflow-x-auto rounded-lg border border-538-border">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b-2 border-538-border bg-surface">
              <th className="text-left py-3 px-3 text-538-muted font-bold text-xs w-10 select-none">#</th>
              <th className="text-left py-3 px-3 text-538-muted font-bold text-xs min-w-[160px] select-none">Player</th>
              <th className="text-center py-3 px-3 text-538-muted font-bold text-xs select-none">Pos</th>
              <th className="text-center py-3 px-3 text-538-muted font-bold text-xs select-none">Team</th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className="text-right py-3 px-3 text-538-muted font-bold text-xs cursor-pointer hover:text-538-text select-none"
                  title={c.title}
                  onClick={() => handleSort(c.key)}
                >
                  {c.label}
                  <span className={`ml-1 ${sortKey === c.key ? 'text-538-orange' : 'text-538-muted/30'}`}>
                    {sortKey === c.key ? (sortDir === 'desc' ? '▼' : '▲') : '⇅'}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-538-muted text-sm">
                  No players match your filters.
                </td>
              </tr>
            )}
            {filtered.map((player, idx) => (
              <tr
                key={player.bref_id}
                onClick={() => setSelected(player)}
                className={`border-b border-538-border/40 cursor-pointer hover:bg-538-orange/5 transition-colors ${
                  idx % 2 === 1 ? 'bg-black/[0.02] dark:bg-white/[0.02]' : ''
                }`}
              >
                <td className="py-2.5 px-3 text-538-muted text-xs font-bold">{idx + 1}</td>
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-2">
                    <TeamLogo team={player.team} size={22} />
                    <span className="font-semibold text-538-text text-sm">{player.name}</span>
                  </div>
                </td>
                <td className="py-2.5 px-3 text-center text-538-muted text-xs">{player.position ?? '—'}</td>
                <td className="py-2.5 px-3 text-center text-xs font-semibold text-538-muted">{player.team}</td>
                <td className="py-2.5 px-3 text-right text-538-muted text-xs">{player.g}</td>
                <td className="py-2.5 px-3 text-right text-538-muted text-xs">{player.pa}</td>
                <td
                  className="py-2.5 px-3 text-right text-xs font-mono font-semibold"
                  style={{ color: warColor(player.off_war, minOff, maxOff) }}
                >
                  {(player.off_war > 0 ? '+' : '') + player.off_war.toFixed(1)}
                </td>
                <td
                  className="py-2.5 px-3 text-right text-xs font-mono font-semibold"
                  style={{ color: warColor(player.def_war, minDef, maxDef) }}
                >
                  {(player.def_war > 0 ? '+' : '') + player.def_war.toFixed(1)}
                </td>
                <td
                  className="py-2.5 px-3 text-right text-xs font-mono font-bold"
                  style={{
                    backgroundColor: warColor(player.war, minWar, maxWar) + '55',
                  }}
                >
                  {(player.war > 0 ? '+' : '') + player.war.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-538-muted mt-3">
        Click any player to compare against historical legends. Data: Baseball Reference bWAR · 50+ PA minimum.
      </p>

      {selected && (
        <WarComparisonModal
          player={selected}
          legendWar={legendWar}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}
