import { NextRequest, NextResponse } from 'next/server'
import { getPitcherArsenal } from '../../../lib/data'

export const dynamic = 'force-dynamic'

export function GET(req: NextRequest) {
  const pitcherId = req.nextUrl.searchParams.get('pitcherId')
  if (!pitcherId) return NextResponse.json(null)
  const all = getPitcherArsenal()
  const entry = all.find(p => p.player_id === Number(pitcherId))
  return NextResponse.json(entry ?? null)
}
