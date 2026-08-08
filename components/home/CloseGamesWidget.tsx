'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface TeamSide {
  abbr: string
  score: number | null
  winProb: number
}

interface Game {
  gamePk: number
  gameTime: string
  state: string
  inning: number | null
  inningHalf: string | null
  away: TeamSide
  home: TeamSide
}

function logoUrl(abbr: string): string {
  return `https://a.espncdn.com/i/teamlogos/mlb/500/${abbr.toLowerCase()}.png`
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  } catch {
    return iso
  }
}

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image(); img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img); img.onerror = () => resolve(null); img.src = src
  })
}

function canvasRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath()
}

async function exportGameCardImage(game: Game) {
  const SCALE = 2, W = 280, PAD = 14
  const ROW_H = 40, DIVIDER_H = 26, BAR_SECTION_H = 32, FOOTER_H = 22
  const H = PAD + ROW_H + DIVIDER_H + ROW_H + BAR_SECTION_H + FOOTER_H + PAD

  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE; canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')!; ctx.scale(SCALE, SCALE)

  ctx.fillStyle = '#0D1117'; ctx.fillRect(0, 0, W, H)

  const [awayLogoImg, homeLogoImg, siteLogoImg] = await Promise.all([
    loadImg(logoUrl(game.away.abbr)),
    loadImg(logoUrl(game.home.abbr)),
    loadImg('/logo.png'),
  ])

  const LOGO_SIZE = 28

  // Away row
  const awayMidY = PAD + ROW_H / 2
  if (awayLogoImg) ctx.drawImage(awayLogoImg, PAD, awayMidY - LOGO_SIZE / 2, LOGO_SIZE, LOGO_SIZE)
  ctx.fillStyle = '#E6EDF3'; ctx.font = 'bold 13px sans-serif'
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  ctx.fillText(game.away.abbr, PAD + LOGO_SIZE + 8, awayMidY)
  const awayColor = game.away.winProb >= 60 ? '#4ADE80' : game.away.winProb <= 40 ? '#EF7070' : '#9CA3AF'
  ctx.fillStyle = awayColor; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'right'
  ctx.fillText(`${game.away.winProb}%`, W - PAD, awayMidY)

  // Divider with time
  const divY = PAD + ROW_H + DIVIDER_H / 2
  const timeStr = formatTime(game.gameTime)
  ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const tw = ctx.measureText(timeStr).width + 12
  ctx.strokeStyle = '#2A313C'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(PAD, divY); ctx.lineTo(W / 2 - tw / 2 - 4, divY); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(W / 2 + tw / 2 + 4, divY); ctx.lineTo(W - PAD, divY); ctx.stroke()
  ctx.fillStyle = '#4B5563'; ctx.fillText(timeStr, W / 2, divY)

  // Home row
  const homeMidY = PAD + ROW_H + DIVIDER_H + ROW_H / 2
  if (homeLogoImg) ctx.drawImage(homeLogoImg, PAD, homeMidY - LOGO_SIZE / 2, LOGO_SIZE, LOGO_SIZE)
  ctx.fillStyle = '#E6EDF3'; ctx.font = 'bold 13px sans-serif'
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  ctx.fillText(game.home.abbr, PAD + LOGO_SIZE + 8, homeMidY)
  const homeColor = game.home.winProb >= 60 ? '#4ADE80' : game.home.winProb <= 40 ? '#EF7070' : '#9CA3AF'
  ctx.fillStyle = homeColor; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'right'
  ctx.fillText(`${game.home.winProb}%`, W - PAD, homeMidY)

  // Win prob bar
  const barY = PAD + ROW_H + DIVIDER_H + ROW_H + 8
  const barH = 5, barW = W - 2 * PAD
  ctx.fillStyle = '#2A313C'; canvasRoundRect(ctx, PAD, barY, barW, barH, 2); ctx.fill()
  ctx.fillStyle = '#C4143A'; canvasRoundRect(ctx, PAD, barY, barW * game.away.winProb / 100, barH, 2); ctx.fill()
  ctx.fillStyle = '#6B7280'; ctx.font = '9px sans-serif'
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'
  ctx.fillText(game.away.abbr, PAD, barY + barH + 4)
  ctx.textAlign = 'right'
  ctx.fillText(game.home.abbr, W - PAD, barY + barH + 4)

  // Footer watermark
  const LOGO_H_F = 14
  const LOGO_W_F = Math.round(LOGO_H_F * 989 / 623)
  const footerY = PAD + ROW_H + DIVIDER_H + ROW_H + BAR_SECTION_H + 6
  ctx.fillStyle = '#4B5563'; ctx.font = '8px sans-serif'
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'
  ctx.fillText('Elo-based win probability', PAD, footerY + 1)
  if (siteLogoImg) {
    ctx.drawImage(siteLogoImg, W - PAD - LOGO_W_F, footerY, LOGO_W_F, LOGO_H_F)
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
    ctx.fillText('samalytics', W - PAD - LOGO_W_F - 4, footerY + LOGO_H_F / 2)
  } else {
    ctx.textAlign = 'right'; ctx.textBaseline = 'top'
    ctx.fillText('samalytics', W - PAD, footerY + 1)
  }

  canvas.toBlob(async blob => {
    if (!blob) return
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    } catch {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url
      a.download = `${game.away.abbr}_vs_${game.home.abbr}_prediction.png`
      a.click(); URL.revokeObjectURL(url)
    }
  })
}

