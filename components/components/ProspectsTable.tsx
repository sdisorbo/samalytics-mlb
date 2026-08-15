'use client'

import { useState, useEffect, Fragment } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Batter {
  playerId: number; name: string; level: string; teamName: string; teamAbbr: string
  g: number; pa: number; avg: number; obp: number; slg: number; ops: number
  hr: number; rbi: number; sb: number
}

interface Pitcher {
  playerId: number; name: string; level: string; teamName: string; teamAbbr: string
  g: number; gs: number; ip: string; era: number; whip: number
  k9: number; bb9: number; wins: number; losses: number
}

interface CareerSeason {
  year: string; level: string; team: string; teamAbbr: string
  g: number | null; pa: number | null
  avg: number | null; obp: number | null; slg: number | null; ops: number | null
  hr: number | null; rbi: number | null; sb: number | null
  gs: number | null; ip: string | null; era: number | null; whip: number | null
  k9: number | null; wins: number | null; losses: number | null
}

// ── Level badge ────────────────────────────────────────────────────────────────

const LEVEL_STYLE: Record<string, string> = {
  AAA: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  AA:  'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'A+':'bg-violet-500/20 text-violet-400 border-violet-500/30',
  A:   'bg-orange-500/20 text-orange-400 border-orange-500/30',
  MLB: 'bg-538-orange/20 text-538-orange border-538-orange/30',
  R:   'bg-gray-500/20 text-538-muted border-gray-500/30',
}

function LevelBadge({ level }: { level: string }) {
  return (
    <span className={`inline-block text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${LEVEL_STYLE[level] ?? 'bg-gray-500/20 text-538-muted border-gray-500/30'}`}>
      {level}
    </span>
  )
}

// ── Format helpers ─────────────────────────────────────────────────────────────

function fmt3(v: number | null | undefined): string {
  if (v == null) return '—'
  return v.toFixed(3).replace(/^0/, '')
}
function fmtF2(v: number | null | undefined): string {
  if (v == null) return '—'
  return v.toFixed(2)
}

// ── Expanded career row ────────────────────────────────────────────────────────

