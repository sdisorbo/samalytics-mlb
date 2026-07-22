'use client'

import { useMemo, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import type { PitcherArsenal, PitchArsenal } from '../lib/types'
import type { SelectedPitch } from './PitchVisualizer'

const PitchAnimation3D = dynamic(() => import('./PitchAnimation3D'), { ssr: false })

const PITCH_COLORS: Record<string, string> = {
  FF: '#C62828', SI: '#E64A19', FC: '#F57C00',
  SL: '#1565C0', ST: '#6A1B9A', SV: '#7B1FA2',
  CU: '#283593', KC: '#37474F',
  CH: '#2E7D32', FS: '#00695C',
  KN: '#546E7A', EP: '#78909C',
}
const pitchColor = (pt: string) => PITCH_COLORS[pt] ?? '#888'

// Pitch types that appear as guess buttons. Ordered family-by-family.
const GUESS_PITCHES: { code: string; name: string }[] = [
  { code: 'FF', name: '4-Seam' },
  { code: 'SI', name: 'Sinker' },
  { code: 'FC', name: 'Cutter' },
  { code: 'SL', name: 'Slider' },
  { code: 'ST', name: 'Sweeper' },
  { code: 'CU', name: 'Curveball' },
  { code: 'KC', name: 'Knuckle Curve' },
  { code: 'CH', name: 'Changeup' },
  { code: 'FS', name: 'Splitter' },
]

const TOTAL_PITCHES = 10

interface TestPitch {
  pitch: SelectedPitch
  target: { x: number; y: number }
}

interface GuessResult {
  actual: string
  actualName: string
  guess: string | null
  correct: boolean
  pitcher: string
  team: string
  avg_speed: number | null
  break_x: number | null
  break_z: number | null
}

// Infer pitcher hand from break_x sign for arm-side pitches.
function inferHand(arsenal: PitchArsenal[]): 'R' | 'L' {
  for (const p of arsenal) {
    if (['FF', 'SI', 'CH'].includes(p.pitch_type) && p.break_x !== null) {
      return p.break_x >= 0 ? 'R' : 'L'
    }
  }
  return 'R'
}

// Random integer in [min, max).
function rand(min: number, max: number) {
  return Math.random() * (max - min) + min
}

function pickRandomPitch(arsenal: PitcherArsenal[]): TestPitch | null {
  // Build a pool of (pitcher, pitch) with non-negligible usage.
  const pool: { a: PitcherArsenal; p: PitchArsenal }[] = []
  for (const a of arsenal) {
    for (const p of a.pitches) {
      if ((p.usage_pct ?? 0) < 5) continue
      if (p.avg_speed === null) continue
      if (!GUESS_PITCHES.some((g) => g.code === p.pitch_type)) continue
      pool.push({ a, p })
    }
  }
  if (pool.length === 0) return null
  const choice = pool[Math.floor(Math.random() * pool.length)]
  const hand = inferHand(choice.a.pitches)
  // Random target: slightly outside zone for variety. Zone is x∈[-8.5,8.5], y∈[18,42].
  const target = {
    x: rand(-13, 13),
    y: rand(14, 46),
  }
  const pitch: SelectedPitch = {
    pitcher_name: choice.a.name,
    team: choice.a.team,
    pitch_type: choice.p.pitch_type,
    pitch_name: choice.p.pitch_name,
    usage_pct: choice.p.usage_pct ?? 0,
    whiff_pct: choice.p.whiff_pct,
    xwoba_against: choice.p.xwoba_against,
    woba_against: choice.p.woba_against,
    run_value_per_100: choice.p.run_value_per_100,
    avg_speed: choice.p.avg_speed,
    break_x: choice.p.break_x,
    break_z: choice.p.break_z,
    pitcher_hand: hand,
  }
  return { pitch, target }
}

type Phase = 'animating' | 'guessing' | 'revealed' | 'done'

export default function PitchTestMode({
  arsenal,
  onExit,
}: {
  arsenal: PitcherArsenal[]
  onExit: () => void
}) {
  const [animKey, setAnimKey] = useState(0)
  const [pitchIdx, setPitchIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>('animating')
  const [currentTest, setCurrentTest] = useState<TestPitch | null>(() =>
    pickRandomPitch(arsenal),
  )
  const [history, setHistory] = useState<GuessResult[]>([])
  const [guess, setGuess] = useState<string | null>(null)

  const score = useMemo(() => history.filter((h) => h.correct).length, [history])

  const handlePhaseChange = useCallback((p: 'rotate' | 'wait' | 'fly' | 'post_contact' | 'frozen') => {
    if (p === 'frozen') {
      setPhase((prev) => (prev === 'animating' ? 'guessing' : prev))
    }
  }, [])

  function makeGuess(code: string) {
    if (!currentTest || phase !== 'guessing') return
    const correct = code === currentTest.pitch.pitch_type
    setGuess(code)
    setHistory((h) => [
      ...h,
      {
        actual: currentTest.pitch.pitch_type,
        actualName: currentTest.pitch.pitch_name,
        guess: code,
        correct,
        pitcher: currentTest.pitch.pitcher_name,
        team: currentTest.pitch.team,
        avg_speed: currentTest.pitch.avg_speed,
        break_x: currentTest.pitch.break_x,
        break_z: currentTest.pitch.break_z,
      },
    ])
    setPhase('revealed')
  }

  function nextPitch() {
    const newIdx = pitchIdx + 1
    if (newIdx >= TOTAL_PITCHES) {
      setPhase('done')
      return
    }
    setPitchIdx(newIdx)
    setCurrentTest(pickRandomPitch(arsenal))
    setGuess(null)
    setPhase('animating')
    setAnimKey((k) => k + 1)
  }

  function restart() {
    setPitchIdx(0)
    setHistory([])
    setCurrentTest(pickRandomPitch(arsenal))
    setGuess(null)
    setPhase('animating')
    setAnimKey((k) => k + 1)
  }

  if (phase === 'done') {
    const pct = Math.round((score / TOTAL_PITCHES) * 100)
    return (
      <div className="border border-538-border rounded bg-surface p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-538-text">Test Complete</h2>
          <button
            onClick={onExit}
            className="px-3 py-1.5 text-xs font-semibold rounded border border-538-border text-538-muted hover:text-538-text"
          >
            ✕ Exit
          </button>
        </div>
        <div className="text-center py-6">
          <div className="text-6xl font-black tabular-nums" style={{ color: pct >= 70 ? '#2E7D32' : pct >= 40 ? '#F57C00' : '#C62828' }}>
            {pct}%
          </div>
          <div className="text-sm text-538-muted mt-1">
            {score} / {TOTAL_PITCHES} correct
          </div>
        </div>
        <div className="border-t border-538-border pt-3">
          <h3 className="text-xs uppercase tracking-wider text-538-muted mb-2">Recap</h3>
          <ul className="space-y-1 text-xs">
            {history.map((h, i) => (
              <li
                key={i}
                className="flex items-center gap-2 px-2 py-1 rounded"
                style={{ backgroundColor: h.correct ? 'rgba(46,125,50,0.07)' : 'rgba(198,40,40,0.07)' }}
              >
                <span className="font-bold w-5 text-538-muted tabular-nums">{i + 1}.</span>
                <span style={{ color: h.correct ? '#2E7D32' : '#C62828' }} className="font-bold w-6">
                  {h.correct ? '✓' : '✗'}
                </span>
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: pitchColor(h.actual), color: '#fff' }}
                >
                  {h.actual}
                </span>
                <span className="font-medium text-538-text">{h.actualName}</span>
                <span className="text-538-muted">·</span>
                <span className="text-538-muted">{h.pitcher}</span>
                {h.guess && h.guess !== h.actual && (
                  <span className="ml-auto text-538-muted">guessed {h.guess}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onExit}
            className="px-4 py-2 text-xs font-semibold rounded border border-538-border text-538-muted hover:text-538-text"
          >
            Exit
          </button>
          <button
            onClick={restart}
            className="px-4 py-2 text-xs font-bold rounded bg-538-orange text-white hover:opacity-90"
          >
            Play Again
          </button>
        </div>
      </div>
    )
  }

  if (!currentTest) {
    return (
      <div className="p-6 text-center text-sm text-538-muted">
        No pitch data available for test mode.
      </div>
    )
  }

  const revealed = phase === 'revealed'
  const last = revealed ? history[history.length - 1] : null

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between border border-538-border rounded bg-surface px-3 py-2">
        <div className="flex items-center gap-4">
          <span className="text-xs uppercase tracking-wider text-538-orange font-bold">Test Mode</span>
          <span className="text-sm text-538-text">
            Pitch <span className="font-black tabular-nums">{pitchIdx + 1}</span> / {TOTAL_PITCHES}
          </span>
          <span className="text-xs text-538-muted">
            Score: <span className="font-bold text-538-text tabular-nums">{score}</span>
          </span>
        </div>
        <button
          onClick={onExit}
          className="px-2 py-1 text-xs font-semibold rounded border border-538-border text-538-muted hover:text-538-text"
        >
          ✕ Exit
        </button>
      </div>

      {/* 3D scene */}
      <div className="border border-538-border rounded bg-surface overflow-hidden">
        <div className="aspect-[4/3] relative bg-black">
          <PitchAnimation3D
            key={animKey}
            pitch={currentTest.pitch}
            target={currentTest.target}
            angle="center"
            testMode={!revealed}
            onPhaseChange={handlePhaseChange}
          />
          {phase === 'animating' && (
            <div className="absolute top-3 left-3 px-2 py-1 text-[10px] uppercase tracking-wider rounded bg-surface/80 text-538-muted">
              Watch closely…
            </div>
          )}
        </div>

        {/* Guess UI */}
        {phase === 'guessing' && (
          <div className="border-t border-538-border p-3 space-y-2">
            <div className="text-xs uppercase tracking-wider text-538-muted">What pitch was that?</div>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {GUESS_PITCHES.map((g) => (
                <button
                  key={g.code}
                  onClick={() => makeGuess(g.code)}
                  className="px-2 py-2 text-xs font-bold rounded border-2 transition-colors hover:bg-538-bg"
                  style={{
                    color: pitchColor(g.code),
                    borderColor: pitchColor(g.code),
                  }}
                >
                  <div className="text-[10px] opacity-70">{g.code}</div>
                  <div>{g.name}</div>
                </button>
              ))}
            </div>
            <div className="flex justify-end pt-1">
              <button
                onClick={() => setAnimKey((k) => k + 1)}
                className="px-2 py-1 text-[11px] text-538-muted hover:text-538-text"
                title="Replay this pitch"
              >
                ↺ Replay
              </button>
            </div>
          </div>
        )}

        {/* Reveal */}
        {revealed && last && (
          <div className="border-t border-538-border p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="text-xs font-black px-2 py-1 rounded"
                style={{ backgroundColor: last.correct ? '#2E7D32' : '#C62828', color: '#fff' }}
              >
                {last.correct ? '✓ Correct' : '✗ Wrong'}
              </span>
              <span className="text-538-muted text-xs">— it was a</span>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{ backgroundColor: pitchColor(last.actual), color: '#fff' }}
              >
                {last.actual}
              </span>
              <span className="font-bold text-538-text text-sm">{last.actualName}</span>
              <span className="text-xs text-538-muted">— {last.pitcher} ({last.team})</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-538-muted">
              <span>Velo <span className="font-bold text-538-text tabular-nums">{last.avg_speed?.toFixed(1) ?? '—'}</span> mph</span>
              <span>H-Break <span className="font-bold text-538-text tabular-nums">{last.break_x?.toFixed(1) ?? '—'}</span>″</span>
              <span>V-Break <span className="font-bold text-538-text tabular-nums">{last.break_z?.toFixed(1) ?? '—'}</span>″</span>
              {last.guess && !last.correct && (
                <span className="ml-auto">
                  You guessed <span className="font-bold text-538-text">{last.guess}</span>
                </span>
              )}
            </div>
            <div className="flex justify-end">
              <button
                onClick={nextPitch}
                className="px-4 py-1.5 text-xs font-bold rounded bg-538-orange text-white hover:opacity-90"
              >
                {pitchIdx + 1 >= TOTAL_PITCHES ? 'See Results →' : 'Next Pitch →'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
