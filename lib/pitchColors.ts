// Shared pitch color palette — dark Material-Design tones, consistent site-wide
export const PITCH_COLORS: Record<string, string> = {
  FF: '#C62828',   // 4-Seam Fastball
  SI: '#E64A19',   // Sinker
  FC: '#F57C00',   // Cutter
  FT: '#D84315',   // 2-Seam
  SL: '#1565C0',   // Slider
  ST: '#6A1B9A',   // Sweeper
  SV: '#7B1FA2',   // Slurve
  SW: '#4527A0',   // Slow Curve
  CU: '#283593',   // Curveball
  KC: '#37474F',   // Knuckle Curve
  CH: '#2E7D32',   // Changeup
  FS: '#00695C',   // Splitter
  FO: '#00796B',   // Forkball
  SC: '#0277BD',   // Screwball
  KN: '#546E7A',   // Knuckleball
  EP: '#78909C',   // Eephus
}

export const pitchColor = (pt: string) => PITCH_COLORS[pt] ?? '#78909C'
