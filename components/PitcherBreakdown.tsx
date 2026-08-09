'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { GameBreakdown } from '@/lib/pitcherGame'

// ── Types re-exported for consumers ──────────────────────────────────────────

type PitchResult = 'ball' | 'called_strike' | 'swinging_strike' | 'foul' | 'out' | 'single' | 'double' | 'triple' | 'home_run'

// ── Color palette ─────────────────────────────────────────────────────────────

const RESULT_COLOR: Record<PitchResult, string> = {
  swinging_strike: '#3C999E',
  called_strike:   '#8EC6C8',
  out:             '#5BAEB3',
  foul:            '#C9A22A',
  ball:            '#4B5563',
  single:          '#E5A8B5',
  double:          '#C96E85',
  triple:          '#9B405A',
  home_run:        '#6B1F3A',
}

const TEAL_STRONG = 'rgba(60,153,158,0.85)'
const TEAL_MED    = 'rgba(91,174,179,0.55)'
const TEAL_LIGHT  = 'rgba(143,198,200,0.35)'
const PINK_STRONG = 'rgba(155,64,90,0.80)'
const PINK_MED    = 'rgba(201,110,133,0.55)'
const NEUTRAL     = 'rgba(100,116,139,0.18)'
const EMPTY_CELL  = 'rgba(30,41,59,0.25)'

const RESULT_LAYERS: PitchResult[] = ['ball', 'foul', 'called_strike', 'out', 'swinging_strike', 'single', 'double', 'triple', 'home_run']

// ── Zone definitions ──────────────────────────────────────────────────────────

