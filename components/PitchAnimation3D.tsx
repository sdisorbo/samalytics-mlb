'use client'

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Line, Text } from '@react-three/drei'
import { useMemo, useRef, useState } from 'react'
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
const COLOR_MOUND = '#A89980'     // slightly lighter beige
const COLOR_PITCHER = '#5B5650'   // mid-grey silhouette
const COLOR_RUBBER = '#E6DDC8'

function Mound() {
  return (
    <group position={[0, 0.01, RUBBER_Z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[9, 32]} />
        <meshStandardMaterial color={COLOR_MOUND} flatShading />
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
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 30]}>
      <planeGeometry args={[160, 160]} />
      <meshStandardMaterial color={COLOR_GROUND} flatShading />
    </mesh>
  )
}

function PitcherFigure({ x, hand }: { x: number; hand: 'R' | 'L' }) {
  // Single-color silhouette — minimalistic, no detail competing with the ball.
  return (
    <group position={[x, 0, RUBBER_Z + 0.2]}>
      {/* Body */}
      <mesh position={[0, 2.5, 0]}>
        <cylinderGeometry args={[0.5, 0.6, 5, 12]} />
        <meshStandardMaterial color={COLOR_PITCHER} flatShading />
      </mesh>
      {/* Head */}
      <mesh position={[0, 5.5, 0]}>
        <sphereGeometry args={[0.45, 16, 16]} />
        <meshStandardMaterial color={COLOR_PITCHER} flatShading />
      </mesh>
      {/* Throwing arm raised */}
      <mesh
        position={[hand === 'R' ? -0.7 : 0.7, 5.2, 0]}
        rotation={[0, 0, hand === 'R' ? -0.6 : 0.6]}
      >
        <cylinderGeometry args={[0.15, 0.15, 1.8, 8]} />
        <meshStandardMaterial color={COLOR_PITCHER} flatShading />
      </mesh>
    </group>
  )
}

// ── Animated camera + ball ───────────────────────────────────────────────────
export type ViewAngle = 'center' | 'right' | 'left'

interface SceneProps {
  pitch: SelectedPitch
  target: { x: number; y: number } // inches
  angle: ViewAngle
  /** When true, neutralize all color cues (target dot, trail) so the pitch
   *  type can't be deduced from anything but the trajectory itself. */
  testMode?: boolean
  /** Hide the velo label (used during reveal sequencing in test mode). */
  hideVelo?: boolean
  onPhaseChange?: (phase: Phase) => void
}

