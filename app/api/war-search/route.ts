import { NextRequest, NextResponse } from 'next/server'
import { getPlayerWar, getLegendWar } from '../../../lib/data'
import type { WarSeason } from '../../../lib/types'

export const dynamic = 'force-dynamic'

export interface WarSearchResult {
  name: string
  team?: string
  player_type?: string
  career: WarSeason[]
}

export function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.toLowerCase().trim() ?? ''
  if (q.length < 2) return NextResponse.json([])

  const results: WarSearchResult[] = []

  // Current-season players first (have full career arrays)
  for (const p of getPlayerWar()) {
    if (p.name.toLowerCase().includes(q)) {
      results.push({ name: p.name, team: p.team, player_type: p.player_type, career: p.career })
      if (results.length >= 8) break
    }
  }

  // Fill with legends if there is room
  if (results.length < 8) {
    for (const [name, seasons] of Object.entries(getLegendWar())) {
      if (name.toLowerCase().includes(q) && !results.find((r) => r.name === name)) {
        results.push({ name, career: seasons as unknown as WarSeason[] })
        if (results.length >= 8) break
      }
    }
  }

  return NextResponse.json(results)
}