const ZONES = [
  { xMin: -0.83, xMax: -0.28, zMin: 2.40, zMax: 3.38 },
  { xMin: -0.28, xMax:  0.28, zMin: 2.40, zMax: 3.38 },
  { xMin:  0.28, xMax:  0.83, zMin: 2.40, zMax: 3.38 },
  { xMin: -0.83, xMax: -0.28, zMin: 1.97, zMax: 2.40 },
  { xMin: -0.28, xMax:  0.28, zMin: 1.97, zMax: 2.40 },
  { xMin:  0.28, xMax:  0.83, zMin: 1.97, zMax: 2.40 },
  { xMin: -0.83, xMax: -0.28, zMin: 1.55, zMax: 1.97 },
  { xMin: -0.28, xMax:  0.28, zMin: 1.55, zMax: 1.97 },
  { xMin:  0.28, xMax:  0.83, zMin: 1.55, zMax: 1.97 },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function logoUrl(abbr: string) {
  return `https://a.espncdn.com/i/teamlogos/mlb/500/${abbr.toLowerCase()}.png`
}

function percentileColor(p: number) {
  if (p >= 80) return '#3C999E'
  if (p >= 60) return '#C9A22A'
  if (p >= 40) return '#F97316'
  return '#9B405A'
}

function makeSVGMapper(w: number, h: number) {
  return (pX: number, pZ: number) => ({
    x: ((pX + 2) / 4) * w,
    y: (1 - (pZ - 0.5) / 4.5) * h,
  })
}

function szCorners(w: number, h: number) {
  const f = makeSVGMapper(w, h)
  return { top: f(0, 3.38).y, bottom: f(0, 1.55).y, left: f(-0.83, 0).x, right: f(0.83, 0).x }
}

function classifyZone(pitches: GameBreakdown['pitches'], idx: number) {
  const z = ZONES[idx]
  const inZone  = pitches.filter(p => p.x >= z.xMin && p.x < z.xMax && p.z >= z.zMin && p.z < z.zMax)
  const strikes = inZone.filter(p => p.result === 'swinging_strike' || p.result === 'called_strike').length
  const contact = inZone.filter(p => p.result === 'single' || p.result === 'double' || p.result === 'triple' || p.result === 'home_run').length
  return { total: inZone.length, strikes, contact }
}

function zoneCellBg(strikes: number, contact: number, total: number) {
  if (total === 0) return EMPTY_CELL
  const sr = strikes / total, cr = contact / total
  if (sr >= 0.55) return TEAL_STRONG
  if (sr >= 0.35) return TEAL_MED
  if (cr >= 0.40) return PINK_STRONG
  if (cr >= 0.25) return PINK_MED
  if (sr >= 0.15) return TEAL_LIGHT
  return NEUTRAL
}

function diamond(cx: number, cy: number, r: number) {
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`
}

// ── Percentile Gauge ──────────────────────────────────────────────────────────

function PercentileGauge({ percentile }: { percentile: number }) {
  const size = 120, sw = 10, r = (size - sw) / 2, cx = size / 2, cy = size / 2
  const start = 150, total = 240, fill = (percentile / 100) * total
  const color = percentileColor(percentile)
  function polar(deg: number) {
    const rad = (deg * Math.PI) / 180
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
  }
  function arc(s: number, e: number) {
    const a = polar(s), b = polar(e)
    return `M ${a.x} ${a.y} A ${r} ${r} 0 ${e - s > 180 ? 1 : 0} 1 ${b.x} ${b.y}`
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <path d={arc(start, start + total)} fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" className="text-538-border" />
      {fill > 2 && <path d={arc(start, start + fill)} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" />}
      <text x={cx} y={cy - 4} textAnchor="middle" dominantBaseline="middle" fontSize="26" fontWeight="900" fill={color} fontFamily="'Orbitron', sans-serif">{percentile}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" fontSize="7" fontWeight="700" fill="#6B7280" letterSpacing="2" fontFamily="sans-serif">PERCENTILE</text>
    </svg>
  )
}

// ── Pitch Heatmap ─────────────────────────────────────────────────────────────

const MW = 240, MH = 280
const toSVGMain = makeSVGMapper(MW, MH)
const SZ_MAIN = szCorners(MW, MH)

function PitchHeatmap({ pitches, pitchMix }: { pitches: GameBreakdown['pitches']; pitchMix: GameBreakdown['pitchMix'] }) {
  const visible = new Set(pitchMix.slice(0, 6).map(p => p.type))
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] font-bold uppercase tracking-widest text-538-muted">Pitch Location</div>
      <div className="flex gap-4 items-start">
        <svg width={MW} height={MH} viewBox={`0 0 ${MW} ${MH}`} className="rounded shrink-0">
          <rect width={MW} height={MH} fill="#0F172A" rx="4" />
          <line x1={MW / 2} y1={MH - 8} x2={MW / 2} y2={MH - 3} stroke="#475569" strokeWidth="1.5" />
          <rect x={SZ_MAIN.left} y={SZ_MAIN.top} width={SZ_MAIN.right - SZ_MAIN.left} height={SZ_MAIN.bottom - SZ_MAIN.top} fill="none" stroke="#475569" strokeWidth="1.5" strokeDasharray="4 2" />
          {[1, 2].map(i => (
            <g key={i}>
              <line x1={SZ_MAIN.left} y1={SZ_MAIN.top + ((SZ_MAIN.bottom - SZ_MAIN.top) / 3) * i} x2={SZ_MAIN.right} y2={SZ_MAIN.top + ((SZ_MAIN.bottom - SZ_MAIN.top) / 3) * i} stroke="#334155" strokeWidth="0.6" />
              <line x1={SZ_MAIN.left + ((SZ_MAIN.right - SZ_MAIN.left) / 3) * i} y1={SZ_MAIN.top} x2={SZ_MAIN.left + ((SZ_MAIN.right - SZ_MAIN.left) / 3) * i} y2={SZ_MAIN.bottom} stroke="#334155" strokeWidth="0.6" />
            </g>
          ))}
          {RESULT_LAYERS.map(layer =>
            pitches.filter(p => p.result === layer && visible.has(p.type)).map((p, i) => {
              const { x, y } = toSVGMain(p.x, p.z)
              const isK  = layer === 'swinging_strike'
              const isHit = layer === 'single' || layer === 'double' || layer === 'triple' || layer === 'home_run'
              if (isHit) {
                return <polygon key={`${layer}-${i}`} points={diamond(x, y, 5.5)} fill={RESULT_COLOR[layer]} stroke="#C9A22A" strokeWidth="1.6" opacity={0.97} />
              }
              return (
                <circle key={`${layer}-${i}`} cx={x} cy={y}
                  r={isK ? 4 : 3.2}
                  fill={p.color}
                  opacity={layer === 'ball' ? 0.28 : layer === 'foul' ? 0.45 : 0.88}
                  stroke={isK ? '#C9A22A' : 'none'}
                  strokeWidth={isK ? 1.4 : 0}
                />
              )
            })
          )}
        </svg>
        <div className="flex flex-col gap-1.5 pt-1 text-[10px] text-538-muted">
          <div className="text-[9px] font-semibold uppercase tracking-widest mb-0.5">Pitch type</div>
          {pitchMix.slice(0, 6).map(p => (
            <div key={p.type} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
              <span className="whitespace-nowrap">{p.name}</span>
            </div>
          ))}
          <div className="mt-2 flex flex-col gap-1 text-[9px] border-t border-538-border/50 pt-2">
            <div className="text-[9px] font-semibold uppercase tracking-widest mb-0.5">Result</div>
            {[
              { result: 'swinging_strike' as const, label: 'Swinging K', ring: true },
              { result: 'called_strike'   as const, label: 'Called K',   ring: false },
              { result: 'out'             as const, label: 'Out',         ring: false },
              { result: 'foul'            as const, label: 'Foul',        ring: false },
              { result: 'ball'            as const, label: 'Ball',        ring: false },
            ].map(({ result, label, ring }) => (
              <div key={result} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full shrink-0 border-2" style={{ backgroundColor: RESULT_COLOR[result], borderColor: ring ? '#C9A22A' : RESULT_COLOR[result] }} />
                <span>{label}{ring ? ' (gold ring)' : ''}</span>
              </div>
            ))}
            {[
              { result: 'single' as const, label: '1B' },
              { result: 'double' as const, label: '2B' },
              { result: 'triple' as const, label: '3B' },
              { result: 'home_run' as const, label: 'HR' },
            ].map(({ result, label }) => (
              <div key={result} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rotate-45 shrink-0 border-2" style={{ backgroundColor: RESULT_COLOR[result], borderColor: '#C9A22A' }} />
                <span>{label} (diamond)</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Overall zone grid ─────────────────────────────────────────────────────────

function ZoneGrid({ pitches }: { pitches: GameBreakdown['pitches'] }) {
  return (
    <div className="flex flex-col gap-2 shrink-0">
      <div className="text-[10px] font-bold uppercase tracking-widest text-538-muted">Strike Rate · All</div>
      <div className="grid grid-cols-3 gap-0.5 w-[108px]">
        {ZONES.map((_, i) => {
          const { total, strikes, contact } = classifyZone(pitches, i)
          return (
            <div key={i} className="h-9 flex flex-col items-center justify-center rounded-sm" style={{ backgroundColor: zoneCellBg(strikes, contact, total) }}>
              {total > 0 ? (
                <>
                  <span className="text-[11px] font-bold text-white leading-none">{Math.round((strikes / total) * 100)}%</span>
                  <span className="text-[8px] text-white/60">{total}p</span>
                </>
              ) : <span className="text-[9px] text-538-muted">—</span>}
            </div>
          )
        })}
      </div>
      <div className="flex gap-2 text-[8px] text-538-muted">
        <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: TEAL_STRONG }} /> K</span>
        <span className="flex items-center gap-0.5"><span className="inline-block w-2 h-2 rounded-sm" style={{ background: PINK_STRONG }} /> Hit</span>
      </div>
      <span className="text-[8px] text-538-muted">Catcher&apos;s view</span>
    </div>
  )
}

// ── Per-pitch-type mini zones ─────────────────────────────────────────────────

const MINI_W = 130, MINI_H = 152
const toSVGMini = makeSVGMapper(MINI_W, MINI_H)
const SZ_MINI  = szCorners(MINI_W, MINI_H)

function MiniZone({ pitches, label, usagePct }: { pitches: GameBreakdown['pitches']; label: string; usagePct: number }) {
  const ks    = pitches.filter(p => p.result === 'swinging_strike' || p.result === 'called_strike').length
  const hits  = pitches.filter(p => p.result === 'single' || p.result === 'double' || p.result === 'triple' || p.result === 'home_run').length
  const outs  = pitches.filter(p => p.result === 'out').length
  const balls = pitches.filter(p => p.result === 'ball').length
  const fouls = pitches.filter(p => p.result === 'foul').length

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="text-[10px] font-semibold text-538-text text-center leading-tight">
        {label}<span className="ml-1 text-538-muted font-normal">({usagePct}%)</span>
      </div>
      <svg width={MINI_W} height={MINI_H} viewBox={`0 0 ${MINI_W} ${MINI_H}`} className="rounded">
        <rect width={MINI_W} height={MINI_H} fill="#0F172A" rx="3" />
        <rect x={SZ_MINI.left} y={SZ_MINI.top} width={SZ_MINI.right - SZ_MINI.left} height={SZ_MINI.bottom - SZ_MINI.top} fill="none" stroke="#475569" strokeWidth="1" strokeDasharray="3 2" />
        {[1, 2].map(i => (
          <g key={i}>
            <line x1={SZ_MINI.left} y1={SZ_MINI.top + ((SZ_MINI.bottom - SZ_MINI.top) / 3) * i} x2={SZ_MINI.right} y2={SZ_MINI.top + ((SZ_MINI.bottom - SZ_MINI.top) / 3) * i} stroke="#1E293B" strokeWidth="0.7" />
            <line x1={SZ_MINI.left + ((SZ_MINI.right - SZ_MINI.left) / 3) * i} y1={SZ_MINI.top} x2={SZ_MINI.left + ((SZ_MINI.right - SZ_MINI.left) / 3) * i} y2={SZ_MINI.bottom} stroke="#1E293B" strokeWidth="0.7" />
          </g>
        ))}
        <line x1={MINI_W / 2} y1={MINI_H - 5} x2={MINI_W / 2} y2={MINI_H - 2} stroke="#475569" strokeWidth="1" />
        {RESULT_LAYERS.filter(l => l !== 'single' && l !== 'double' && l !== 'triple' && l !== 'home_run').map(layer =>
          pitches.filter(p => p.result === layer).map((p, i) => {
            const { x, y } = toSVGMini(p.x, p.z)
            const isK = layer === 'swinging_strike'
            return (
              <circle key={`${layer}-${i}`} cx={x} cy={y}
                r={isK ? 3.8 : 2.8}
                fill={RESULT_COLOR[layer]}
                opacity={layer === 'ball' ? 0.38 : layer === 'foul' ? 0.55 : 0.88}
                stroke={isK ? '#C9A22A' : 'none'}
                strokeWidth={isK ? 1.4 : 0}
              />
            )
          })
        )}
        {(['single', 'double', 'triple', 'home_run'] as const).map(layer =>
          pitches.filter(p => p.result === layer).map((p, i) => {
            const { x, y } = toSVGMini(p.x, p.z)
            return <polygon key={`${layer}-${i}`} points={diamond(x, y, 6)} fill={RESULT_COLOR[layer]} stroke="#C9A22A" strokeWidth="1.8" opacity={0.97} />
          })
        )}
      </svg>
      <div className="text-[9px] text-538-muted text-center tabular-nums">
        <span style={{ color: RESULT_COLOR.swinging_strike }}>{ks}K</span>
        {' · '}<span style={{ color: RESULT_COLOR.out }}>{outs} out</span>
        {' · '}<span style={{ color: RESULT_COLOR.ball }}>{balls} ball</span>
        {' · '}<span style={{ color: RESULT_COLOR.foul }}>{fouls} foul</span>
        {hits > 0 && <> · <span style={{ color: RESULT_COLOR.single, fontWeight: 700 }}>{hits} hit{hits > 1 ? 's' : ''} ◆</span></>}
      </div>
    </div>
  )
}

function PitchTypeZones({ pitches, pitchMix }: { pitches: GameBreakdown['pitches']; pitchMix: GameBreakdown['pitchMix'] }) {
  if (!pitchMix.length) return null
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-538-muted">Zone Profile by Pitch Type</div>
        <div className="flex-1 h-px bg-538-border" />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[9px] text-538-muted">
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full border-2" style={{ backgroundColor: RESULT_COLOR.swinging_strike, borderColor: '#C9A22A' }} /> Swinging K</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: RESULT_COLOR.called_strike }} /> Called K</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: RESULT_COLOR.out }} /> Out</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: RESULT_COLOR.foul }} /> Foul</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: RESULT_COLOR.ball }} /> Ball</span>
        {(['single', 'double', 'triple', 'home_run'] as const).map(r => (
          <span key={r} className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rotate-45 border-2" style={{ backgroundColor: RESULT_COLOR[r], borderColor: '#C9A22A' }} /> {r === 'single' ? '1B' : r === 'double' ? '2B' : r === 'triple' ? '3B' : 'HR'}</span>
        ))}
      </div>
      <div className="flex flex-wrap gap-5">
        {pitchMix.slice(0, 6).map(pm => (
          <MiniZone key={pm.type} pitches={pitches.filter(p => p.type === pm.type)} label={pm.name} usagePct={pm.pct} />
        ))}
      </div>
    </div>
  )
}

// ── Stat Box ──────────────────────────────────────────────────────────────────

function StatBox({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center bg-538-border/20 rounded-lg px-3 py-2 min-w-[52px]">
      <span className="text-[10px] font-bold uppercase tracking-widest text-538-muted">{label}</span>
      <span className="text-xl font-black text-538-text tabular-nums leading-tight">{value}</span>
      {sub && <span className="text-[9px] text-538-muted">{sub}</span>}
    </div>
  )
}

// ── Canvas export ─────────────────────────────────────────────────────────────

function loadImgPB(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image(); img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src
  })
}

function espnSlugPB(abbr: string): string {
  const MAP: Record<string, string> = {
    AZ: 'ari', ARI: 'ari', WSH: 'wsh', CWS: 'cws',
    TB: 'tb', TBR: 'tb', KC: 'kc', KCR: 'kc',
    SD: 'sd', SDP: 'sd', SF: 'sf', SFG: 'sf', ATH: 'oak',
  }
  return MAP[abbr] ?? abbr.toLowerCase()
}

function pbRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath()
}

async function exportBreakdownImage(data: GameBreakdown) {
  const SCALE = 2, W = 480, PAD = 16
  const IMG_SIZE = 48, HEADER_H = 80
  const STATS_H = 48
  const MID_H = 144   // pitch mix + zone grid
  const FOOTER_H = 24
  const H = PAD + HEADER_H + 10 + STATS_H + 10 + MID_H + FOOTER_H + PAD

  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE; canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')!; ctx.scale(SCALE, SCALE)
  ctx.fillStyle = '#0D1117'; ctx.fillRect(0, 0, W, H)

  const [headshotImg, teamLogoImg, siteLogoImg] = await Promise.all([
    loadImgPB(`https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${data.playerId}/headshot/67/current`),
    loadImgPB(`https://a.espncdn.com/i/teamlogos/mlb/500/${espnSlugPB(data.pitcherTeamAbbr)}.png`),
    loadImgPB('/logo.png'),
  ])

  // ── Header ──
  const hY = PAD + (HEADER_H - IMG_SIZE) / 2
  if (headshotImg) {
    const ar = headshotImg.naturalWidth / headshotImg.naturalHeight
    let dw, dh, dx, dy
    if (ar >= 1) { dh = IMG_SIZE; dw = IMG_SIZE * ar; dx = PAD - (dw - IMG_SIZE) / 2; dy = hY }
    else         { dw = IMG_SIZE; dh = IMG_SIZE / ar; dx = PAD; dy = hY - (dh - IMG_SIZE) / 2 }
    ctx.save(); ctx.beginPath()
    ctx.arc(PAD + IMG_SIZE / 2, hY + IMG_SIZE / 2, IMG_SIZE / 2, 0, Math.PI * 2); ctx.clip()
    ctx.drawImage(headshotImg, dx, dy, dw, dh); ctx.restore()
  } else {
    ctx.fillStyle = '#3D405B'; ctx.beginPath()
    ctx.arc(PAD + IMG_SIZE / 2, hY + IMG_SIZE / 2, IMG_SIZE / 2, 0, Math.PI * 2); ctx.fill()
  }
  const textX = PAD + IMG_SIZE + 10
  ctx.fillStyle = '#E6EDF3'; ctx.font = 'bold 15px sans-serif'
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'
  ctx.fillText(data.pitcherName, textX, hY + 1)
  ctx.fillStyle = '#9CA3AF'; ctx.font = '10px sans-serif'
  ctx.fillText(`${data.pitcherTeamAbbr} vs ${data.opponentAbbr} · ${data.gameDate}`, textX, hY + 20)
  ctx.fillText(data.gameResult, textX, hY + 34)
  const pctColor = percentileColor(data.percentile)
  ctx.fillStyle = pctColor; ctx.font = 'bold 10px sans-serif'
  ctx.fillText(`Game Score ${data.gameScore}  ·  ${data.percentile}th percentile`, textX, hY + 48)
  const LOGO_SIZE = 36
  if (teamLogoImg) ctx.drawImage(teamLogoImg, W - PAD - LOGO_SIZE, PAD + (HEADER_H - LOGO_SIZE) / 2, LOGO_SIZE, LOGO_SIZE)

  // ── Stats row ──
  const statsY = PAD + HEADER_H + 10
  const statItems = [
    { label: 'IP',  value: data.ipDisplay, color: '#E6EDF3' },
    { label: 'K',   value: String(data.ks), color: '#E6EDF3' },
    { label: 'BB',  value: String(data.bbs), color: '#E6EDF3' },
    { label: 'H',   value: String(data.hits), color: '#E6EDF3' },
    { label: 'ER',  value: String(data.er), color: '#E6EDF3' },
    { label: 'OPS', value: data.ops.toFixed(3), color: data.ops < 0.600 ? '#3C999E' : data.ops < 0.750 ? '#C9A22A' : '#9B405A' },
  ]
  const statW = (W - 2 * PAD) / statItems.length
  for (let i = 0; i < statItems.length; i++) {
    const s = statItems[i]
    const sx = PAD + i * statW + statW / 2
    ctx.fillStyle = '#1C2230'
    pbRoundRect(ctx, PAD + i * statW + 2, statsY, statW - 4, STATS_H, 4); ctx.fill()
    ctx.fillStyle = '#6B7280'; ctx.font = 'bold 8px sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'
    ctx.fillText(s.label, sx, statsY + 6)
    ctx.fillStyle = s.color; ctx.font = 'bold 16px monospace'
    ctx.textBaseline = 'bottom'
    ctx.fillText(s.value, sx, statsY + STATS_H - 6)
  }

  // ── Middle row: pitch mix (left) | zone grid (right) ──
  const midY = statsY + STATS_H + 10
  const MID_LEFT_W = Math.floor((W - 2 * PAD) * 0.55)
  const MID_RIGHT_X = PAD + MID_LEFT_W + 12

  // Pitch mix
  ctx.fillStyle = '#6B7280'; ctx.font = 'bold 8px sans-serif'
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'
  ctx.fillText('PITCH MIX', PAD, midY)
  const pitchY0 = midY + 14, pitchItemH = 22
  for (let i = 0; i < Math.min(5, data.pitchMix.length); i++) {
    const pm = data.pitchMix[i]
    const py = pitchY0 + i * pitchItemH
    const barMaxW = MID_LEFT_W - 84
    ctx.fillStyle = '#9CA3AF'; ctx.font = '9px sans-serif'
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
    ctx.fillText(pm.name.length > 15 ? pm.name.slice(0, 14) + '…' : pm.name, PAD, py + pitchItemH / 2)
    const barX = PAD + 84
    ctx.fillStyle = '#1C2230'; ctx.fillRect(barX, py + 7, barMaxW, 7)
    ctx.fillStyle = pm.color; ctx.fillRect(barX, py + 7, barMaxW * pm.pct / 100, 7)
    ctx.fillStyle = '#E6EDF3'; ctx.font = 'bold 9px monospace'
    ctx.textAlign = 'right'
    ctx.fillText(`${pm.pct}%`, PAD + MID_LEFT_W, py + pitchItemH / 2)
    ctx.textAlign = 'left'
  }

  // Pitch scatter plot (right)
  const PLOT_W = W - PAD - MID_RIGHT_X
  const PLOT_H = MID_H - 14
  const plotY = midY + 14

  ctx.fillStyle = '#6B7280'; ctx.font = 'bold 8px sans-serif'
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'
  ctx.fillText('PITCH LOCATION', MID_RIGHT_X, midY)

  ctx.fillStyle = '#0F172A'
  pbRoundRect(ctx, MID_RIGHT_X, plotY, PLOT_W, PLOT_H, 3); ctx.fill()

  const mapPX = (pX: number) => MID_RIGHT_X + ((pX + 2) / 4) * PLOT_W
  const mapPZ = (pZ: number) => plotY + PLOT_H * (1 - (pZ - 0.5) / 4.5)

  const szL = mapPX(-0.83), szR = mapPX(0.83)
  const szT = mapPZ(3.38),  szB = mapPZ(1.55)

  ctx.strokeStyle = '#334155'; ctx.lineWidth = 0.5
  for (let gi = 1; gi < 3; gi++) {
    ctx.beginPath(); ctx.moveTo(szL + (szR - szL) * gi / 3, szT); ctx.lineTo(szL + (szR - szL) * gi / 3, szB); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(szL, szT + (szB - szT) * gi / 3); ctx.lineTo(szR, szT + (szB - szT) * gi / 3); ctx.stroke()
  }

  ctx.strokeStyle = '#475569'; ctx.lineWidth = 1.2
  ctx.setLineDash([3, 2])
  ctx.strokeRect(szL, szT, szR - szL, szB - szT)
  ctx.setLineDash([])

  ctx.strokeStyle = '#475569'; ctx.lineWidth = 1.2
  ctx.beginPath(); ctx.moveTo(MID_RIGHT_X + PLOT_W / 2, plotY + PLOT_H - 5); ctx.lineTo(MID_RIGHT_X + PLOT_W / 2, plotY + PLOT_H - 1); ctx.stroke()

  for (const layer of RESULT_LAYERS) {
    for (const p of data.pitches.filter(p => p.result === layer)) {
      const px = mapPX(p.x), py = mapPZ(p.z)
      const isHit = layer === 'single' || layer === 'double' || layer === 'triple' || layer === 'home_run'
      const isK   = layer === 'swinging_strike'
      if (isHit) {
        const r = 4
        ctx.fillStyle = RESULT_COLOR[layer]
        ctx.beginPath(); ctx.moveTo(px, py - r); ctx.lineTo(px + r, py); ctx.lineTo(px, py + r); ctx.lineTo(px - r, py); ctx.closePath(); ctx.fill()
        ctx.strokeStyle = '#C9A22A'; ctx.lineWidth = 1; ctx.stroke()
      } else {
        ctx.globalAlpha = layer === 'ball' ? 0.28 : layer === 'foul' ? 0.45 : 0.88
        ctx.fillStyle = p.color
        ctx.beginPath(); ctx.arc(px, py, isK ? 3.2 : 2.5, 0, Math.PI * 2); ctx.fill()
        ctx.globalAlpha = 1
        if (isK) {
          ctx.strokeStyle = '#C9A22A'; ctx.lineWidth = 1
          ctx.beginPath(); ctx.arc(px, py, 3.2, 0, Math.PI * 2); ctx.stroke()
        }
      }
    }
  }

  // ── Footer watermark ──
  const LOGO_H_F = 16, LOGO_W_F = Math.round(LOGO_H_F * 989 / 623)
  const footerY = H - PAD - FOOTER_H + 4
  ctx.fillStyle = '#4B5563'; ctx.font = '8px sans-serif'
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'
  ctx.fillText(`${data.totalPitches} pitches · samalytics.com`, PAD, footerY + 2)
  if (siteLogoImg) {
    ctx.drawImage(siteLogoImg, W - PAD - LOGO_W_F, footerY, LOGO_W_F, LOGO_H_F)
    ctx.fillStyle = '#4B5563'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    ctx.fillText('samalytics', W - PAD - LOGO_W_F - 4, footerY + LOGO_H_F / 2)
  } else {
    ctx.fillStyle = '#4B5563'; ctx.textAlign = 'right'; ctx.textBaseline = 'top'
    ctx.fillText('samalytics', W - PAD, footerY + 2)
  }

  canvas.toBlob(async blob => {
    if (!blob) return
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    } catch {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      a.download = `${data.pitcherName.replace(/\s+/g, '_')}_breakdown.png`
      a.click(); URL.revokeObjectURL(url)
    }
  })
}

