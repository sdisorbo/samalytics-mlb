'use client'

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Line, Text } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import type { SelectedPitch } from './PitchVisualizer'

// ── Coordinate system ────────────────────────────────────────────────────────
// Origin: front of home plate.
// +x = catcher's right (1B side).
// +y = up.
// +z = toward the pitcher's mound.
// Pitcher rubber at z = 60.5 ft. Ball release ~5 ft in front of rubber.
//
// break_x and break_z in our data are in PITCHER's perspective (+x_data =
// pitcher's right = 3B side). To convert into scene coords we negate x.

const PLATE_WIDTH = 17 / 12 // ft
const ZONE_BOTTOM = 18 / 12 // ~knees, ft
const ZONE_TOP = 42 / 12    // ~letters, ft
const RUBBER_Z = 60.5
const RELEASE_Z = 55        // 5 ft in front of rubber
const GRAVITY = 32.2        // ft/s²

const PITCH_COLORS: Record<string, string> = {
  FF: '#C62828', SI: '#E64A19', FC: '#F57C00',
  SL: '#1565C0', ST: '#6A1B9A', SV: '#7B1FA2',
  CU: '#283593', KC: '#37474F',
  CH: '#2E7D32', FS: '#00695C',
  KN: '#546E7A', EP: '#78909C',
}
const pitchColor = (pt: string) => PITCH_COLORS[pt] ?? '#888'

// ── Static scene geometry ────────────────────────────────────────────────────
function StrikeZone() {
  // Wireframe rectangle at the front of the plate, in the y/x plane (z=0)
  const points: [number, number, number][] = [
    [-PLATE_WIDTH / 2, ZONE_BOTTOM, 0],
    [PLATE_WIDTH / 2, ZONE_BOTTOM, 0],
    [PLATE_WIDTH / 2, ZONE_TOP, 0],
    [-PLATE_WIDTH / 2, ZONE_TOP, 0],
    [-PLATE_WIDTH / 2, ZONE_BOTTOM, 0],
  ]
  return <Line points={points} color="#FFD27F" lineWidth={2} transparent opacity={0.8} />
}

function Plate() {
  // Five-sided home plate, lying flat at y=0.
  const w = PLATE_WIDTH / 2
  const points: [number, number, number][] = [
    [-w, 0, -0.75], // back-left
    [w, 0, -0.75],  // back-right
    [w, 0, 0],      // front-right
    [0, 0, 0.71],   // tip (toward pitcher)
    [-w, 0, 0],     // front-left
    [-w, 0, -0.75], // close
  ]
  return <Line points={points} color="#FFFFFF" lineWidth={1.5} transparent opacity={0.9} />
}

// Duo-tone palette — neutral greys/beiges so the colored ball + trail pop.
const COLOR_GROUND = '#928470'    // muted beige-grey grass
const COLOR_DIRT = '#A89980'      // lighter beige (mound/dirt)
const COLOR_RUBBER = '#E6DDC8'
const COLOR_LINE = '#E6DDC8'      // chalk lines, batter's box, base paths
const COLOR_LINE_DIM = '#B8A98C'  // dimmer beige for less prominent lines

// MLB team primary colors. Used for the release-point disc on the mound.
const TEAM_COLORS: Record<string, string> = {
  ARI: '#A71930', ATL: '#CE1141', BAL: '#DF4601', BOS: '#BD3039',
  CHC: '#0E3386', CWS: '#27251F', CIN: '#C6011F', CLE: '#00385D',
  COL: '#33006F', DET: '#0C2340', HOU: '#002D62', KC:  '#004687',
  LAA: '#BA0021', LAD: '#005A9C', MIA: '#00A3E0', MIL: '#12284B',
  MIN: '#002B5C', NYM: '#FF5910', NYY: '#003087', OAK: '#003831',
  ATH: '#003831',
  PHI: '#E81828', PIT: '#FDB827', SD:  '#2F241D', SF:  '#FD5A1E',
  SEA: '#0C2C56', STL: '#C41E3A', TB:  '#092C5C', TEX: '#003278',
  TOR: '#134A8E', WSH: '#AB0003',
}
const teamColor = (team: string) => TEAM_COLORS[team.toUpperCase()] ?? '#5B5650'

