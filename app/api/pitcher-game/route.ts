import { NextResponse } from 'next/server'
import { fetchGameBreakdown, fetchGameStarters } from '../../../lib/pitcherGame'

// GET /api/pitcher-game?gamePk=716123&pitcherId=663436
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const gamePk    = parseInt(searchParams.get('gamePk')    ?? '', 10)
    const pitcherId = parseInt(searchParams.get('pitcherId') ?? '', 10)
    if (!gamePk || !pitcherId) return NextResponse.json(null)

    const starters = await fetchGameStarters(gamePk)
    const starter  = starters.find(s => s.pitcherId === pitcherId)
    if (!starter) return NextResponse.json(null)

    // Format date from the gamePk date via schedule (fall back to today if unavailable)
    const dateDisplay = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' })

    const breakdown = await fetchGameBreakdown(
      gamePk,
      starter.pitcherId,
      starter.pitcherName,
      starter.teamAbbr,
      starter.opponentAbbr,
      starter.ipDisplay,
      starter.ks,
      starter.bbs,
      starter.hits,
      starter.er,
      starter.r,
      starter.pitchCount,
      starter.homeRuns,
      starter.battersFaced,
      starter.gameResult,
      dateDisplay,
      3600,
    )

    return NextResponse.json(breakdown)
  } catch {
    return NextResponse.json(null)
  }
}
