'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import type {
  Pitcher,
  Player,
  PitcherArsenal,
  BatterVsPitch,
} from '../lib/types'
import {
  predict,
  advanceCount,
  endsAtBat,
  type Count,
  type PitchEvent,
} from '../lib/liveAtBat'
import { LogicBreakdown, Code } from './LogicBreakdown'

// ── Pitch colors (shared with MatchupTool) ────────────────────────────────────
const PITCH_COLORS: Record<string, string> = {
  FF: '#C62828', SI: '#E64A19', FC: '#F57C00',
  SL: '#1565C0', ST: '#6A1B9A', SV: '#7B1FA2',
  CU: '#283593', KC: '#37474F',
  CH: '#2E7D32', FS: '#00695C',
  KN: '#546E7A', EP: '#78909C',
}
const pitchColor = (pt: string) => PITCH_COLORS[pt] ?? '#888'

const EVENT_LABEL: Record<PitchEvent, string> = {
  ball: 'B',
  called_strike: 'Sₗ',
  swinging_strike: 'Sₛ',
  foul: 'F',
  in_play: 'IP',
  hbp: 'HBP',
}
const EVENT_COLOR: Record<PitchEvent, string> = {
  ball: '#558B6E',
  called_strike: '#C62828',
  swinging_strike: '#C62828',
  foul: '#F57C00',
  in_play: '#1565C0',
  hbp: '#7B1FA2',
}

function fmtPct(v: number | null | undefined, dec = 0): string {
  if (v === null || v === undefined || !isFinite(v)) return '—'
  return `${(v * 100).toFixed(dec)}%`
}
function fmtPctRaw(v: number | null | undefined, dec = 0): string {
  // value already in percent units
  if (v === null || v === undefined || !isFinite(v)) return '—'
  return `${v.toFixed(dec)}%`
}
function fmtWoba(v: number | null | undefined): string {
  if (v === null || v === undefined || !isFinite(v)) return '—'
  return v.toFixed(3).replace(/^0/, '')
}

