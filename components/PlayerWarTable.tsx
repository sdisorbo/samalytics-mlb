'use client'

import { useState, useMemo } from 'react'
import type { PlayerWar, LegendWar } from '../lib/types'
import dynamic from 'next/dynamic'

const WarComparisonModal = dynamic(() => import('./WarComparisonModal'), { ssr: false })

// ── Position groups ───────────────────────────────────────────────────────────
const POSITIONS = ['All', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'OF', 'DH']

// ── Multi-stop teal/pink WAR color scale (same as standings) ─────────────────
function lerpHex(a: string, b: string, t: number): string {
  const ah = parseInt(a.slice(1), 16), bh = parseInt(b.slice(1), 16)
  const ar = (ah >> 16) & 0xff, ag = (ah >> 8) & 0xff, ab = ah & 0xff
  const br = (bh >> 16) & 0xff, bg = (bh >> 8) & 0xff, bb = bh & 0xff
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const b2 = Math.round(ab + (bb - ab) * t)
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b2.toString(16).padStart(2,'0')}`
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
  const t = (value - min) / (max - min)
  return t >= 0.5
    ? multiStop(TEAL, (t - 0.5) * 2)
    : multiStop(PINK, 1 - t * 2)
}

// ── Sort icon ─────────────────────────────────────────────────────────────────
function SortIcon({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  return (
    <span className={`ml-1 inline-block text-xs ${active ? 'text-538-orange' : 'text-538-muted/40'}`}>
      {active ? (dir === 'desc' ? '▼' : '▲') : '⇅'}
    </span>
  )
}

type SortKey = 'war' | 'off_war' | 'def_war' | 'g' | 'pa'

interface Props {
  players: PlayerWar[]
  legendWar: LegendWar
}

export default function PlayerWarTable({ players, legendWar }: Props) {
  const [position, setPosition] = useState('All')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('war')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selected, setSelected] = useState<PlayerWar | null>(null)

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  // Derive position from existing data (players.json has position field joined in WAR page)
  const filtered = useMemo(() => {
    let rows = players.filter((p) => p.pa >= 50)
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter((p) => p.name.toLowerCase().includes(q) || p.team.toLowerCase().includes(q))
    }
    // Position filter is handled by the parent — we'll just sort/display here.
    rows = [...rows].sort((a, b) => {
      const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0
      return sortDir === 'desc' ? bv - av : av - bv
    })
    return rows
  }, [players, search, sortKey, sortDir])

  // Color scale bounds
  const wars = filtered.map((p) => p.war)
  const minWar = Math.min(...wars), maxWar = Math.max(...wars)
  const offWars = filtered.map((p) => p.off_war)
  const minOff = Math.min(...offWars), maxOff = Math.max(...offWars)
  const defWars = filtered.map((p) => p.def_war)
  const minDef = Math.min(...defWars), maxDef = Math.max(...defWars)

  const cols: { key: SortKey; label: string; title: string }[] = [
    { key: 'g',       label: 'G',    title: 'Games played' },
    { key: 'pa',      label: 'PA',   title: 'Plate appearances' },
    { key: 'off_war', label: 'Off',  title: 'Offensive WAR (runs above avg / 10)' },
    { key: 'def_war', label: 'Def',  title: 'Defensive WAR (runs above avg / 10)' },
    { key: 'war',     label: 'WAR',  title: 'Total Wins Above Replacement (bRef bWAR)' },
  ]

  return (
    <>
      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <input
          type="text"
          placeholder="Search player or team…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-538-border rounded px-3 py-1.5 text-sm bg-surface text-538-text placeholder-538-muted focus:outline-none focus:ring-1 focus:ring-538-orange w-52"
        />
        <div className="flex flex-wrap gap-1">
          {POSITIONS.map((pos) => (
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
        <span className="text-xs text-538-muted ml-auto">{filtered.length} players · 50+ PA</span>
      </div>

      {/* ── Table ── */}
      <div className="overflow-x-auto rounded-lg border border-538-border">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b-2 border-538-border bg-surface">
              <th className="text-left py-3 px-3 text-538-muted font-bold text-xs w-10">#</th>
              <th className="text-left py-3 px-3 text-538-muted font-bold text-xs min-w-[160px]">Player</th>
              <th className="text-center py-3 px-3 text-538-muted font-bold text-xs">Age</th>
              <th className="text-center py-3 px-3 text-538-muted font-bold text-xs">Team</th>
              {cols.map((c) => (
                <th key={c.key}
                  className="text-right py-3 px-3 text-538-muted font-bold text-xs cursor-pointer hover:text-538-text select-none"
                  title={c.title}
                  onClick={() => handleSort(c.key)}
                >
                  {c.label}
                  <SortIcon active={sortKey === c.key} dir={sortDir} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((player, idx) => {
              const isEven = idx % 2 === 0
              return (
                <tr
                  key={player.player_id ?? player.name}
                  onClick={() => setSelected(player)}
                  className="border-b border-538-border/40 cursor-pointer hover:bg-538-orange/5 transition-colors"
                  style={{ backgroundColor: isEven ? 'var(--color-surface)' : 'var(--color-surface-alt, rgba(0,0,0,0.02))' }}
                >
                  <td className="py-2.5 px-3 text-538-muted text-xs font-bold">{idx + 1}</td>
                  <td className="py-2.5 px-3">
                    <span className="font-semibold text-538-text">{player.name}</span>
                  </td>
                  <td className="py-2.5 px-3 text-center text-538-muted text-xs">—</td>
                  <td className="py-2.5 px-3 text-center text-xs font-semibold text-538-muted">{player.team}</td>
                  <td className="py-2.5 px-3 text-right text-538-muted text-xs">{player.g}</td>
                  <td className="py-2.5 px-3 text-right text-538-muted text-xs">{player.pa}</td>

                  {/* oWAR — orange-tinted color scale */}
                  <td className="py-2.5 px-3 text-right text-xs font-mono font-semibold"
                    style={{ color: warColor(player.off_war, minOff, maxOff) }}>
                    {player.off_war > 0 ? '+' : ''}{player.off_war.toFixed(1)}
                  </td>

                  {/* dWAR */}
                  <td className="py-2.5 px-3 text-right text-xs font-mono font-semibold"
                    style={{ color: warColor(player.def_war, minDef, maxDef) }}>
                    {player.def_war > 0 ? '+' : ''}{player.def_war.toFixed(1)}
                  </td>

                  {/* Total WAR — background cell color */}
                  <td className="py-2.5 px-3 text-right text-xs font-mono font-bold rounded-sm"
                    style={{
                      backgroundColor: warColor(player.war, minWar, maxWar) + '55',
                      color: 'var(--color-text)',
                    }}>
                    {player.war > 0 ? '+' : ''}{player.war.toFixed(1)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-538-muted mt-3">
        Click any player to compare their WAR to historical legends. Data: Baseball Reference bWAR.
      </p>

      {/* ── Modal ── */}
      {selected && (
        <WarComparisonModal
          player={selected}
          allPlayers={players}
          legendWar={legendWar}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}
