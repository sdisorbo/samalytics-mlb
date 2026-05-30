'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import type { Player } from '@/lib/types'
import { teamColor } from '@/lib/teamColors'

interface Props {
  players: Player[]
  allTeams: string[]
}

const STATS: { key: keyof Player; label: string; pctKey: keyof Player; higherBetter: boolean }[] = [
  { key: 'ops',    label: 'OPS',   pctKey: 'ops_percentile',    higherBetter: true  },
  { key: 'avg',    label: 'AVG',   pctKey: 'avg_percentile',    higherBetter: true  },
  { key: 'obp',    label: 'OBP',   pctKey: 'obp_percentile',    higherBetter: true  },
  { key: 'slg',    label: 'SLG',   pctKey: 'slg_percentile',    higherBetter: true  },
  { key: 'k_pct',  label: 'K%',    pctKey: 'k_pct_percentile',  higherBetter: false },
  { key: 'bb_pct', label: 'BB%',   pctKey: 'bb_pct_percentile', higherBetter: true  },
]

// ── Color helpers ──────────────────────────────────────────────────────────────

function pctColor(v: number): string {
  const t = 1 - Math.min(Math.max(v, 0), 100) / 100
  const teal = [60, 153, 158]
  const pink = [155, 64, 90]
  const r = Math.round(teal[0] + (pink[0] - teal[0]) * t)
  const g = Math.round(teal[1] + (pink[1] - teal[1]) * t)
  const b = Math.round(teal[2] + (pink[2] - teal[2]) * t)
  return `rgb(${r},${g},${b})`
}

function formatStat(val: number | null, key: keyof Player): string {
  if (val == null) return '—'
  if (key === 'k_pct' || key === 'bb_pct') return `${val.toFixed(1)}%`
  return (val as number).toFixed(3).replace(/^0/, '')
}

// ── Zone grid types & helpers ──────────────────────────────────────────────────

interface ZoneCell {
  row: number
  col: number
  pa: number
  ab: number
  h: number
  tb: number
  bb: number
  avg: number | null
  slg: number | null
  obp: number | null
  ops: number | null
  total_pitches: number
  zone_pct: number | null
}

interface PitchTypeEntry {
  code: string
  name: string
  count: number
  zones: ZoneCell[][]
}

interface BatterZoneData {
  batterName: string
  teamAbbr: string
  season: number
  seasonStats: {
    avg: number
    obp: number
    slg: number
    ops: number
    k_pct: number
    bb_pct: number
    hr: number
    rbi: number
    sb: number
    hits: number
    ab: number
    pa: number
  }
  zones: ZoneCell[][]
  totals: {
    pa: number
    ab: number
    h: number
    tb: number
    bb: number
    avg: number | null
    slg: number | null
    obp: number | null
    ops: number | null
  }
  pitchTypes: PitchTypeEntry[]
  sprayPoints: { x: number; y: number; eventType: string; pitchType: string }[]
}

type StatKey = 'avg' | 'obp' | 'slg' | 'ops' | 'zone_pct'

const TEAL = '#3C999E'
const PINK = '#9B405A'
const EMPTY_CELL = '#374151'

const CELL_W = 36
const CELL_H = 30

// Strike zone boundary: inner 3×3 (rows 1–3, cols 1–3)
const SZ_X = CELL_W
const SZ_Y = CELL_H
const SZ_W = CELL_W * 3
const SZ_H = CELL_H * 3

const STAT_TABS: { key: StatKey; label: string }[] = [
  { key: 'avg',      label: 'AVG'   },
  { key: 'obp',      label: 'OBP'   },
  { key: 'slg',      label: 'SLG'   },
  { key: 'ops',      label: 'OPS'   },
  { key: 'zone_pct', label: 'Zone%' },
]

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
}

function interpolateColor(t: number): string {
  const [tr, tg, tb] = hexToRgb(TEAL)
  const [pr, pg, pb] = hexToRgb(PINK)
  return rgbToHex(lerp(tr, pr, t), lerp(tg, pg, t), lerp(tb, pb, t))
}

