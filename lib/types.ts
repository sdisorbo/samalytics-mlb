export interface TeamStanding {
  team: string
  team_abbr: string
  division: string
  elo_rating: number
  elo_change_7d: number
  wins: number
  losses: number
  run_diff: number
  playoff_probability: number
  win_ds: number
  win_cs: number
  win_ws: number
}

export interface RatingPoint {
  date: string
  rating: number
}

export type TeamRatingsHistory = Record<string, RatingPoint[]>

export interface Pitcher {
  player_id: number
  name: string
  team: string
  team_name: string
  division: string
  era: number | null
  fip: number | null
  xfip: number | null
  k_per_9: number
  bb_per_9: number
  whip: number | null
  innings_pitched: number
  strikeouts: number
  walks: number
  home_runs_allowed: number
  era_percentile: number
  fip_percentile: number
  k9_percentile: number
  bb9_percentile: number
  whip_percentile: number
}

export interface Player {
  player_id: number
  name: string
  team: string
  team_name: string
  division: string
  position: string
  avg: number | null
  obp: number | null
  slg: number | null
  ops: number | null
  k_pct: number | null
  bb_pct: number | null
  avg_exit_velocity: null
  hard_hit_pct: null
  xba: null
  xslg: null
  barrel_pct: null
  whiff_pct: null
  chase_rate: null
  avg_percentile: number
  obp_percentile: number
  slg_percentile: number
  ops_percentile: number
  k_pct_percentile: number
  bb_pct_percentile: number
}

export interface PlayoffOdds {
  last_updated: string
  simulations: number
  results: PlayoffTeam[]
}

export interface PlayoffTeam {
  team: string
  win_wildcard: number
  win_ds: number
  win_cs: number
  win_ws: number
}
