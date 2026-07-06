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

export interface PitchArsenal {
  pitch_type: string
  pitch_name: string
  usage_pct: number | null
  whiff_pct: number | null
  woba_against: number | null
  xwoba_against: number | null
  hard_hit_pct: number | null
  run_value_per_100: number | null
  avg_speed: number | null
  break_x: number | null
  break_z: number | null
  // Per-pitch-type kinematic averages from Statcast Search.
  // All values in Statcast's native catcher-view frame: +x = catcher's
  // right (1B side), +y = toward mound, +z = up. Velocities in ft/s,
  // accelerations in ft/s² (include gravity and Magnus combined).
  release_pos_x?: number | null
  release_pos_y?: number | null
  release_pos_z?: number | null
  release_extension?: number | null
  release_spin_rate?: number | null
  spin_axis?: number | null         // degrees, 0-360 (12 o'clock = 0)
  effective_speed?: number | null   // perceived mph at the plate
  vx0?: number | null
  vy0?: number | null
  vz0?: number | null
  ax?: number | null
  ay?: number | null
  az?: number | null
  arm_angle?: number | null         // degrees above horizontal
}

export interface PitcherArsenal {
  player_id: number
  name: string
  team: string
  /**
   * Estimated fraction of pitches thrown in the strike zone, derived from
   * the pitcher's BB/9. Ranges ≈ 0.36–0.58. Missing when pitchers.json
   * doesn't contain a matching entry (e.g. very short stints).
   */
  zone_pct?: number
  pitches: PitchArsenal[]
}

export interface PitchVsStats {
  pitch_type: string
  pitch_name: string
  pa: number
  woba: number | null
  xwoba: number | null
  ba: number | null
  slg: number | null
  whiff_pct: number | null
  hard_hit_pct: number | null
  run_value_per_100: number | null
}

export interface BatterVsPitch {
  player_id: number
  name: string
  team: string
  vs_pitches: PitchVsStats[]
}

export interface PlayoffOdds {
  last_updated: string
  simulations: number
  results: PlayoffTeam[]
}

// Flattened (pitcher, pitch) row for the Pitch Visualizer leaderboard.
export interface RankedPitch {
  pitcher_id: number
  pitcher_name: string
  team: string
  pitch_type: string
  pitch_name: string
  usage_pct: number
  whiff_pct: number | null
  woba_against: number | null
  xwoba_against: number | null
  hard_hit_pct: number | null
  run_value_per_100: number | null
  avg_speed: number | null
  break_x: number | null
  break_z: number | null
  release_pos_x?: number | null
  release_pos_y?: number | null
  release_pos_z?: number | null
  release_extension?: number | null
  release_spin_rate?: number | null
  spin_axis?: number | null
  effective_speed?: number | null
  vx0?: number | null
  vy0?: number | null
  vz0?: number | null
  ax?: number | null
  ay?: number | null
  az?: number | null
  arm_angle?: number | null
}

export interface PlayoffTeam {
  team: string
  win_wildcard: number
  win_ds: number
  win_cs: number
  win_ws: number
}

export interface PlayerWar {
  player_id: number | null
  bref_id: string
  name: string
  team: string
  g: number
  pa: number
  war: number
  off_war: number
  def_war: number
}

export type LegendWar = Record<string, Array<{
  year: number
  war: number
  off_war: number
  def_war: number
}>>

export interface BatterGameLog {
  name: string
  pa: number
  rv: number   // sum of delta_run_exp across all PAs in this game
}

export interface TeamGame {
  date: string
  game_pk: number
  opponent: string
  home: boolean
  actual_runs: number | null
  team_rv: number            // sum of all batter RVs = team batting RV for game
  batters: BatterGameLog[]   // sorted descending by rv
}

export interface TeamGameLog {
  team: string
  games: TeamGame[]
}