function Mound() {
  return (
    <group position={[0, 0.01, RUBBER_Z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[9, 32]} />
        <meshStandardMaterial color={COLOR_DIRT} flatShading />
      </mesh>
      <mesh position={[0, 0.15, 0]}>
        <boxGeometry args={[2, 0.1, 0.5]} />
        <meshStandardMaterial color={COLOR_RUBBER} />
      </mesh>
    </group>
  )
}

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 200]}>
      <planeGeometry args={[700, 700]} />
      <meshStandardMaterial color={COLOR_GROUND} flatShading />
    </mesh>
  )
}

function OutfieldWall() {
  // Approximate MLB park: 330 ft down the lines, 400 ft to dead center,
  // with smooth alleys. Wall ~8 ft tall.
  // The fence is an arc of 21 segments from foul pole to foul pole,
  // bridging from world (−D, 0, D) (1B line at 90 ft) outward to (+D, 0, D).
  // For each angle θ, distance varies sinusoidally between 330 and 400.
  const segments = 24
  const points: [number, number, number][] = []
  const topPoints: [number, number, number][] = []
  // Foul lines go from home plate at 45° from straight-toward-mound. So we
  // sweep angles from 45° (1B foul line) to 135° (3B foul line) — i.e., the
  // half-plane in front of home plate.
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const angle = (Math.PI / 4) + t * (Math.PI / 2) // 45° → 135°
    // Distance: 330 at the foul lines (t=0 or 1), 400 at center (t=0.5)
    const norm = Math.sin(t * Math.PI) // 0→1→0
    const dist = 330 + 70 * norm
    // World coords: angle measured from +z (toward mound). +x = right (3B).
    // Actually we want angles centered on +z. Let me reparameterize.
    // Let phi = angle - PI/2 = sweep angle around +z, from -45° (1B line)
    // to +45° (3B line).
    const phi = angle - Math.PI / 2
    const x = dist * Math.sin(phi)
    const z = dist * Math.cos(phi)
    points.push([x, 0.02, z])
    topPoints.push([x, 8, z])
  }
  // Build vertical segments connecting bottom to top for a fence look.
  const fenceVerticals: [number, number, number][][] = []
  for (let i = 0; i <= segments; i++) {
    fenceVerticals.push([points[i], topPoints[i]])
  }
  return (
    <group>
      {/* Top rail */}
      <Line points={topPoints} color="#E6DDC8" lineWidth={2} transparent opacity={0.85} />
      {/* Base rail */}
      <Line points={points} color="#B8A98C" lineWidth={1} transparent opacity={0.5} />
      {/* Vertical posts every ~4 segments for a subtle fence feel */}
      {fenceVerticals.filter((_, i) => i % 3 === 0).map((seg, i) => (
        <Line key={i} points={seg} color="#B8A98C" lineWidth={1} transparent opacity={0.35} />
      ))}
    </group>
  )
}

function Diamond() {
  // Infield diamond outline. Bases are 90 ft apart on the diagonals from home.
  // 1B is on the 1B side (world -x), 3B on the 3B side (world +x).
  const D = 90 / Math.SQRT2 // ≈ 63.64 ft
  const home: [number, number, number] = [0, 0.02, 0]
  const first: [number, number, number] = [-D, 0.02, D]
  const second: [number, number, number] = [0, 0.02, D * 2]
  const third: [number, number, number] = [D, 0.02, D]
  return (
    <group>
      {/* Diamond perimeter */}
      <Line points={[home, first, second, third, home]} color={COLOR_LINE} lineWidth={1.5} transparent opacity={0.7} />
      {/* Foul lines extending past the bases */}
      <Line points={[home, [-D * 1.8, 0.02, D * 1.8]]} color={COLOR_LINE_DIM} lineWidth={1} transparent opacity={0.45} />
      <Line points={[home, [D * 1.8, 0.02, D * 1.8]]} color={COLOR_LINE_DIM} lineWidth={1} transparent opacity={0.45} />
      {/* Bases */}
      {[first, second, third].map((p, i) => (
        <mesh key={i} position={p} rotation={[-Math.PI / 2, 0, Math.PI / 4]}>
          <planeGeometry args={[1.25, 1.25]} />
          <meshStandardMaterial color={COLOR_RUBBER} />
        </mesh>
      ))}
    </group>
  )
}