function GameCard({ game }: { game: Game }) {
  const router = useRouter()
  const [copying, setCopying] = useState(false)
  const [copied, setCopied] = useState(false)

  return (
    <div
      className="bg-surface border border-538-border rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => router.push(`/analysis/game/${game.gamePk}`)}
    >
      {/* Away row */}
      <div className="flex items-center gap-2 mb-3">
        <img src={logoUrl(game.away.abbr)} alt={game.away.abbr} width={28} height={28} className="object-contain" />
        <span className="font-bold text-sm text-538-text tracking-wide flex-1">{game.away.abbr}</span>
        <span className={`text-xs font-bold tabular-nums ${game.away.winProb >= 60 ? 'text-emerald-600 dark:text-emerald-400' : game.away.winProb <= 40 ? 'text-rose-600 dark:text-rose-400' : 'text-538-muted'}`}>
          {game.away.winProb}%
        </span>
      </div>

      {/* Divider with time */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 h-px bg-538-border" />
        <span className="text-[11px] font-semibold text-538-muted uppercase tracking-wider">
          {formatTime(game.gameTime)}
        </span>
        <div className="flex-1 h-px bg-538-border" />
      </div>

      {/* Home row */}
      <div className="flex items-center gap-2">
        <img src={logoUrl(game.home.abbr)} alt={game.home.abbr} width={28} height={28} className="object-contain" />
        <span className="font-bold text-sm text-538-text tracking-wide flex-1">{game.home.abbr}</span>
        <span className={`text-xs font-bold tabular-nums ${game.home.winProb >= 60 ? 'text-emerald-600 dark:text-emerald-400' : game.home.winProb <= 40 ? 'text-rose-600 dark:text-rose-400' : 'text-538-muted'}`}>
          {game.home.winProb}%
        </span>
      </div>

      {/* Win prob bar */}
      <div className="mt-3 h-1.5 rounded-full overflow-hidden bg-538-border">
        <div className="h-full rounded-full bg-538-orange transition-all" style={{ width: `${game.away.winProb}%` }} />
      </div>
      <div className="flex justify-between mt-0.5">
        <span className="text-[10px] text-538-muted">{game.away.abbr}</span>
        <span className="text-[10px] text-538-muted">{game.home.abbr}</span>
      </div>

      {/* Copy button */}
      <div className="mt-3 flex justify-end">
        <button
          className={`text-[11px] font-semibold px-2.5 py-1 rounded border transition-colors ${copied ? 'border-emerald-500 text-emerald-500' : 'border-538-border text-538-muted hover:text-538-text hover:border-538-text'}`}
          onClick={async (e) => {
            e.stopPropagation()
            if (copying) return
            setCopying(true)
            await exportGameCardImage(game)
            setCopied(true)
            setCopying(false)
            setTimeout(() => setCopied(false), 2000)
          }}
        >
          {copied ? '✓ Copied' : copying ? '…' : '⎘ Copy'}
        </button>
      </div>
    </div>
  )
}

export default function CloseGamesWidget() {
  const [games, setGames]     = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(false)

  useEffect(() => {
    fetch('/api/today-games')
      .then((r) => {
        if (!r.ok) throw new Error('fetch failed')
        return r.json() as Promise<Game[]>
      })
      .then((all) => {
        const active = all.filter((g) => g.state === 'Preview' || g.state === 'Live')
        const sorted = active.sort(
          (a, b) =>
            Math.abs(a.away.winProb - 50) - Math.abs(b.away.winProb - 50)
        )
        setGames(sorted.slice(0, 3))
        setLoading(false)
      })
      .catch(() => {
        setError(true)
        setLoading(false)
      })
  }, [])

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 bg-538-border/30 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  if (error || games.length === 0) {
    return (
      <div className="bg-surface border border-538-border rounded-xl p-4 text-center">
        <p className="text-538-muted text-sm">No upcoming games available.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {games.map((g) => (
        <GameCard key={g.gamePk} game={g} />
      ))}
    </div>
  )
}