type Phase = 'rotate' | 'fly' | 'frozen'

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function SceneContent({ pitch, target, angle, testMode, hideVelo, onPhaseChange }: SceneProps) {
  const { camera } = useThree()
  const ballRef = useRef<THREE.Mesh>(null)
  const phaseRef = useRef<Phase>('rotate')
  const startRef = useRef<number>(performance.now())
  const [trail, setTrail] = useState<[number, number, number][]>([])
  const lastSampleRef = useRef<number>(0)

  // Coordinate note: the camera is at -z looking toward the mound at +z. With
  // three.js's lookAt + default up, the camera's right-vector points to world
  // -x. So world +x renders on SCREEN LEFT and world -x renders on SCREEN
  // RIGHT. We anchor our convention to physical reality:
  //   world +x = 3B side of field (pitcher's right)
  //   world -x = 1B side of field
  // RHP releases from his right hand (3B side, +x); LHP from his left (1B, -x).
  const releaseX = pitch.pitcher_hand === 'R' ? 1.8 : -1.8
  const releaseY = 6.0
  const releasePos = useMemo(
    () => new THREE.Vector3(releaseX, releaseY, RELEASE_Z),
    [releaseX, releaseY],
  )

  // SVG zone click uses the catcher/broadcast convention: +svg_x = catcher's
  // right = 1B side. Scene +x is 3B side, so we negate to map.
  const targetPos = useMemo(
    () => new THREE.Vector3(-target.x / 12, target.y / 12, 0),
    [target.x, target.y],
  )

  const ROT_DURATION = 1.5
  // Real-time flight: ball traverses scene at TRUE mph (in scene feet/sec).
  // Distance = release → target straight line ≈ 55 ft.
  const flightTime = useMemo(() => {
    const mph = pitch.avg_speed ?? 90
    const distFt = releasePos.distanceTo(targetPos)
    return distFt / (mph * 1.467) // mph → ft/s
  }, [pitch.avg_speed, releasePos, targetPos])

  // Break vector in scene coords. break_x_data is in pitcher's view where
  // +x = pitcher's right = 3B side, which matches our scene +x directly — so
  // NO sign flip is needed here. break_z is induced vertical break (IVB):
  //   IVB > 0 = ball drops LESS than a spinless pitch (4-seam ride)
  //   IVB < 0 = ball drops MORE than a spinless pitch (curveball)
  //
  // Selective visual amplification: real IVB values are only a few inches on a
  // ~3-ft gravity drop, so breaking pitches read as subtle from the camera.
  // We amplify horizontal break and *downward* IVB so curveballs and sweepers
  // pop. Upward IVB (fastball ride) stays at 1× — over-amplifying it makes a
  // fastball look unnatural.
  const X_AMP = 2.2
  const Z_AMP_DOWN = 2.5
  const breakScene = useMemo(() => {
    const bx_ft = (pitch.break_x ?? 0) / 12
    const bz_ft = (pitch.break_z ?? 0) / 12
    const zAmp = bz_ft < 0 ? Z_AMP_DOWN : 1.0
    return new THREE.Vector3(bx_ft * X_AMP, bz_ft * zAmp, 0)
  }, [pitch.break_x, pitch.break_z])

  // Initial velocity such that the actual ball (gravity + break drift) lands
  // exactly at the user's target. Pitcher aims to compensate for both:
  //   release + v·T − 0.5·g·T²·ŷ + breakScene = target
  //   → v = (target − release + 0.5·g·T²·ŷ − breakScene) / T
  const initialVel = useMemo(() => {
    const T = flightTime
    const dx = targetPos.x - releasePos.x
    const dy = targetPos.y - releasePos.y
    const dz = targetPos.z - releasePos.z
    return new THREE.Vector3(
      (dx - breakScene.x) / T,
      (dy + 0.5 * GRAVITY * T * T - breakScene.y) / T,
      (dz - breakScene.z) / T,
    )
  }, [releasePos, targetPos, flightTime, breakScene])

  // Camera positions
  const camStart = useMemo(() => new THREE.Vector3(0, 4.8, -9), [])
  const camStartLook = useMemo(() => new THREE.Vector3(0, 2.2, 25), [])
  const camEnd = useMemo(() => {
    // RHB stands on the 3B side of the plate (world +x in our scene).
    if (angle === 'center') return new THREE.Vector3(0, 5.6, -10)
    if (angle === 'right') return new THREE.Vector3(3.5, 5.8, -8)
    return new THREE.Vector3(-3.5, 5.8, -8)
  }, [angle])
  const camEndLook = useMemo(() => new THREE.Vector3(0, 2.4, 30), [])

  // Set initial camera pose
  useMemo(() => {
    camera.position.copy(camStart)
    camera.lookAt(camStartLook)
  }, [camera, camStart, camStartLook])

  useFrame(() => {
    const elapsed = (performance.now() - startRef.current) / 1000

    if (phaseRef.current === 'rotate') {
      const t = Math.min(elapsed / ROT_DURATION, 1)
      const e = easeInOutCubic(t)
      camera.position.lerpVectors(camStart, camEnd, e)
      const look = new THREE.Vector3().lerpVectors(camStartLook, camEndLook, e)
      camera.lookAt(look)
      if (t >= 1) {
        phaseRef.current = 'fly'
        startRef.current = performance.now()
        setTrail([])
        onPhaseChange?.('fly')
      }
    } else if (phaseRef.current === 'fly') {
      const tt = Math.min(elapsed / flightTime, 1)
      const t = tt * flightTime // real seconds elapsed in flight
      // Physics trajectory: kinematic motion under gravity plus a break drift
      // that accumulates cubically over flight (most of the break happens in
      // the last third — that's the "snap" of a curveball, sweeper, etc.).
      // Returns exactly to `targetPos` at t = flightTime.
      const driftFactor = tt * tt * tt
      const pos = new THREE.Vector3(
        releasePos.x + initialVel.x * t + breakScene.x * driftFactor,
        releasePos.y + initialVel.y * t - 0.5 * GRAVITY * t * t + breakScene.y * driftFactor,
        releasePos.z + initialVel.z * t + breakScene.z * driftFactor,
      )
      if (ballRef.current) {
        ballRef.current.position.copy(pos)
        ballRef.current.visible = true
      }
      // Sample trail every frame — pitches are fast (real mph), so the trail
      // needs dense samples to render as a smooth line.
      setTrail((prev) => [...prev, [pos.x, pos.y, pos.z]])
      lastSampleRef.current = performance.now()
      if (tt >= 1) {
        phaseRef.current = 'frozen'
        // Snap ball to exact target so any floating-point drift is invisible.
        if (ballRef.current) ballRef.current.position.copy(targetPos)
        setTrail((prev) => [...prev, [targetPos.x, targetPos.y, targetPos.z]])
        onPhaseChange?.('frozen')
      }
    }
    // frozen: do nothing, scene stays.
  })

  // Click-target dot on the strike-zone plane (so the user remembers where they aimed).
  // In test mode we use a neutral color so it doesn't give away the pitch type.
  const dotColor = testMode ? '#E6DDC8' : pitchColor(pitch.pitch_type)
  const trailColor = testMode ? '#FFFFFF' : pitchColor(pitch.pitch_type)

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[20, 30, 20]} intensity={0.9} castShadow />
      <hemisphereLight args={['#ffffff', '#3a4a3a', 0.4]} />

      <Ground />
      <Plate />
      <StrikeZone />
      <Mound />
      <PitcherFigure x={releaseX} hand={pitch.pitcher_hand} />

      {/* Target dot on the strike-zone plane */}
      <mesh position={[targetPos.x, targetPos.y, 0]}>
        <ringGeometry args={[0.08, 0.13, 32]} />
        <meshBasicMaterial color={dotColor} side={THREE.DoubleSide} />
      </mesh>

      {/* Ball (hidden until fly phase) */}
      <mesh ref={ballRef} visible={false}>
        <sphereGeometry args={[0.12, 24, 24]} />
        <meshStandardMaterial color="#FFFFFF" emissive="#FFE38A" emissiveIntensity={0.25} />
      </mesh>

      {/* Persistent trail */}
      {trail.length > 1 && (
        <Line points={trail} color={trailColor} lineWidth={3} transparent opacity={0.95} />
      )}

      {/* Floating velo label near release once we're in batter view */}
      {pitch.avg_speed && !hideVelo && (
        <Text
          position={[releaseX, releaseY + 1.2, RELEASE_Z]}
          fontSize={0.45}
          color="#FFFFFF"
          outlineColor="#000"
          outlineWidth={0.02}
          anchorX="center"
          anchorY="middle"
        >
          {`${pitch.avg_speed.toFixed(0)} mph`}
        </Text>
      )}
    </>
  )
}

export default function PitchAnimation3D({
  pitch,
  target,
  angle,
  testMode,
  hideVelo,
  onPhaseChange,
}: {
  pitch: SelectedPitch
  target: { x: number; y: number }
  angle: ViewAngle
  testMode?: boolean
  hideVelo?: boolean
  onPhaseChange?: (phase: Phase) => void
}) {
  return (
    <Canvas
      camera={{ fov: 58, near: 0.1, far: 500 }}
      // Duo-tone sky: pale beige fading to ground beige.
      style={{ background: 'linear-gradient(to bottom, #DCD0BC 0%, #C2B49C 60%, #A89980 100%)' }}
    >
      <SceneContent
        pitch={pitch}
        target={target}
        angle={angle}
        testMode={testMode}
        hideVelo={hideVelo}
        onPhaseChange={onPhaseChange}
      />
    </Canvas>
  )
}