function BatterBoxes() {
  // Two 6'-long × 4'-wide rectangles on either side of the plate. Inner edge
  // is 6" from the plate edge (plate is 17" wide centered at x=0).
  const inner = 8.5 / 12 + 6 / 12 // ft from center to inner edge
  const outer = inner + 4         // 4 ft wide
  const zBack = 3                 // box extends 3 ft behind plate front
  const zFront = -3               // and 3 ft in front of plate front (toward pitcher)
  // Note: z=0 is the plate's front edge, mound is at +z, so "in front of plate
  // toward pitcher" is +z. Box centered on plate-front.
  const boxR: [number, number, number][] = [
    [inner, 0.02, -zBack],
    [outer, 0.02, -zBack],
    [outer, 0.02, zBack],
    [inner, 0.02, zBack],
    [inner, 0.02, -zBack],
  ]
  const boxL: [number, number, number][] = boxR.map(([x, y, z]) => [-x, y, z])
  return (
    <group>
      <Line points={boxR} color={COLOR_LINE} lineWidth={1.5} transparent opacity={0.7} />
      <Line points={boxL} color={COLOR_LINE} lineWidth={1.5} transparent opacity={0.7} />
    </group>
  )
}

// windupProgress: 0 = at rest, ramps to 1 during the last second of the pre-fly
// wait. The disc pulls back and up for ~40%, then thrusts forward over the
// remaining 60% — communicating the "throwing motion" without a full figure.
function getWindupOffset(progress: number): { x: number; y: number; z: number } {
  if (progress <= 0) return { x: 0, y: 0, z: 0 }
  const PULL_Y = 0.6
  const PULL_Z = 2.0  // toward mound = +z
  if (progress < 0.4) {
    const t = progress / 0.4
    const e = t * t // ease-in
    return { x: 0, y: e * PULL_Y, z: e * PULL_Z }
  }
  const t = (progress - 0.4) / 0.6
  const e = 1 - Math.pow(1 - t, 3) // ease-out
  return { x: 0, y: (1 - e) * PULL_Y, z: (1 - e) * PULL_Z }
}

