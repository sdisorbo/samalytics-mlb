'use client'

import { useState, useMemo } from 'react'
import type { Player } from '@/lib/types'
import { teamColor } from '@/lib/teamColors'
import clsx from 'clsx'

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

function pctColor(v: number): string {
  if (v >= 70) return '#27AE60'
  if (v >= 40) return '#F39C12'
  return '#E74C3C'
}

function formatStat(val: number | null, key: keyof Player): string {
  if (val == null) return '—'
  if (key === 'k_pct' || key === 'bb_pct') return `${val.toFixed(1)}%`
  return (val as number).toFixed(3).replace(/^0/, '')
}

function PlayerCard({ player }: { player: Player }) {
  const color = teamColor(player.team)
  return (
    <div className="stat-card hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-semibold text-538-text text-sm">{player.name}</p>
          <p className="text-2xs text-538-muted mt-0.5 uppercase tracking-wide">
            {player.position} · {player.team_name}
          </p>
        </div>
        <span
          className="text-white font-bold rounded px-1.5 py-0.5"
          style={{ backgroundColor: color, fontSize: '0.6rem' }}
        >
          {player.team}
        </span>
      </div>

      {/* Percentile bars */}
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
    </div>
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
            className="border border-538-border rounded px-2.5 py-1 text-xs bg-white focus:outline-none focus:border-538-blue w-44"
          />
        </div>

        <div className="flex flex-col gap-0.5">
          <label className="text-2xs uppercase tracking-wide text-538-muted font-semibold">Team</label>
          <select
            value={team}
            onChange={e => { setTeam(e.target.value); resetPage() }}
            className="border border-538-border rounded px-2 py-1 text-xs bg-white"
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
            className="border border-538-border rounded px-2 py-1 text-xs bg-white"
          >
            {positions.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-0.5">
          <label className="text-2xs uppercase tracking-wide text-538-muted font-semibold">Sort by</label>
          <select
            value={sortStat as string}
            onChange={e => { setSortStat(e.target.value as keyof Player); resetPage() }}
            className="border border-538-border rounded px-2 py-1 text-xs bg-white"
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