function buildColorMap(cells: ZoneCell[], key: StatKey): Map<string, string> {
  const values: { row: number; col: number; val: number }[] = []
  for (const cell of cells) {
    const val = (cell as unknown as Record<string, number | null>)[key]
    if (val !== null && val !== undefined) {
      values.push({ row: cell.row, col: cell.col, val })
    }
  }

  if (values.length === 0) return new Map()

  const nums = values.map(v => v.val)
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const range = max - min

  const map = new Map<string, string>()
  for (const { row, col, val } of values) {
    const t = range > 0 ? (val - min) / range : 0.5
    map.set(`${row}-${col}`, interpolateColor(t))
  }
  return map
}

function formatZoneStat(val: number | null, key: StatKey): string {
  if (val === null) return '-'
  if (key === 'zone_pct') return `${Math.round(val * 100)}%`
  if (key === 'avg' || key === 'obp' || key === 'slg') return val.toFixed(3).replace(/^0/, '')
  return val.toFixed(3)
}

// ── Compact Zone Grid (for card) ───────────────────────────────────────────────

interface CompactZoneGridProps {
  zones: ZoneCell[][]
  pitchTypes: PitchTypeEntry[]
}

function CompactZoneGrid({ zones, pitchTypes }: CompactZoneGridProps) {
  const [activeStat, setActiveStat] = useState<StatKey>('avg')
  const [selectedPitchType, setSelectedPitchType] = useState<string>('ALL')

  const activeZones =
    selectedPitchType === 'ALL'
      ? zones
      : (pitchTypes.find(pt => pt.code === selectedPitchType)?.zones ?? zones)

  const flatCells: ZoneCell[] = activeZones.flat()
  const colorMap = buildColorMap(flatCells, activeStat)

  const gridW = CELL_W * 5
  const gridH = CELL_H * 5

  const handleButtonClick = (e: React.MouseEvent, fn: () => void) => {
    e.preventDefault()
    e.stopPropagation()
    fn()
  }

  return (
    <div className="flex flex-col gap-2" onClick={e => e.stopPropagation()}>
      {/* Pitch type toggles */}
      <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
        <button
          onClick={e => handleButtonClick(e, () => setSelectedPitchType('ALL'))}
          className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded transition-colors whitespace-nowrap"
          style={
            selectedPitchType === 'ALL'
              ? { backgroundColor: '#3D405B', color: '#fff' }
              : { backgroundColor: 'transparent', color: '#9CA3AF', border: '1px solid #374151' }
          }
        >
          All
        </button>
        {pitchTypes.map(pt => (
          <button
            key={pt.code}
            onClick={e => handleButtonClick(e, () => setSelectedPitchType(pt.code))}
            className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded transition-colors whitespace-nowrap"
            style={
              selectedPitchType === pt.code
                ? { backgroundColor: '#3D405B', color: '#fff' }
                : { backgroundColor: 'transparent', color: '#9CA3AF', border: '1px solid #374151' }
            }
          >
            {pt.name.split(' ')[0]}
          </button>
        ))}
      </div>

      {/* Stat tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {STAT_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={e => handleButtonClick(e, () => setActiveStat(key))}
            className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded transition-colors"
            style={
              activeStat === key
                ? { backgroundColor: '#3D405B', color: '#fff' }
                : { backgroundColor: 'transparent', color: '#9CA3AF', border: '1px solid #374151' }
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* SVG grid */}
      <svg
        width={gridW}
        height={gridH}
        viewBox={`0 0 ${gridW} ${gridH}`}
        style={{ display: 'block' }}
      >
        {activeZones.map((rowCells, row) =>
          rowCells.map((cell, col) => {
            const key = `${row}-${col}`
            const color = colorMap.get(key) ?? EMPTY_CELL
            const statVal = (cell as unknown as Record<string, number | null>)[activeStat] as number | null
            const x = col * CELL_W
            const y = row * CELL_H

            return (
              <g key={key}>
                <rect
                  x={x + 1}
                  y={y + 1}
                  width={CELL_W - 2}
                  height={CELL_H - 2}
                  rx={2}
                  fill={color}
                />
                <text
                  x={x + CELL_W / 2}
                  y={y + CELL_H / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={8}
                  fill={statVal !== null ? '#fff' : '#6B7280'}
                  fontFamily="monospace"
                  fontWeight={statVal !== null ? '700' : '400'}
                >
                  {formatZoneStat(statVal, activeStat)}
                </text>
              </g>
            )
          }),
        )}

        {/* Strike zone boundary */}
        <rect
          x={SZ_X}
          y={SZ_Y}
          width={SZ_W}
          height={SZ_H}
          fill="none"
          stroke="#94A3B8"
          strokeWidth={1.5}
        />
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-2 text-[8px] text-538-muted">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: TEAL }} />
          <span>Better</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: PINK }} />
          <span>Worse</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: EMPTY_CELL }} />
          <span>None</span>
        </div>
      </div>
      <span className="text-[7px] text-538-muted">Catcher&apos;s view · inner box = strike zone</span>
    </div>
  )
}