// ── Main export ───────────────────────────────────────────────────────────────

interface Props {
  data: GameBreakdown
  accentColor?: string
  label?: string
}

export default function PitcherBreakdown({ data, accentColor = '#3D405B', label = 'Pitcher Spotlight' }: Props) {
  const [copying, setCopying] = useState(false)
  const [copied, setCopied] = useState(false)
  const opsColor = data.ops < 0.600 ? '#3C999E' : data.ops < 0.750 ? '#C9A22A' : '#9B405A'

  return (
    <div className="bg-surface border border-538-border rounded-xl overflow-hidden">
      <div className="h-1 w-full" style={{ backgroundColor: accentColor }} />

      <div className="p-4 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: accentColor }}>
            {label}
          </span>
          <span className="text-[11px] text-538-muted">{data.gameDate}</span>
        </div>

        {/* Top: gauge/stats | heatmap/zone */}
        <div className="flex flex-col lg:flex-row gap-5">
          <div className="flex flex-col gap-4 lg:w-[340px] shrink-0">
            <div className="flex items-center gap-4">
              <PercentileGauge percentile={data.percentile} />
              <div className="flex flex-col gap-1.5 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <img src={logoUrl(data.pitcherTeamAbbr)} alt={data.pitcherTeamAbbr} width={22} height={22} className="object-contain shrink-0" />
                  <span className="text-xs font-semibold text-538-muted uppercase tracking-wider">{data.pitcherTeamAbbr} vs {data.opponentAbbr}</span>
                  <span className="text-[10px] text-538-muted tabular-nums">{data.gameResult}</span>
                </div>
                <h3 className="font-bold text-lg text-538-text leading-tight">{data.pitcherName}</h3>
                <div className="flex gap-3 flex-wrap text-[10px] text-538-muted">
                  <span>ERA <span className="font-semibold text-538-text">{data.seasonEra != null ? data.seasonEra.toFixed(2) : '—'}</span></span>
                  <span>ERA%ile <span className="font-semibold" style={{ color: percentileColor(data.eraPercentile) }}>{data.eraPercentile}</span></span>
                  <span>K/9%ile <span className="font-semibold" style={{ color: percentileColor(data.k9Percentile) }}>{data.k9Percentile}</span></span>
                </div>
              </div>
            </div>

            <p className="text-sm text-538-muted leading-relaxed">{data.blurb}</p>

            <div className="flex flex-wrap gap-2">
              <StatBox label="IP" value={data.ipDisplay} />
              <StatBox label="K"  value={String(data.ks)} />
              <StatBox label="BB" value={String(data.bbs)} />
              <StatBox label="H"  value={String(data.hits)} />
              <StatBox label="ER" value={String(data.er)} />
              <div className="flex flex-col items-center bg-538-border/20 rounded-lg px-3 py-2 min-w-[52px]">
                <span className="text-[10px] font-bold uppercase tracking-widest text-538-muted">OPS</span>
                <span className="text-xl font-black tabular-nums leading-tight" style={{ color: opsColor }}>{data.ops.toFixed(3)}</span>
                <span className="text-[9px] text-538-muted">against</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-widest text-538-muted">Pitch Mix</div>
              {data.pitchMix.slice(0, 5).map(p => (
                <div key={p.type} className="flex items-center gap-2">
                  <span className="text-[10px] text-538-muted w-28 truncate">{p.name}</span>
                  <div className="flex-1 h-2 rounded-full bg-538-border/30 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${p.pct}%`, backgroundColor: p.color }} />
                  </div>
                  <span className="text-[10px] font-bold tabular-nums text-538-text w-8 text-right">{p.pct}%</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-5 flex-1 min-w-0">
            {data.pitches.length > 0 ? (
              <>
                <PitchHeatmap pitches={data.pitches} pitchMix={data.pitchMix} />
                <ZoneGrid pitches={data.pitches} />
              </>
            ) : (
              <div className="flex items-center justify-center flex-1 text-sm text-538-muted">Pitch location data unavailable</div>
            )}
          </div>
        </div>

        {data.pitches.length > 0 && <PitchTypeZones pitches={data.pitches} pitchMix={data.pitchMix} />}

        {/* Footer */}
        <div className="pt-2 border-t border-538-border space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-538-muted tabular-nums">{data.totalPitches} pitches · Game Score {data.gameScore}</span>
            <div className="flex items-center gap-3">
              <button
                className={`text-[11px] font-semibold px-2.5 py-1 rounded border transition-colors ${copied ? 'border-emerald-500 text-emerald-500' : 'border-538-border text-538-muted hover:text-538-text hover:border-538-text'}`}
                onClick={async () => {
                  if (copying) return
                  setCopying(true)
                  await exportBreakdownImage(data)
                  setCopied(true); setCopying(false)
                  setTimeout(() => setCopied(false), 2000)
                }}
              >
                {copied ? '✓ Copied' : copying ? '…' : '⎘ Copy'}
              </button>
              <Link href={`/analysis/pitching/${data.pitcherTeamAbbr}`} className="text-xs font-semibold text-538-orange hover:underline">
                {data.pitcherTeamAbbr} Pitching Analysis →
              </Link>
            </div>
          </div>
          <p className="text-[9px] text-538-muted leading-relaxed">
            <span className="font-semibold">Percentile</span> maps the Bill James Game Score to the historical distribution of MLB starting outings.{' '}
            <span className="font-semibold">Game Score</span> = 50 + (outs) + 2×(IP after 4th) + (K) − 2×(H) − (BB) − 4×(ER) − 2×(unearned R).
            Average ≈ 50 · Quality start ≈ 60+ · Elite ≈ 75+.
          </p>
        </div>
      </div>
    </div>
  )
}