// ── Searchable Dropdown ───────────────────────────────────────────────────────
function SearchDropdown<T extends { player_id: number; name: string; team: string }>({
  items,
  selected,
  onSelect,
  placeholder,
}: {
  items: T[]
  selected: T | null
  onSelect: (item: T | null) => void
  placeholder: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return items
      .filter((it) => it.name.toLowerCase().includes(q) || it.team.toLowerCase().includes(q))
      .slice(0, 25)
  }, [items, query])

  return (
    <div ref={ref} className="relative w-full">
      <div className="flex items-center border border-538-border rounded-sm bg-surface">
        {selected && !open ? (
          <div className="flex items-center flex-1 px-3 py-2 gap-2">
            <span className="font-semibold text-538-text text-sm">{selected.name}</span>
            <span
              className="text-xs font-bold px-1.5 py-0.5 rounded"
              style={{ color: '#fff', backgroundColor: '#3D405B' }}
            >
              {selected.team}
            </span>
            <button
              onClick={() => {
                onSelect(null)
                setQuery('')
              }}
              className="ml-auto text-538-muted hover:text-538-text text-sm leading-none"
            >
              ✕
            </button>
          </div>
        ) : (
          <input
            className="flex-1 px-3 py-2 text-sm outline-none bg-transparent text-538-text placeholder:text-538-muted"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
          />
        )}
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-surface border border-538-border rounded-sm shadow-xl max-h-64 overflow-y-auto">
          {filtered.map((item) => (
            <button
              key={item.player_id}
              className="w-full text-left px-3 py-2 text-sm hover:bg-538-bg flex items-center gap-2 border-b border-538-border last:border-0"
              onClick={() => {
                onSelect(item)
                setQuery('')
                setOpen(false)
              }}
            >
              <span className="font-medium text-538-text">{item.name}</span>
              <span className="text-xs text-538-muted">{item.team}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Indicator dots ────────────────────────────────────────────────────────────
function Dots({
  count,
  active,
  color,
}: {
  count: number
  active: number
  color: string
}) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="w-3.5 h-3.5 rounded-full border-2 transition-colors"
          style={{
            borderColor: color,
            backgroundColor: i < active ? color : 'transparent',
          }}
        />
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  pitchers: Pitcher[]
  batters: Player[]
  arsenal: PitcherArsenal[]
  batterVsPitch: BatterVsPitch[]
}

export default function LiveAtBat({ pitchers, batters, arsenal, batterVsPitch }: Props) {
  const [pitcher, setPitcher] = useState<Pitcher | null>(null)
  const [batter, setBatter] = useState<Player | null>(null)
  const [count, setCount] = useState<Count>({ balls: 0, strikes: 0 })
  const [outs, setOuts] = useState(0)
  // Each logged pitch carries both the pitch type that was thrown and the
  // outcome event. pitchesThrown is the ordered list of pitch types feeding
  // the sequence-conditioning model.
  const [sequence, setSequence] = useState<{ pitch_type: string; ev: PitchEvent }[]>([])
  const [primedPitch, setPrimedPitch] = useState<string | null>(null) // user override
  const [paLog, setPaLog] = useState<{ ev: PitchEvent; finalCount: Count }[]>([])

  const pitchesThrown = useMemo(() => sequence.map((s) => s.pitch_type), [sequence])

  // Pitcher arsenal lookup
  const pitcherArsenal = useMemo(() => {
    if (!pitcher) return null
    return arsenal.find((a) => a.player_id === pitcher.player_id) ?? null
  }, [pitcher, arsenal])

  // Batter splits lookup
  const batterSplits = useMemo(() => {
    if (!batter) return null
    return batterVsPitch.find((b) => b.player_id === batter.player_id) ?? null
  }, [batter, batterVsPitch])

  // Derived K%/BB% rates
  const pitcherRates = useMemo(() => {
    if (!pitcher) return undefined
    // K_per_9 / ~38 PA-per-9 ≈ K%. Same for BB.
    return {
      k_pct: (pitcher.k_per_9 ?? 0) / 38,
      bb_pct: (pitcher.bb_per_9 ?? 0) / 38,
    }
  }, [pitcher])

  const batterRates = useMemo(() => {
    if (!batter) return undefined
    return {
      k_pct: batter.k_pct !== null && batter.k_pct !== undefined ? batter.k_pct / 100 : null,
      bb_pct: batter.bb_pct !== null && batter.bb_pct !== undefined ? batter.bb_pct / 100 : null,
    }
  }, [batter])

  // Prediction for current count + sequence so far
  const prediction = useMemo(() => {
    if (!pitcherArsenal) return null
    return predict(
      pitcherArsenal.pitches,
      count,
      batterSplits?.vs_pitches ?? null,
      pitcherRates,
      batterRates,
      pitchesThrown,
    )
  }, [pitcherArsenal, count, batterSplits, pitcherRates, batterRates, pitchesThrown])

  // The currently "armed" pitch — defaults to the model's expected pitch but
  // user can click a different chip to override.
  const activePitch =
    primedPitch ??
    (prediction && prediction.pitches.length > 0 ? prediction.pitches[0].pitch_type : null)

  // Handlers
  function logPitch(ev: PitchEvent) {
    if (!pitcher || !activePitch) return
    if (endsAtBat(count, ev)) {
      setPaLog((l) => [...l, { ev, finalCount: count }])
      if ((ev === 'called_strike' || ev === 'swinging_strike') && count.strikes >= 2) {
        setOuts((o) => Math.min(3, o + 1))
      }
      setCount({ balls: 0, strikes: 0 })
      setSequence([])
      setPrimedPitch(null)
    } else {
      setSequence((s) => [...s, { pitch_type: activePitch, ev }])
      setCount((c) => advanceCount(c, ev))
      setPrimedPitch(null) // re-default to expected for next pitch
    }
  }

  function undoPitch() {
    if (sequence.length === 0) return
    const newSeq = sequence.slice(0, -1)
    let c: Count = { balls: 0, strikes: 0 }
    for (const e of newSeq) c = advanceCount(c, e.ev)
    setSequence(newSeq)
    setCount(c)
    setPrimedPitch(null)
  }

  function resetAB() {
    setCount({ balls: 0, strikes: 0 })
    setSequence([])
    setPrimedPitch(null)
  }

  function nextInning() {
    setOuts(0)
    setCount({ balls: 0, strikes: 0 })
    setSequence([])
    setPrimedPitch(null)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Selectors */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-semibold text-538-muted uppercase tracking-wider mb-1 block">
            Pitcher
          </label>
          <SearchDropdown
            items={pitchers}
            selected={pitcher}
            onSelect={setPitcher}
            placeholder="Select pitcher…"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-538-muted uppercase tracking-wider mb-1 block">
            Batter <span className="text-538-muted/70 font-normal lowercase">(optional)</span>
          </label>
          <SearchDropdown
            items={batters}
            selected={batter}
            onSelect={setBatter}
            placeholder="Select batter…"
          />
        </div>
      </div>

      {/* Count panel */}
      <div className="border border-538-border rounded bg-surface p-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-538-muted uppercase w-14">Balls</span>
            <Dots count={3} active={count.balls} color="#558B6E" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-538-muted uppercase w-14">Strikes</span>
            <Dots count={2} active={count.strikes} color="#C62828" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-538-muted uppercase w-14">Outs</span>
            <Dots count={2} active={outs} color="#37474F" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-538-muted uppercase">Pitches</span>
            <span className="text-sm font-bold tabular-nums">{sequence.length}</span>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={undoPitch}
              disabled={sequence.length === 0}
              className="px-2 py-1 text-xs border border-538-border rounded text-538-muted hover:text-538-text disabled:opacity-40"
            >
              ↶ Undo
            </button>
            <button
              onClick={resetAB}
              className="px-2 py-1 text-xs border border-538-border rounded text-538-muted hover:text-538-text"
            >
              Reset AB
            </button>
            <button
              onClick={nextInning}
              className="px-2 py-1 text-xs border border-538-border rounded text-538-muted hover:text-538-text"
            >
              New Inning
            </button>
          </div>
        </div>

        {/* Expected / Best pitch callouts */}
        {prediction && prediction.pitches.length > 0 && (() => {
          const expected = prediction.pitches[0] // already sorted by probability
          const ranked = [...prediction.pitches].filter((p) => p.xwoba !== null)
          const best = ranked.length > 0
            ? ranked.sort((a, b) => (a.xwoba ?? 1) - (b.xwoba ?? 1))[0]
            : [...prediction.pitches].sort((a, b) => (b.whiff_pct ?? 0) - (a.whiff_pct ?? 0))[0]
          return (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="border border-538-border rounded px-3 py-2 flex items-center gap-2">
                <div className="text-[10px] uppercase tracking-wider text-538-muted shrink-0">
                  Expected
                </div>
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: pitchColor(expected.pitch_type) }}
                />
                <div className="text-sm font-bold text-538-text truncate">
                  {expected.pitch_name}
                </div>
                <div className="ml-auto text-xs font-bold tabular-nums" style={{ color: pitchColor(expected.pitch_type) }}>
                  {(expected.probability * 100).toFixed(0)}%
                </div>
              </div>
              <div className="border border-538-border rounded px-3 py-2 flex items-center gap-2">
                <div className="text-[10px] uppercase tracking-wider text-538-muted shrink-0">
                  Best Pitch
                </div>
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ backgroundColor: pitchColor(best.pitch_type) }}
                />
                <div className="text-sm font-bold text-538-text truncate">
                  {best.pitch_name}
                </div>
                <div className="ml-auto text-xs font-bold tabular-nums text-538-muted">
                  xwOBA <span className="text-538-text">{fmtWoba(best.xwoba)}</span>
                </div>
              </div>
            </div>
          )
        })()}

        {/* Pitch type selector — primes which pitch is being thrown */}
        {prediction && prediction.pitches.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-538-muted mr-1">
              Pitch
            </span>
            {prediction.pitches.map((p) => {
              const isActive = activePitch === p.pitch_type
              return (
                <button
                  key={p.pitch_type}
                  onClick={() => setPrimedPitch(p.pitch_type)}
                  className="px-2 py-1 text-xs font-bold rounded border-2 transition-colors"
                  style={{
                    color: isActive ? '#fff' : pitchColor(p.pitch_type),
                    backgroundColor: isActive ? pitchColor(p.pitch_type) : 'transparent',
                    borderColor: pitchColor(p.pitch_type),
                  }}
                  title={`${p.pitch_name} — ${(p.probability * 100).toFixed(0)}%`}
                >
                  {p.pitch_type}
                </button>
              )
            })}
            <span className="text-[10px] text-538-muted ml-1">
              (defaults to expected — click to override)
            </span>
          </div>
        )}

        {/* Pitch outcome buttons */}
        <div className="mt-3 flex flex-wrap gap-2">
          {(
            [
              ['ball', 'Ball'],
              ['called_strike', 'Called Strike'],
              ['swinging_strike', 'Swing & Miss'],
              ['foul', 'Foul'],
              ['in_play', 'In Play'],
              ['hbp', 'HBP'],
            ] as [PitchEvent, string][]
          ).map(([ev, label]) => (
            <button
              key={ev}
              onClick={() => logPitch(ev)}
              disabled={!pitcher || !activePitch}
              className="px-3 py-1.5 text-xs font-semibold rounded border border-538-border hover:bg-538-bg disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ color: EVENT_COLOR[ev] }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Sequence chips */}
        {sequence.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-538-muted uppercase tracking-wider">Sequence</span>
            {sequence.map((s, i) => (
              <span
                key={i}
                className="text-[10px] font-bold rounded border tabular-nums inline-flex overflow-hidden"
                title={`${s.pitch_type} → ${s.ev}`}
              >
                <span
                  className="px-1.5 py-0.5 text-white"
                  style={{ backgroundColor: pitchColor(s.pitch_type) }}
                >
                  {s.pitch_type}
                </span>
                <span
                  className="px-1.5 py-0.5 border-l"
                  style={{
                    color: EVENT_COLOR[s.ev],
                    borderColor: EVENT_COLOR[s.ev],
                  }}
                >
                  {EVENT_LABEL[s.ev]}
                </span>
              </span>
            ))}
          </div>
        )}

        {/* PA log */}
        {paLog.length > 0 && (
          <div className="mt-3 text-xs text-538-muted">
            <span className="uppercase tracking-wider mr-2">PA Log</span>
            {paLog.map((p, i) => (
              <span key={i} className="mr-2">
                {p.ev}@{p.finalCount.balls}-{p.finalCount.strikes}
                {i < paLog.length - 1 ? ' ·' : ''}
              </span>
            ))}
            <button
              onClick={() => setPaLog([])}
              className="ml-2 underline hover:text-538-text"
            >
              clear
            </button>
          </div>
        )}
      </div>

      {!pitcher && (
        <div className="text-center text-538-muted text-sm py-12 border border-dashed border-538-border rounded">
          Select a pitcher to begin.
        </div>
      )}

      {pitcher && !pitcherArsenal && (
        <div className="text-center text-538-muted text-sm py-12 border border-dashed border-538-border rounded">
          No arsenal data available for {pitcher.name}.
        </div>
      )}

      {prediction && (
        <>
          {/* Pitch likelihood */}
          <div className="border border-538-border rounded bg-surface">
            <div className="px-4 py-2 border-b border-538-border flex items-baseline gap-2">
              <h2 className="text-sm font-bold text-538-text">
                Likely Pitches @ {count.balls}-{count.strikes}
              </h2>
              <span className="text-xs text-538-muted">
                {batter ? `vs ${batter.name}` : 'vs league-average batter'}
              </span>
            </div>
            <div className="divide-y divide-538-border">
              {prediction.pitches.map((p) => (
                <div key={p.pitch_type} className="px-4 py-2 grid grid-cols-12 gap-2 items-center text-xs">
                  <div className="col-span-3 flex items-center gap-1.5">
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ backgroundColor: pitchColor(p.pitch_type) }}
                    />
                    <span className="font-semibold text-538-text">{p.pitch_name}</span>
                    {p.is_signature && (
                      <span className="text-[10px] text-538-orange font-bold">★</span>
                    )}
                  </div>
                  <div className="col-span-5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 bg-538-border/40 rounded overflow-hidden">
                        <div
                          className="h-full"
                          style={{
                            width: `${p.probability * 100}%`,
                            backgroundColor: pitchColor(p.pitch_type),
                          }}
                        />
                      </div>
                      <span className="font-bold tabular-nums w-10 text-right">
                        {(p.probability * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div className="text-[10px] text-538-muted mt-0.5">
                      base usage {p.base_usage_pct.toFixed(0)}%
                    </div>
                  </div>
                  <div className="col-span-2 text-center">
                    <div className="font-semibold tabular-nums">{fmtPctRaw(p.whiff_pct)}</div>
                    <div className="text-[10px] text-538-muted">whiff</div>
                  </div>
                  <div className="col-span-2 text-center">
                    <div className="font-semibold tabular-nums">{fmtWoba(p.xwoba)}</div>
                    <div className="text-[10px] text-538-muted">
                      xwOBA{batter && p.batter_xwoba !== null ? ` (B ${fmtWoba(p.batter_xwoba)})` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Outcome probabilities */}
          <div className="border border-538-border rounded bg-surface">
            <div className="px-4 py-2 border-b border-538-border">
              <h2 className="text-sm font-bold text-538-text">
                At-Bat Outcome from {count.balls}-{count.strikes}
              </h2>
              <p className="text-[11px] text-538-muted">
                League count baseline, nudged by pitcher K/BB rates
                {batter ? ' and batter K/BB rates' : ''}.
              </p>
            </div>
            <div className="px-4 py-3 space-y-1.5">
              {[
                { label: 'Strikeout', key: 'k', color: '#C62828' },
                { label: 'Walk', key: 'bb', color: '#558B6E' },
                { label: 'Hit', key: 'hit', color: '#1565C0' },
                { label: 'In-Play Out', key: 'out', color: '#37474F' },
                { label: 'HBP', key: 'hbp', color: '#7B1FA2' },
              ].map(({ label, key, color }) => {
                const v = prediction.outcome[key as keyof typeof prediction.outcome]
                const base = prediction.baseOutcome[key as keyof typeof prediction.baseOutcome]
                return (
                  <div key={key} className="grid grid-cols-12 gap-2 items-center text-xs">
                    <div className="col-span-3 text-538-text font-medium">{label}</div>
                    <div className="col-span-7">
                      <div className="h-3 bg-538-border/30 rounded overflow-hidden">
                        <div
                          className="h-full transition-all"
                          style={{ width: `${v * 100}%`, backgroundColor: color }}
                        />
                      </div>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="font-bold tabular-nums">{fmtPct(v, 1)}</span>
                      <span className="text-[10px] text-538-muted ml-1 tabular-nums">
                        ({fmtPct(base, 0)} lg)
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Batter context */}
          {batter && batterSplits && (
            <div className="border border-538-border rounded bg-surface">
              <div className="px-4 py-2 border-b border-538-border">
                <h2 className="text-sm font-bold text-538-text">{batter.name} — Splits by Pitch Type</h2>
                <p className="text-[11px] text-538-muted">
                  Season K%: {fmtPctRaw(batter.k_pct, 1)} · BB%: {fmtPctRaw(batter.bb_pct, 1)} · wOBA: {fmtWoba(batter.obp ? (batter.obp + (batter.slg ?? 0)) / 2 : null)}
                </p>
              </div>
              <div className="px-4 py-2">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-538-muted uppercase text-[10px] tracking-wider">
                      <th className="text-left py-1">Pitch</th>
                      <th className="text-right">PA</th>
                      <th className="text-right">xwOBA</th>
                      <th className="text-right">SLG</th>
                      <th className="text-right">Whiff%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batterSplits.vs_pitches
                      .filter((v) =>
                        prediction.pitches.some((p) => p.pitch_type === v.pitch_type),
                      )
                      .slice(0, 8)
                      .map((v) => (
                        <tr key={v.pitch_type} className="border-t border-538-border/40">
                          <td className="py-1 flex items-center gap-1.5">
                            <span
                              className="inline-block w-2 h-2 rounded-full"
                              style={{ backgroundColor: pitchColor(v.pitch_type) }}
                            />
                            <span className="font-medium">{v.pitch_name}</span>
                          </td>
                          <td className="text-right tabular-nums">{v.pa}</td>
                          <td className="text-right tabular-nums">{fmtWoba(v.xwoba)}</td>
                          <td className="text-right tabular-nums">{fmtWoba(v.slg)}</td>
                          <td className="text-right tabular-nums">{fmtPctRaw(v.whiff_pct)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      <LogicBreakdown sections={LIVE_AB_SECTIONS} />
    </div>
  )
}

const LIVE_AB_SECTIONS = [
  {
    title: 'Pitch likelihood by count',
    body: (
      <>
        <p>
          The pitcher&apos;s baseline usage % per pitch is multiplied by a count-conditioned
          factor on the pitch&apos;s family (FB / Breaking / Offspeed). MLB-wide multi-year
          averages; very stable year-to-year.
        </p>
        <Code>{`// Examples from the count factor table:
'3-0': { FB: 1.60, BR: 0.30, OFF: 0.35 }  // must throw a strike
'0-2': { FB: 0.80, BR: 1.20, OFF: 1.15 }  // putaway pitch
'1-1': { FB: 1.00, BR: 1.00, OFF: 1.00 }  // neutral

P(pitch | count, pitcher)
  = pitcher.usage[pitch] × factor[family]
  ÷ normalize_across_arsenal`}</Code>
      </>
    ),
  },
  {
    title: 'Whiff% and xwOBA in this count',
    body: (
      <>
        <p>
          Each pitch&apos;s baseline whiff% gets multiplied by a count multiplier, and
          baseline xwOBA-against gets a count delta. When a batter is selected we blend
          60% pitcher / 40% batter splits to weight the matchup.
        </p>
        <Code>{`whiffMult[count]:  0-2 ×1.60   1-2 ×1.50   2-2 ×1.40
                   0-0 ×0.85   2-0 ×0.65   3-0 ×0.40
xwobaDelta[count]: 0-2 −0.130  3-0 +0.170  3-2 +0.060

whiff = (pitcher.whiff × whiffMult) × 0.6
      + (batter.whiff_vs_pitch × whiffMult) × 0.4
xwoba = (pitcher.xwoba + xwobaDelta) × 0.6
      + (batter.xwoba_vs_pitch + xwobaDelta) × 0.4`}</Code>
      </>
    ),
  },
  {
    title: 'In-AB sequence (tunneling) adjustments',
    body: (
      <>
        <p>
          Each pitch logged in the AB feeds into the model. Repetition makes a pitch less
          effective; switching families creates timing disruption. Magnitudes are rough
          values from published research on pitch tunneling — not fit from our own data.
        </p>
        <Code>{`// Same pitch repeated N times this AB:
whiff_mult ×= 0.90^N         // batter recognition
xwoba_delta += 0.025 × N

// Previous pitch from a different family:
whiff_mult ×= 1.08
xwoba_delta −= 0.020
//   extra bonus if FB ↔ offspeed (velocity contrast):
whiff_mult ×= 1.04
xwoba_delta −= 0.010

// 3+ same family in a row → next same-family penalty:
whiff_mult ×= 0.92
xwoba_delta += 0.020

// Usage also shifts away from repeated pitches:
usage_weight ×= 0.80^repeats`}</Code>
      </>
    ),
  },
  {
    title: 'PA outcome from the current count',
    body: (
      <>
        <p>
          League count → outcome table (probability the at-bat ends in K / BB / hit / out
          / HBP starting from this count). Then nudged by the pitcher&apos;s K/BB rates and
          the batter&apos;s K/BB rates, with √-dampening so a hot pitcher × cold batter
          doesn&apos;t blow past sensible bounds.
        </p>
        <Code>{`base = COUNT_OUTCOMES['1-1']   // { k:.248, bb:.088, hit:.235, hbp:.012, out:.417 }

ratio_K  = (pitcherK / leagueK)  × (batterK / leagueK)
ratio_BB = (pitcherBB / leagueBB) × (batterBB / leagueBB)

k  = base.k  × √ratio_K
bb = base.bb × √ratio_BB
// then renormalize k+bb+hit+hbp+out to 1.0`}</Code>
      </>
    ),
  },
  {
    title: 'Model honesty',
    body: (
      <>
        <p>
          The count tables (outcome probabilities, family-usage factors, whiff multipliers,
          xwOBA deltas) are real MLB-wide constants but they&apos;re NOT per-pitcher.
          Savant&apos;s pitch-arsenal endpoint ignores the count parameter, so per-pitcher
          count behavior isn&apos;t available without a pitch-by-pitch scrape.
        </p>
        <p>
          The tunneling multipliers (repetition, family-switch) are educated values, not
          fit from our data. The v2 upgrade path is to replace both with values learned
          from a pitch-level dataset.
        </p>
      </>
    ),
  },
]