// ── Zone page skeleton ─────────────────────────────────────────────────────────

function ZoneSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-3 w-32 bg-538-border/30 rounded" />
      <div className="h-3 w-24 bg-538-border/30 rounded" />
      <div className="h-36 w-full bg-538-border/30 rounded" />
    </div>
  )
}

// ── PlayerCard ─────────────────────────────────────────────────────────────────

const currentSeason = new Date().getFullYear()

function PlayerCard({ player }: { player: Player }) {
  const color = teamColor(player.team)
  const [cardPage, setCardPage] = useState(0)
  const [zoneData, setZoneData] = useState<BatterZoneData | null>(null)
  const [zoneLoading, setZoneLoading] = useState(false)
  const [zoneError, setZoneError] = useState('')

  function goToPage(e: React.MouseEvent, page: number) {
    e.preventDefault()
    e.stopPropagation()

    setCardPage(page)

    if (page === 1 && zoneData === null && !zoneLoading) {
      setZoneLoading(true)
      setZoneError('')
      fetch(`/api/batter-season/zones?batterId=${player.player_id}&season=${currentSeason}`)
        .then(r => {
          if (!r.ok) throw new Error('Failed to load zone data')
          return r.json() as Promise<BatterZoneData>
        })
        .then(data => {
          setZoneData(data)
        })
        .catch((err: Error) => {
          setZoneError(err.message)
        })
        .finally(() => setZoneLoading(false))
    }
  }

  return (
    <Link href={`/batters/${player.player_id}`} className="block">
      <div className="stat-card hover:shadow-md transition-shadow cursor-pointer">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="font-semibold text-538-text text-sm">{player.name}</p>
            <p className="text-2xs text-538-muted mt-0.5 uppercase tracking-wide">
              {player.position} · {player.team_name}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Page dot indicators */}
            <div
              className="flex items-center gap-1"
              onClick={e => e.stopPropagation()}
            >
              <button
                onClick={e => goToPage(e, 0)}
                aria-label="Stats page"
                className="w-2 h-2 rounded-full transition-colors"
                style={{
                  backgroundColor: cardPage === 0 ? color : '#4B5563',
                  border: cardPage === 0 ? 'none' : '1px solid #6B7280',
                }}
              />
              <button
                onClick={e => goToPage(e, 1)}
                aria-label="Zone page"
                className="w-2 h-2 rounded-full transition-colors"
                style={{
                  backgroundColor: cardPage === 1 ? color : '#4B5563',
                  border: cardPage === 1 ? 'none' : '1px solid #6B7280',
                }}
              />
            </div>
            <span
              className="text-white font-bold rounded px-1.5 py-0.5"
              style={{ backgroundColor: color, fontSize: '0.6rem' }}
            >
              {player.team}
            </span>
          </div>
        </div>

        {/* Page 0: Percentile stats */}
        {cardPage === 0 && (
          <div className="space-y-1.5">
            {STATS.map(({ key, label, pctKey }) => {
              const val = player[key] as number | null
              const pct = player[pctKey] as number
              const col = pctColor(pct)
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-7 text-2xs font-semibold text-538-muted uppercase shrink-0">{label}</span>
                  <div className="flex-1 pct-bar" style={{ height: '7px' }}>
                    <div
                      className="h-full rounded"
                      style={{ width: `${pct}%`, backgroundColor: col }}
                    />
                  </div>
                  <span className="w-10 text-right tabular text-xs text-538-muted shrink-0">
                    {formatStat(val, key)}
                  </span>
                  <span
                    className="w-6 text-right tabular text-2xs font-bold shrink-0"
                    style={{ color: col }}
                  >
                    {pct}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* Page 1: Zone breakdown */}
        {cardPage === 1 && (
          <div onClick={e => e.stopPropagation()}>
            {zoneLoading && <ZoneSkeleton />}
            {zoneError && !zoneLoading && (
              <p className="text-xs text-538-muted py-2">{zoneError}</p>
            )}
            {zoneData && !zoneLoading && (
              <CompactZoneGrid
                zones={zoneData.zones}
                pitchTypes={zoneData.pitchTypes}
              />
            )}
          </div>
        )}
      </div>
    </Link>
  )
}

export default function PlayerList({ players, allTeams }: Props) {
  const [search, setSearch] = useState('')
  const [team, setTeam] = useState('All')
  const [pos, setPos] = useState('All')
  const [sortStat, setSortStat] = useState<keyof Player>('ops')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 24

  const positions = useMemo(() => {
    const s = new Set(players.map(p => p.position).filter(Boolean))
    return ['All', ...Array.from(s).sort()]
  }, [players])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return players
      .filter(p => {
        if (search && !p.name.toLowerCase().includes(q) && !p.team.toLowerCase().includes(q)) return false
        if (team !== 'All' && p.team !== team) return false
        if (pos !== 'All' && p.position !== pos) return false
        return true
      })
      .sort((a, b) => {
        const av = a[sortStat] as number | null ?? -1
        const bv = b[sortStat] as number | null ?? -1
        return bv - av
      })
  }, [players, search, team, pos, sortStat])

  const page_count = Math.ceil(filtered.length / PAGE_SIZE)
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  function resetPage() { setPage(0) }

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-end">
        <div className="flex flex-col gap-0.5">
          <label className="text-2xs uppercase tracking-wide text-538-muted font-semibold">Search</label>
          <input
            type="text"
            placeholder="Player or team…"
            value={search}
            onChange={e => { setSearch(e.target.value); resetPage() }}
            className="border border-538-border rounded px-2.5 py-1 text-xs bg-surface focus:outline-none focus:border-538-blue w-44"
          />
        </div>

        <div className="flex flex-col gap-0.5">
          <label className="text-2xs uppercase tracking-wide text-538-muted font-semibold">Team</label>
          <select
            value={team}
            onChange={e => { setTeam(e.target.value); resetPage() }}
            className="border border-538-border rounded px-2 py-1 text-xs bg-surface"
          >
            <option value="All">All Teams</option>
            {allTeams.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-0.5">
          <label className="text-2xs uppercase tracking-wide text-538-muted font-semibold">Position</label>
          <select
            value={pos}
            onChange={e => { setPos(e.target.value); resetPage() }}
            className="border border-538-border rounded px-2 py-1 text-xs bg-surface"
          >
            {positions.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-0.5">
          <label className="text-2xs uppercase tracking-wide text-538-muted font-semibold">Sort by</label>
          <select
            value={sortStat as string}
            onChange={e => { setSortStat(e.target.value as keyof Player); resetPage() }}
            className="border border-538-border rounded px-2 py-1 text-xs bg-surface"
          >
            {STATS.map(s => <option key={s.key as string} value={s.key as string}>{s.label}</option>)}
          </select>
        </div>

        <span className="text-xs text-538-muted ml-auto self-center">
          {filtered.length} players
        </span>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {visible.map(p => (
          <PlayerCard key={p.player_id} player={p} />
        ))}
      </div>

      {/* Pagination */}
      {page_count > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1 text-xs border border-538-border rounded disabled:opacity-30 hover:bg-gray-100"
          >
            ← Prev
          </button>
          <span className="text-xs text-538-muted">
            {page + 1} / {page_count}
          </span>
          <button
            onClick={() => setPage(p => Math.min(page_count - 1, p + 1))}
            disabled={page === page_count - 1}
            className="px-3 py-1 text-xs border border-538-border rounded disabled:opacity-30 hover:bg-gray-100"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