function PitcherCard({
  x,
  name,
  team,
  hideIdentity,
  windupProgress = 0,
}: {
  x: number
  name: string
  team: string
  hideIdentity?: boolean
  windupProgress?: number
}) {
  // Replaces the pitcher silhouette. A small team-colored disc on the mound
  // marks where the pitch is released; the pitcher's name floats just above.
  // In test mode (hideIdentity) we swap to a neutral grey disc and skip the
  // name/team labels so they don't give away the pitch.
  const color = hideIdentity ? '#5B5650' : teamColor(team)
  const off = getWindupOffset(windupProgress)
  return (
    <group position={[x, 0, RUBBER_Z]}>
      <mesh position={[0, 3.0, 0]}>
        <cylinderGeometry args={[0.04, 0.04, 6.0, 8]} />
        <meshStandardMaterial color={COLOR_LINE_DIM} transparent opacity={0.35} />
      </mesh>
      {/* Release sphere — animates during the wind-up so the batter can time it. */}
      <mesh position={[off.x, 6.0 + off.y, off.z]}>
        <sphereGeometry args={[0.35, 24, 24]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
      </mesh>
      {!hideIdentity && (
        <>
          <Text
            position={[0, 9.5, 0]}
            rotation={[0, Math.PI, 0]}
            fontSize={1.4}
            color="#1A1614"
            outlineColor="#F4ECDA"
            outlineWidth={0.08}
            anchorX="center"
            anchorY="middle"
          >
            {name}
          </Text>
          <Text
            position={[0, 8.0, 0]}
            rotation={[0, Math.PI, 0]}
            fontSize={0.9}
            color={color}
            outlineColor="#F4ECDA"
            outlineWidth={0.05}
            anchorX="center"
            anchorY="middle"
          >
            {team.toUpperCase()}
          </Text>
        </>
      )}
    </group>
  )
}

// ── Animated camera + ball ───────────────────────────────────────────────────
export type ViewAngle =
  | 'center'
  | 'right'       // RHB batter (further-back analytical view)
  | 'left'        // LHB batter (further-back analytical view)
  | 'batterR'     // RHB eye-POV, close to plate (game mode)
  | 'batterL'     // LHB eye-POV, close to plate (game mode)
  | 'centerGameR' // Straight-on, slight RHB offset, zoomed out a touch (game mode)
  | 'centerGameL' // Straight-on, slight LHB offset, zoomed out a touch (game mode)

/** Optional callback invoked every frame during the 'fly' phase with the
 *  ball's current screen-pixel position and world-space position. Used by
 *  game mode to detect swing clicks. */
export type BallUpdateCb = (info: {
  screenX: number
  screenY: number
  worldPos: THREE.Vector3
  tt: number
}) => void

interface SceneProps {
  pitch: SelectedPitch
  target: { x: number; y: number } // inches
  angle: ViewAngle
  /** When true, neutralize all color cues (target dot, trail) so the pitch
   *  type can't be deduced from anything but the trajectory itself. */
  testMode?: boolean
  /** When true, freeze the ball at its current position (used after a swing
   *  in game mode so the user can see where their click landed vs. the ball). */
  freeze?: boolean
  /** When true, hide the trail line and the target ring, and hide the strike
   *  zone wireframe until the ball is paused/landed. */
  gameMode?: boolean
  /** When true, start the camera at the end position and skip the catcher→
   *  batter rotation (useful in game mode where every pitch is from batter view). */
  skipRotation?: boolean
  /** Seconds to hold the scene before the ball starts flying. Useful for a
   *  "get ready" pause in game mode. */
  preFlyDelay?: number
  /** Multiplier on flight time. 1 = real time (default). >1 = slow motion,
   *  used by game mode so the ball is humanly trackable on a 2D screen. */
  flightTimeScale?: number
  /** If set during the fly phase, the ball stops following the pitch
   *  trajectory and launches outward along (ev, la, sprayAngle) — used to
   *  show where the hit ball goes after contact in game mode. */
  contactLaunch?: {
    ev: number      // mph
    la: number      // degrees
    sprayAngle: number  // degrees; +=3B (pull for RHB), 0 = up the middle
  } | null
  onPhaseChange?: (phase: Phase) => void
  onBallUpdate?: BallUpdateCb
}

type Phase = 'rotate' | 'wait' | 'fly' | 'post_contact' | 'frozen'

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function SceneContent({
  pitch, target, angle, testMode, freeze, gameMode,
  skipRotation, preFlyDelay = 0, flightTimeScale = 1.0,
  contactLaunch,
  onPhaseChange, onBallUpdate,
}: SceneProps) {
  const { camera } = useThree()
  const ballRef = useRef<THREE.Mesh>(null)
  const phaseRef = useRef<Phase>(skipRotation ? (preFlyDelay > 0 ? 'wait' : 'fly') : 'rotate')
  const startRef = useRef<number>(performance.now())
  const waitStartRef = useRef<number>(performance.now())
  const [trail, setTrail] = useState<[number, number, number][]>([])
  const [hitTrail, setHitTrail] = useState<[number, number, number][]>([])
  const lastSampleRef = useRef<number>(0)
  const [hasLanded, setHasLanded] = useState(false)
  // 0 = at rest, 1 = release. Active only during the last second of the
  // pre-fly wait phase (controlled by useFrame below).
  const [windupProgress, setWindupProgress] = useState(0)
  // Post-contact launch state, set when contactLaunch transitions from
  // null → not-null during the fly or frozen phase.
  const contactStartRef = useRef<number>(0)
  const contactStartPosRef = useRef<THREE.Vector3>(new THREE.Vector3())
  const contactVelRef = useRef<THREE.Vector3>(new THREE.Vector3())
  // One-shot guard: ensures the post_contact transition happens exactly once
  // per pitch, even if contactLaunch is read from both useFrame and useEffect.
  const postContactStartedRef = useRef<boolean>(false)

  // Coordinate note: the camera is at -z looking toward the mound at +z. With
  // three.js's lookAt + default up, the camera's right-vector points to world
  // -x. So world +x renders on SCREEN LEFT and world -x renders on SCREEN
  // RIGHT. We anchor our convention to physical reality:
  //   world +x = 3B side of field (pitcher's right)
  //   world -x = 1B side of field
  //
  // Statcast (catcher-view) → scene conversion:
  //   scene.x = −statcast.x   (Statcast +x = 1B side, our +x = 3B side)
  //   scene.y =  statcast.z   (both +up)
  //   scene.z =  statcast.y   (Statcast +y = toward mound, same as ours)
  // Velocity and acceleration vectors flip with the same rule.

  // Real release point when kinematic data is present; fall back to a
  // hardcoded location for old/sparse data.
  const useKinematics =
    pitch.release_pos_x != null &&
    pitch.release_pos_y != null &&
    pitch.release_pos_z != null &&
    pitch.ax != null &&
    pitch.ay != null &&
    pitch.az != null

  const releasePos = useMemo(() => {
    if (useKinematics) {
      return new THREE.Vector3(
        -(pitch.release_pos_x as number),
        pitch.release_pos_z as number,
        pitch.release_pos_y as number,
      )
    }
    return new THREE.Vector3(
      pitch.pitcher_hand === 'R' ? 1.8 : -1.8,
      6.0,
      RELEASE_Z,
    )
  }, [useKinematics, pitch.release_pos_x, pitch.release_pos_y, pitch.release_pos_z, pitch.pitcher_hand])

  const releaseX = releasePos.x // for PitcherCard placement

  // SVG zone click uses the catcher/broadcast convention: +svg_x = catcher's
  // right = 1B side. Scene +x is 3B side, so we negate to map.
  const targetPos = useMemo(
    () => new THREE.Vector3(-target.x / 12, target.y / 12, 0),
    [target.x, target.y],
  )

  const ROT_DURATION = 1.5
  // Flight time: use effective_speed (perceived velocity) when available;
  // otherwise avg_speed. distance is release → target. flightTimeScale is
  // a slow-motion multiplier used by game mode.
  const flightTime = useMemo(() => {
    const mph = pitch.effective_speed ?? pitch.avg_speed ?? 90
    const distFt = releasePos.distanceTo(targetPos)
    return (distFt / (mph * 1.467)) * flightTimeScale
  }, [pitch.effective_speed, pitch.avg_speed, releasePos, targetPos, flightTimeScale])

  // ── Trajectory model ─────────────────────────────────────────────────────
  // When kinematics present, use the REAL per-pitch-type average acceleration
  // vector (gravity + Magnus baked together) and solve initial velocity so
  // the ball lands at the user's target. No amplification, no break heuristic.
  //
  // When kinematics absent, fall back to: explicit gravity + amplified
  // late-loaded spin drift derived from break_x/break_z.

  // Acceleration vector (scene coords). For kinematics path, this is real.
  // For fallback path, it's just gravity (Magnus comes in via the drift term).
  const aScene = useMemo(() => {
    if (useKinematics) {
      return new THREE.Vector3(
        -(pitch.ax as number),
        pitch.az as number,
        pitch.ay as number,
      )
    }
    return new THREE.Vector3(0, -GRAVITY, 0)
  }, [useKinematics, pitch.ax, pitch.ay, pitch.az])

  // Visual break drift (fallback path only). When kinematics are present,
  // breakScene = (0,0,0) because the acceleration vector already contains Magnus.
  const X_AMP = 2.2
  const Z_AMP_DOWN = 2.5
  const breakScene = useMemo(() => {
    if (useKinematics) return new THREE.Vector3(0, 0, 0)
    const bx_ft = (pitch.break_x ?? 0) / 12
    const bz_ft = (pitch.break_z ?? 0) / 12
    const zAmp = bz_ft < 0 ? Z_AMP_DOWN : 1.0
    return new THREE.Vector3(bx_ft * X_AMP, bz_ft * zAmp, 0)
  }, [useKinematics, pitch.break_x, pitch.break_z])

  // Initial velocity such that release + v·T + ½·a·T² + breakScene = target.
  const initialVel = useMemo(() => {
    const T = flightTime
    const halfATsq = aScene.clone().multiplyScalar(0.5 * T * T)
    return new THREE.Vector3()
      .subVectors(targetPos, releasePos)
      .sub(halfATsq)
      .sub(breakScene)
      .divideScalar(T)
  }, [releasePos, targetPos, flightTime, aScene, breakScene])

  // Camera positions
  const camStart = useMemo(() => new THREE.Vector3(0, 4.8, -9), [])
  const camStartLook = useMemo(() => new THREE.Vector3(0, 2.2, 25), [])
  const camEnd = useMemo(() => {
    // RHB stands on the 3B side of the plate (world +x in our scene).
    // batterR / batterL are tighter eye-POV positions used by game mode —
    // closer to the plate, eye level, narrower frame.
    if (angle === 'batterR') return new THREE.Vector3(3.5, 6.5, -8)
    if (angle === 'batterL') return new THREE.Vector3(-3.5, 6.5, -8)
    if (angle === 'center') return new THREE.Vector3(0, 5.6, -10)
    if (angle === 'right') return new THREE.Vector3(3.5, 5.8, -8)
    if (angle === 'centerGameR') return new THREE.Vector3(0.45, 5.5, -5)
    if (angle === 'centerGameL') return new THREE.Vector3(-0.45, 5.5, -5)
    return new THREE.Vector3(-3.5, 5.8, -8)
  }, [angle])
  const camEndLook = useMemo(() => {
    if (angle === 'batterR' || angle === 'batterL') {
      // Look low + close so the entire strike zone AND the plate sit
      // comfortably in the lower half of the frame.
      return new THREE.Vector3(0, 1.0, 17)
    }
    if (angle === 'centerGameR' || angle === 'centerGameL') {
      // Zoomed straight-on view — aim low enough that the plate sits in the
      // bottom of the frame while the full strike zone is visible above it.
      return new THREE.Vector3(0, 1.0, 16)
    }
    return new THREE.Vector3(0, 2.4, 30)
  }, [angle])

  // Set initial camera pose. When skipping rotation we start at the end
  // position so there's no visible jump. Also reset the wait-phase clock
  // so the pre-fly delay is counted from mount.
  useMemo(() => {
    if (skipRotation) {
      camera.position.copy(camEnd)
      camera.lookAt(camEndLook)
      waitStartRef.current = performance.now()
    } else {
      camera.position.copy(camStart)
      camera.lookAt(camStartLook)
    }
  }, [camera, camStart, camStartLook, camEnd, camEndLook, skipRotation])

  // Shared post-contact transition. Called from both useFrame and useEffect
  // to make sure the animation starts no matter when React commits the
  // contactLaunch prop relative to the fly→frozen frame.
  function beginPostContact() {
    if (postContactStartedRef.current) return
    if (!contactLaunch || !ballRef.current) return
    postContactStartedRef.current = true
    const startPos = ballRef.current.position.clone()
    const evFtS = contactLaunch.ev * 1.467
    const laRad = (contactLaunch.la * Math.PI) / 180
    const sprayRad = (contactLaunch.sprayAngle * Math.PI) / 180
    const horizontal = evFtS * Math.cos(laRad)
    contactVelRef.current.set(
      horizontal * Math.sin(sprayRad),
      evFtS * Math.sin(laRad),
      horizontal * Math.cos(sprayRad),
    )
    contactStartPosRef.current.copy(startPos)
    contactStartRef.current = performance.now()
    phaseRef.current = 'post_contact'
    setHasLanded(false)
    setHitTrail([[startPos.x, startPos.y, startPos.z]])
    onPhaseChange?.('post_contact')
  }

  // If the prop arrives while we're already frozen, kick off post_contact
  // from here (the useFrame path covers the still-flying case).
  useEffect(() => {
    if (!contactLaunch) return
    if (phaseRef.current === 'frozen') {
      beginPostContact()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactLaunch])

  // Freeze pause: when `freeze` is set we record the elapsed time at the moment
  // of freeze and rewind the start clock by that much each frame, holding the
  // animation in place without resetting state.
  const freezeOffsetRef = useRef<number>(0)
  const wasFrozenRef = useRef<boolean>(false)

  useFrame(({ size, gl }) => {
    if (freeze && !wasFrozenRef.current) {
      freezeOffsetRef.current = (performance.now() - startRef.current) / 1000
      wasFrozenRef.current = true
    }
    if (!freeze && wasFrozenRef.current) {
      startRef.current = performance.now() - freezeOffsetRef.current * 1000
      wasFrozenRef.current = false
    }
    if (freeze) return
    const elapsed = (performance.now() - startRef.current) / 1000

    if (phaseRef.current === 'rotate') {
      const t = Math.min(elapsed / ROT_DURATION, 1)
      const e = easeInOutCubic(t)
      camera.position.lerpVectors(camStart, camEnd, e)
      const look = new THREE.Vector3().lerpVectors(camStartLook, camEndLook, e)
      camera.lookAt(look)
      if (t >= 1) {
        if (preFlyDelay > 0) {
          phaseRef.current = 'wait'
          waitStartRef.current = performance.now()
        } else {
          phaseRef.current = 'fly'
          startRef.current = performance.now()
          setTrail([])
          onPhaseChange?.('fly')
        }
      }
    } else if (phaseRef.current === 'wait') {
      const waited = (performance.now() - waitStartRef.current) / 1000
      // Wind-up animates during the last 1 second of the wait phase.
      const windupStart = Math.max(0, preFlyDelay - 1)
      if (waited > windupStart) {
        const progress = Math.min(1, (waited - windupStart) / 1)
        setWindupProgress(progress)
      } else if (windupProgress !== 0) {
        setWindupProgress(0)
      }
      if (waited >= preFlyDelay) {
        phaseRef.current = 'fly'
        startRef.current = performance.now()
        setTrail([])
        setWindupProgress(0)
        onPhaseChange?.('fly')
      }
    } else if (phaseRef.current === 'fly') {
      // Mid-flight contact: take over immediately.
      if (contactLaunch && !postContactStartedRef.current) {
        beginPostContact()
        return
      }
      const tt = Math.min(elapsed / flightTime, 1)
      const t = tt * flightTime // real seconds elapsed in flight
      const driftFactor = tt * tt * tt
      const pos = new THREE.Vector3(
        releasePos.x + initialVel.x * t + 0.5 * aScene.x * t * t + breakScene.x * driftFactor,
        releasePos.y + initialVel.y * t + 0.5 * aScene.y * t * t + breakScene.y * driftFactor,
        releasePos.z + initialVel.z * t + 0.5 * aScene.z * t * t + breakScene.z * driftFactor,
      )
      if (ballRef.current) {
        ballRef.current.position.copy(pos)
        ballRef.current.visible = true
      }
      if (onBallUpdate) {
        const proj = pos.clone().project(camera)
        const screenX = (proj.x * 0.5 + 0.5) * size.width
        const screenY = (1 - (proj.y * 0.5 + 0.5)) * size.height
        onBallUpdate({ screenX, screenY, worldPos: pos.clone(), tt })
      }
      // Pitch trail: skipped in game mode (cleaner visual). Test mode and
      // the analytical pitch-vis still get it.
      if (!gameMode) {
        setTrail((prev) => [...prev, [pos.x, pos.y, pos.z]])
      }
      lastSampleRef.current = performance.now()
      if (tt >= 1) {
        // If a contact has been queued (contactLaunch prop set this frame
        // via React state update) but post_contact hasn't started yet, hold
        // here for one more frame — the next useFrame run will pick up
        // contactLaunch via beginPostContact() and transition out cleanly.
        if (contactLaunch && !postContactStartedRef.current) {
          return
        }
        phaseRef.current = 'frozen'
        if (ballRef.current) ballRef.current.position.copy(targetPos)
        if (!gameMode) {
          setTrail((prev) => [...prev, [targetPos.x, targetPos.y, targetPos.z]])
        }
        setHasLanded(true)
        onPhaseChange?.('frozen')
      }
    } else if (phaseRef.current === 'post_contact') {
      // Ballistic flight from the contact point: gravity-only motion.
      const t = (performance.now() - contactStartRef.current) / 1000
      const sp = contactStartPosRef.current
      const v = contactVelRef.current
      const pos = new THREE.Vector3(
        sp.x + v.x * t,
        sp.y + v.y * t - 0.5 * GRAVITY * t * t,
        sp.z + v.z * t,
      )
      // For grounders + popups, clamp y at ground level and let the ball
      // continue along the surface for visibility (so every hit gets an arc).
      const clampedY = Math.max(pos.y, 0.05)
      const renderPos = new THREE.Vector3(pos.x, clampedY, pos.z)
      if (ballRef.current) {
        ballRef.current.position.copy(renderPos)
      }
      setHitTrail((prev) => [...prev, [renderPos.x, renderPos.y, renderPos.z]])
      // Minimum 1.5 s so even grounders/popups get visible flight; cap at 2.5 s.
      if (t >= 2.5 || (t >= 1.5 && pos.y <= 0)) {
        phaseRef.current = 'frozen'
        setHasLanded(true)
        onPhaseChange?.('frozen')
      }
    }
    void gl // silence unused-arg warning
  })

  // Click-target dot on the strike-zone plane (so the user remembers where they aimed).
  // In test mode we use a neutral color so it doesn't give away the pitch type.
  const dotColor = testMode ? '#E6DDC8' : pitchColor(pitch.pitch_type)
  // Trail color: neutral white in test + game mode (no pitch-type tell);
  // pitch-type color in the analytical pitch-vis.
  const trailColor = (testMode || gameMode) ? '#FFFFFF' : pitchColor(pitch.pitch_type)

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[20, 30, 20]} intensity={0.9} castShadow />
      <hemisphereLight args={['#ffffff', '#3a4a3a', 0.4]} />

      <Ground />
      <Diamond />
      <OutfieldWall />
      <BatterBoxes />
      <Plate />
      {/* In game mode, hide the strike zone until the ball lands so the
          player doesn't get an aim cue. */}
      {(!gameMode || hasLanded) && <StrikeZone />}
      <Mound />
      <PitcherCard
        x={releaseX}
        name={pitch.pitcher_name}
        team={pitch.team}
        hideIdentity={testMode}
        windupProgress={windupProgress}
      />

      {/* Target dot on the strike-zone plane — hidden in game mode */}
      {!gameMode && (
        <mesh position={[targetPos.x, targetPos.y, 0]}>
          <ringGeometry args={[0.08, 0.13, 32]} />
          <meshBasicMaterial color={dotColor} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Ball (hidden until fly phase) */}
      <mesh ref={ballRef} visible={false}>
        <sphereGeometry args={[0.12, 24, 24]} />
        <meshStandardMaterial color="#FFFFFF" emissive="#FFE38A" emissiveIntensity={0.25} />
      </mesh>

      {/* Persistent pitch trail (suppressed in game mode) */}
      {trail.length > 1 && (
        <Line points={trail} color={trailColor} lineWidth={3} transparent opacity={0.95} />
      )}
      {/* Post-contact "hit ball" trail — orange, always shown when present */}
      {hitTrail.length > 1 && (
        <Line points={hitTrail} color="#F57C00" lineWidth={3} transparent opacity={0.95} />
      )}

    </>
  )
}

export default function PitchAnimation3D({
  pitch,
  target,
  angle,
  testMode,
  freeze,
  gameMode,
  skipRotation,
  preFlyDelay,
  flightTimeScale,
  contactLaunch,
  onPhaseChange,
  onBallUpdate,
}: {
  pitch: SelectedPitch
  target: { x: number; y: number }
  angle: ViewAngle
  testMode?: boolean
  freeze?: boolean
  gameMode?: boolean
  skipRotation?: boolean
  preFlyDelay?: number
  flightTimeScale?: number
  contactLaunch?: { ev: number; la: number; sprayAngle: number } | null
  onPhaseChange?: (phase: Phase) => void
  onBallUpdate?: BallUpdateCb
}) {
  return (
    <Canvas
      camera={{ fov: 58, near: 0.1, far: 500 }}
      // Dark slate sky at the top (so the white ball stands out against it)
      // fading through neutral grey to the ground-beige at the horizon.
      style={{ background: 'linear-gradient(to bottom, #1F2A35 0%, #3B4651 35%, #6E665A 70%, #928470 100%)' }}
    >
      <SceneContent
        pitch={pitch}
        target={target}
        angle={angle}
        testMode={testMode}
        freeze={freeze}
        gameMode={gameMode}
        skipRotation={skipRotation}
        preFlyDelay={preFlyDelay}
        flightTimeScale={flightTimeScale}
        contactLaunch={contactLaunch}
        onPhaseChange={onPhaseChange}
        onBallUpdate={onBallUpdate}
      />
    </Canvas>
  )
}