function CareerRow({ playerId, group }: { playerId: number; group: 'hitting' | 'pitching' }) {
  const [seasons, setSeasons] = useState<CareerSeason[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/prospect-career?playerId=${playerId}&group=${group}`)
      .then(r => r.ok ? r.json() : [])
      .then(setSeasons)
      .catch(() => setSeasons([]))
      .finally(() => setLoading(false))
  }, [playerId, group])

  if (loading) {
    return (
      <div className="px-4 py-3 text-xs text-538-muted animate-pulse">Loading career stats…</div>
    )
  }

  if (!seasons || !seasons.length) {
    return <div className="px-4 py-3 text-xs text-538-muted">No career data available.</div>
  }

  const isBatter = group === 'hitting'

  return (
    <div className="overflow-x-auto bg-538-bg/50">
      <table className="w-full text-[11px] tabular-nums">
        <thead>
          <tr className="text-[9px] uppercase tracking-widest text-538-muted border-b border-538-border/50">
            <th className="px-4 py-1.5 text-left font-bold">Year</th>
            <th className="px-3 py-1.5 text-left font-bold">Level</th>
            <th className="px-3 py-1.5 text-left font-bold">Team</th>
            <th className="px-3 py-1.5 text-right font-bold">G</th>
            {isBatter ? <>
              <th className="px-3 py-1.5 text-right font-bold">PA</th>
              <th className="px-3 py-1.5 text-right font-bold">AVG</th>
              <th className="px-3 py-1.5 text-right font-bold">OBP</th>
              <th className="px-3 py-1.5 text-right font-bold">SLG</th>
              <th className="px-3 py-1.5 text-right font-bold">OPS</th>
              <th className="px-3 py-1.5 text-right font-bold">HR</th>
              <th className="px-3 py-1.5 text-right font-bold">RBI</th>
              <th className="px-3 py-1.5 text-right font-bold">SB</th>
            </> : <>
              <th className="px-3 py-1.5 text-right font-bold">GS</th>
              <th className="px-3 py-1.5 text-right font-bold">IP</th>
              <th className="px-3 py-1.5 text-right font-bold">ERA</th>
              <th className="px-3 py-1.5 text-right font-bold">WHIP</th>
              <th className="px-3 py-1.5 text-right font-bold">K/9</th>
            </>}
          </tr>
        </thead>
        <tbody>
          {seasons.map((s, i) => (
            <tr key={`${s.year}-${s.team}`} className={`border-b border-538-border/30 ${i % 2 === 0 ? '' : 'bg-538-bg/30'}`}>
              <td className="px-4 py-1.5 text-left font-semibold text-538-text">{s.year}</td>
              <td className="px-3 py-1.5 text-left"><LevelBadge level={s.level} /></td>
              <td className="px-3 py-1.5 text-left text-538-muted truncate max-w-[120px]">{s.teamAbbr || s.team}</td>
              <td className="px-3 py-1.5 text-right text-538-text">{s.g ?? '—'}</td>
              {isBatter ? <>
                <td className="px-3 py-1.5 text-right text-538-text">{s.pa ?? '—'}</td>
                <td className="px-3 py-1.5 text-right text-538-text">{fmt3(s.avg)}</td>
                <td className="px-3 py-1.5 text-right text-538-text">{fmt3(s.obp)}</td>
                <td className="px-3 py-1.5 text-right text-538-text">{fmt3(s.slg)}</td>
                <td className="px-3 py-1.5 text-right font-semibold text-538-text">{fmt3(s.ops)}</td>
                <td className="px-3 py-1.5 text-right text-538-text">{s.hr ?? '—'}</td>
                <td className="px-3 py-1.5 text-right text-538-text">{s.rbi ?? '—'}</td>
                <td className="px-3 py-1.5 text-right text-538-text">{s.sb ?? '—'}</td>
              </> : <>
                <td className="px-3 py-1.5 text-right text-538-text">{s.gs ?? '—'}</td>
                <td className="px-3 py-1.5 text-right text-538-text">{s.ip ?? '—'}</td>
                <td className="px-3 py-1.5 text-right font-semibold text-538-text">{fmtF2(s.era)}</td>
                <td className="px-3 py-1.5 text-right text-538-text">{fmtF2(s.whip)}</td>
                <td className="px-3 py-1.5 text-right text-538-text">{s.k9?.toFixed(1) ?? '—'}</td>
              </>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main table ─────────────────────────────────────────────────────────────────

type SortKey = 'name' | 'level' | 'g' | 'pa' | 'ops' | 'avg' | 'hr' | 'rbi' | 'era' | 'ip' | 'k9' | 'whip'

export default function ProspectsTable({ teamAbbr }: { teamAbbr: string }) {
  const [batters, setBatters] = useState<Batter[]>([])
  const [pitchers, setPitchers] = useState<Pitcher[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<'batters' | 'pitchers'>('batters')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'ops', dir: -1 })

  useEffect(() => {
    setLoading(true)
    fetch(`/api/prospects?teamAbbr=${teamAbbr}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(d => { setBatters(d.batters ?? []); setPitchers(d.pitchers ?? []) })
      .catch(() => setError('Could not load farm system data.'))
      .finally(() => setLoading(false))
  }, [teamAbbr])

  function toggleSort(key: SortKey) {
    setSort(s => s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: -1 })
    setExpanded(null)
  }

  function sortedBatters() {
    const { key, dir } = sort
    return [...batters].sort((a, b) => {
      const av = a[key as keyof Batter] as number | string
      const bv = b[key as keyof Batter] as number | string
      if (key === 'name' || key === 'level') return dir * String(av).localeCompare(String(bv))
      return dir * ((bv as number) - (av as number))
    })
  }

  function sortedPitchers() {
    const { key, dir } = sort
    return [...pitchers].sort((a, b) => {
      const av = a[key as keyof Pitcher] as number | string
      const bv = b[key as keyof Pitcher] as number | string
      if (key === 'name' || key === 'level') return dir * String(av).localeCompare(String(bv))
      return dir * ((bv as number) - (av as number))
    })
  }

  function Th({ label, sortKey, right = true }: { label: string; sortKey: SortKey; right?: boolean }) {
    const active = sort.key === sortKey
    return (
      <th
        onClick={() => toggleSort(sortKey)}
        className={`px-3 py-2.5 font-bold cursor-pointer select-none text-[10px] uppercase tracking-widest transition-colors whitespace-nowrap ${right ? 'text-right' : 'text-left'} ${active ? 'text-538-text' : 'text-538-muted hover:text-538-text'}`}
      >
        {label}{active ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}
      </th>
    )
  }

  const isBatterSort = ['pa', 'ops', 'avg', 'hr', 'rbi'].includes(sort.key)
  const isPitcherSort = ['era', 'ip', 'k9', 'whip'].includes(sort.key)

  function handleTabSwitch(newTab: 'batters' | 'pitchers') {
    setTab(newTab)
    setExpanded(null)
    if (newTab === 'batters' && isPitcherSort) setSort({ key: 'ops', dir: -1 })
    if (newTab === 'pitchers' && isBatterSort) setSort({ key: 'era', dir: 1 })
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-bold text-538-text">Farm System</h2>
          <p className="text-xs text-538-muted mt-0.5">AAA · AA · A+ · A affiliates · {new Date().getFullYear()} season stats via MLB Stats API</p>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-538-border text-[11px] font-semibold">
          <button
            onClick={() => handleTabSwitch('batters')}
            className={`px-3 py-1.5 transition-colors ${tab === 'batters' ? 'bg-538-orange text-white' : 'text-538-muted hover:text-538-text'}`}
          >
            Batters {!loading && `(${batters.length})`}
          </button>
          <button
            onClick={() => handleTabSwitch('pitchers')}
            className={`px-3 py-1.5 transition-colors border-l border-538-border ${tab === 'pitchers' ? 'bg-538-orange text-white' : 'text-538-muted hover:text-538-text'}`}
          >
            Pitchers {!loading && `(${pitchers.length})`}
          </button>
        </div>
      </div>

      {loading && (
        <div className="rounded-xl border border-538-border bg-538-card animate-pulse">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-10 border-b border-538-border/50 px-4 flex items-center gap-3">
              <div className="h-3 w-8 bg-538-border/40 rounded" />
              <div className="h-3 w-32 bg-538-border/40 rounded" />
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-538-muted py-4">{error}</p>}

      {!loading && !error && tab === 'batters' && (
        <div className="rounded-xl border border-538-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead className="border-b border-538-border bg-538-card">
                <tr>
                  <Th label="Level" sortKey="level" right={false} />
                  <Th label="Player" sortKey="name" right={false} />
                  <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-widest text-538-muted font-bold">Team</th>
                  <Th label="G" sortKey="g" />
                  <Th label="PA" sortKey="pa" />
                  <Th label="AVG" sortKey="avg" />
                  <Th label="OBP" sortKey="ops" />
                  <Th label="SLG" sortKey="ops" />
                  <Th label="OPS" sortKey="ops" />
                  <Th label="HR" sortKey="hr" />
                  <Th label="RBI" sortKey="rbi" />
                  <th className="px-3 py-2.5 text-right text-[10px] uppercase tracking-widest text-538-muted font-bold">SB</th>
                </tr>
              </thead>
              <tbody>
                {sortedBatters().map((b, i) => {
                  const isOpen = expanded === b.playerId
                  return (
                    <Fragment key={b.playerId}>
                      <tr
                        onClick={() => setExpanded(isOpen ? null : b.playerId)}
                        className={`border-b border-538-border/50 cursor-pointer transition-colors ${isOpen ? 'bg-538-bg' : i % 2 === 0 ? 'hover:bg-538-bg/50' : 'bg-538-bg/30 hover:bg-538-bg/50'}`}
                      >
                        <td className="px-3 py-2.5"><LevelBadge level={b.level} /></td>
                        <td className="px-3 py-2.5 font-semibold text-538-text whitespace-nowrap">
                          <span className="flex items-center gap-1.5">
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={`text-538-muted shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}>
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                            {b.name}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-538-muted">{b.teamAbbr}</td>
                        <td className="px-3 py-2.5 text-right text-538-text">{b.g}</td>
                        <td className="px-3 py-2.5 text-right text-538-text">{b.pa}</td>
                        <td className="px-3 py-2.5 text-right text-538-text">{fmt3(b.avg)}</td>
                        <td className="px-3 py-2.5 text-right text-538-text">{fmt3(b.obp)}</td>
                        <td className="px-3 py-2.5 text-right text-538-text">{fmt3(b.slg)}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-538-text">{fmt3(b.ops)}</td>
                        <td className="px-3 py-2.5 text-right text-538-text">{b.hr}</td>
                        <td className="px-3 py-2.5 text-right text-538-text">{b.rbi}</td>
                        <td className="px-3 py-2.5 text-right text-538-text">{b.sb}</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={12} className="p-0 border-b border-538-border">
                            <CareerRow playerId={b.playerId} group="hitting" />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {!batters.length && (
                  <tr><td colSpan={12} className="px-4 py-8 text-center text-sm text-538-muted">No batter data found for this organization.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && !error && tab === 'pitchers' && (
        <div className="rounded-xl border border-538-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead className="border-b border-538-border bg-538-card">
                <tr>
                  <Th label="Level" sortKey="level" right={false} />
                  <Th label="Player" sortKey="name" right={false} />
                  <th className="px-3 py-2.5 text-left text-[10px] uppercase tracking-widest text-538-muted font-bold">Team</th>
                  <Th label="G" sortKey="g" />
                  <th className="px-3 py-2.5 text-right text-[10px] uppercase tracking-widest text-538-muted font-bold">GS</th>
                  <Th label="IP" sortKey="ip" />
                  <Th label="ERA" sortKey="era" />
                  <Th label="WHIP" sortKey="whip" />
                  <Th label="K/9" sortKey="k9" />
                  <th className="px-3 py-2.5 text-right text-[10px] uppercase tracking-widest text-538-muted font-bold">BB/9</th>
                  <th className="px-3 py-2.5 text-right text-[10px] uppercase tracking-widest text-538-muted font-bold">W-L</th>
                </tr>
              </thead>
              <tbody>
                {sortedPitchers().map((p, i) => {
                  const isOpen = expanded === p.playerId
                  return (
                    <Fragment key={p.playerId}>
                      <tr
                        onClick={() => setExpanded(isOpen ? null : p.playerId)}
                        className={`border-b border-538-border/50 cursor-pointer transition-colors ${isOpen ? 'bg-538-bg' : i % 2 === 0 ? 'hover:bg-538-bg/50' : 'bg-538-bg/30 hover:bg-538-bg/50'}`}
                      >
                        <td className="px-3 py-2.5"><LevelBadge level={p.level} /></td>
                        <td className="px-3 py-2.5 font-semibold text-538-text whitespace-nowrap">
                          <span className="flex items-center gap-1.5">
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={`text-538-muted shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}>
                              <polyline points="9 18 15 12 9 6" />
                            </svg>
                            {p.name}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-538-muted">{p.teamAbbr}</td>
                        <td className="px-3 py-2.5 text-right text-538-text">{p.g}</td>
                        <td className="px-3 py-2.5 text-right text-538-text">{p.gs}</td>
                        <td className="px-3 py-2.5 text-right text-538-text">{p.ip}</td>
                        <td className="px-3 py-2.5 text-right font-semibold text-538-text">{fmtF2(p.era)}</td>
                        <td className="px-3 py-2.5 text-right text-538-text">{fmtF2(p.whip)}</td>
                        <td className="px-3 py-2.5 text-right text-538-text">{p.k9.toFixed(1)}</td>
                        <td className="px-3 py-2.5 text-right text-538-text">{p.bb9.toFixed(1)}</td>
                        <td className="px-3 py-2.5 text-right text-538-text">{p.wins}–{p.losses}</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={11} className="p-0 border-b border-538-border">
                            <CareerRow playerId={p.playerId} group="pitching" />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
                {!pitchers.length && (
                  <tr><td colSpan={11} className="px-4 py-8 text-center text-sm text-538-muted">No pitcher data found for this organization.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
