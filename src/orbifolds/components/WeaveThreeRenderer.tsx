/**
 * 3D renderer for orbifold weave lifted graphs using Three.js.
 *
 * Renders:
 * - Tubes for each solid-styled lifted edge
 *   - Same-level edges are straight
 *   - Cross-level edges curve to the "left when looking from above
 *     along low→high" (so that lowA→highB and lowB→highA bow in
 *     opposite directions and don't intersect)
 * - Spheres for lifted nodes that touch at least one solid edge
 *
 * Shading: custom view-dependent shader where brightness = dot(normal, viewDir).
 * Full base color when normal points at the camera, pitch black at 90°.
 *
 * Color: by connected component in the lifted graph (solid edges only).
 *
 * The (x, y) position comes from the lifted node's 2D coordinates
 * (voltage applied to orbifold node coords). The z position comes
 * from the level of the lifted node (inherited from the orbifold
 * node's @0 or @1 suffix): level 0 → z=0, level 1 → z=1.
 */

import { useEffect, useRef, useMemo } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type {
  LiftedGraph,
  OrbifoldGrid,
  Matrix3x3,
} from "../orbifoldbasics";
import { applyMatrix, axialToCartesian } from "../orbifoldbasics";
import type { ColorData, EdgeStyleData } from "../createOrbifolds";
import { getLevelFromNodeId, getBaseNodeId } from "../doubleOrbifold";

// Tube and node radius are the same
const EDGE_RADIUS = 0.25;
const TUBE_SEGMENTS_STRAIGHT = 8;
const TUBE_SEGMENTS_CURVED = 24;
const RADIAL_SEGMENTS = 10;

// Curve bow magnitude as a fraction of edge length
const CROSS_LEVEL_BOW = 0.35;

// Distinct component colors (saturated, visually distinct palette)
const COMPONENT_COLORS = [
  0xe6194b, // red
  0x3cb44b, // green
  0x4363d8, // blue
  0xf58231, // orange
  0x911eb4, // purple
  0x42d4f4, // cyan
  0xf032e6, // magenta
  0xbfef45, // lime
  0xfabed4, // pink
  0xdcbeff, // lavender
  0xfffac8, // beige
  0x800000, // maroon
  0xaaffc3, // mint
  0x808000, // olive
  0x000075, // navy
  0xa9a9a9, // grey
];

// Custom vertex shader: pass normal and position to fragment
const vertexShader = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

// Custom fragment shader: black at ndv=0, full color at ndv≈0.5, white at ndv=1
const fragmentShader = `
  uniform vec3 uColor;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vec3 viewDir = normalize(vViewPosition);
    float ndv = max(dot(normalize(vNormal), viewDir), 0.0);
    // Remap: 0→black, 0.5→full color, 1→white
    vec3 col;
    if (ndv < 0.5) {
      col = uColor * (ndv * 2.0);          // black → color
    } else {
      col = mix(uColor, vec3(1.0), (ndv - 0.5) * 2.0); // color → white
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

// Highlight fragment shader: semi-transparent gold with hypersaturation
const highlightFragmentShader = `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vec3 viewDir = normalize(vViewPosition);
    float ndv = max(dot(normalize(vNormal), viewDir), 0.0);
    vec3 col;
    if (ndv < 0.5) {
      col = uColor * (ndv * 2.0);
    } else {
      col = mix(uColor, vec3(1.0), (ndv - 0.5) * 2.0);
    }
    gl_FragColor = vec4(col, uOpacity);
  }
`;

interface WeaveThreeRendererProps {
  liftedGraph: LiftedGraph<ColorData, EdgeStyleData>;
  orbifoldGrid: OrbifoldGrid<ColorData, EdgeStyleData>;
  useAxialTransform?: boolean;
  width?: number;
  height?: number;
  levelSpacing?: number;
  tubeRadius?: number;
  highlightedOrbifoldNodeId?: string | null;
}

/** Create a ShaderMaterial with the custom normal·viewDir shading. */
function createNdvMaterial(color: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uColor: { value: color } },
  });
}

/**
 * Get 3D position of a lifted node.
 * x, y come from voltage applied to base 2D coords.
 * z comes from the level (0 or 1).
 */
function getNodePosition(
  orbifoldGrid: OrbifoldGrid<ColorData, EdgeStyleData>,
  orbifoldNodeId: string,
  voltage: Matrix3x3,
  useAxialTransform: boolean,
  levelSpacing: number,
): THREE.Vector3 {
  // The orbifold node ID in the doubled grid has @0 or @1 suffix
  const level = getLevelFromNodeId(orbifoldNodeId) ?? 0;
  const baseId = getBaseNodeId(orbifoldNodeId);

  const baseNode = orbifoldGrid.nodes.get(orbifoldNodeId) ?? orbifoldGrid.nodes.get(baseId);
  if (!baseNode) {
    return new THREE.Vector3(0, 0, level * levelSpacing);
  }

  const [ox, oy] = baseNode.coord;
  const transformed = applyMatrix(voltage, ox, oy);

  let x: number, y: number;
  if (useAxialTransform) {
    const cart = axialToCartesian(transformed.x, transformed.y);
    x = cart.x;
    y = cart.y;
  } else {
    x = transformed.x;
    y = transformed.y;
  }

  return new THREE.Vector3(x, level * levelSpacing, -y);
}

/**
 * Compute connected components from solid edges using Union-Find.
 * Returns a map from lifted node ID → component index (0-based).
 */
function computeConnectedComponents(
  solidEdges: Array<{ aId: string; bId: string }>,
  activeNodeIds: string[],
): Map<string, number> {
  const parent = new Map<string, string>();
  const rank = new Map<string, number>();

  function find(x: string): string {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    // Path compression
    let cur = x;
    while (cur !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  function union(a: string, b: string): void {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    const rankA = rank.get(ra) ?? 0;
    const rankB = rank.get(rb) ?? 0;
    if (rankA < rankB) { parent.set(ra, rb); }
    else if (rankA > rankB) { parent.set(rb, ra); }
    else { parent.set(rb, ra); rank.set(ra, rankA + 1); }
  }

  for (const id of activeNodeIds) {
    parent.set(id, id);
    rank.set(id, 0);
  }

  for (const edge of solidEdges) {
    union(edge.aId, edge.bId);
  }

  // Map roots to sequential indices
  const rootToIdx = new Map<string, number>();
  const result = new Map<string, number>();
  let nextIdx = 0;

  for (const id of activeNodeIds) {
    const root = find(id);
    if (!rootToIdx.has(root)) {
      rootToIdx.set(root, nextIdx++);
    }
    result.set(id, rootToIdx.get(root)!);
  }

  return result;
}

export function WeaveThreeRenderer({
  liftedGraph,
  orbifoldGrid,
  useAxialTransform = false,
  width = 700,
  height = 500,
  levelSpacing = 3,
  tubeRadius = EDGE_RADIUS,
  highlightedOrbifoldNodeId = null,
}: WeaveThreeRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animFrameRef = useRef<number>(0);
  const highlightMeshesRef = useRef<THREE.Mesh[]>([]);

  // Compute solid edges and active nodes
  const { solidEdges, activeNodes } = useMemo(() => {
    const solidEdges: Array<{
      aId: string;
      bId: string;
      aOrbNode: string;
      bOrbNode: string;
      aVoltage: Matrix3x3;
      bVoltage: Matrix3x3;
      aLevel: number;
      bLevel: number;
    }> = [];
    const activeNodeIds = new Set<string>();

    for (const edge of liftedGraph.edges.values()) {
      // Check if the corresponding orbifold edge is solid
      const orbEdgeId = edge.orbifoldEdgeId;
      if (!orbEdgeId) continue;

      const orbEdge = orbifoldGrid.edges.get(orbEdgeId);
      const linestyle = orbEdge?.data?.linestyle ?? "solid";
      if (linestyle !== "solid") continue;

      const nodeA = liftedGraph.nodes.get(edge.a);
      const nodeB = liftedGraph.nodes.get(edge.b);
      if (!nodeA || !nodeB) continue;

      solidEdges.push({
        aId: edge.a,
        bId: edge.b,
        aOrbNode: nodeA.orbifoldNode,
        bOrbNode: nodeB.orbifoldNode,
        aVoltage: nodeA.voltage,
        bVoltage: nodeB.voltage,
        aLevel: getLevelFromNodeId(nodeA.orbifoldNode) ?? 0,
        bLevel: getLevelFromNodeId(nodeB.orbifoldNode) ?? 0,
      });
      activeNodeIds.add(edge.a);
      activeNodeIds.add(edge.b);
    }

    const activeNodes: Array<{
      id: string;
      orbifoldNode: string;
      voltage: Matrix3x3;
      level: number;
    }> = [];

    for (const nodeId of activeNodeIds) {
      const node = liftedGraph.nodes.get(nodeId);
      if (node) {
        activeNodes.push({
          id: node.id,
          orbifoldNode: node.orbifoldNode,
          voltage: node.voltage,
          level: getLevelFromNodeId(node.orbifoldNode) ?? 0,
        });
      }
    }

    return { solidEdges, activeNodes };
  }, [liftedGraph, orbifoldGrid]);

  // Compute connected components and per-component colors
  const { nodeComponent, componentColors } = useMemo(() => {
    const nodeIds = activeNodes.map(n => n.id);
    const nodeComponent = computeConnectedComponents(solidEdges, nodeIds);

    // Find number of components
    const maxComp = nodeIds.reduce((mx, id) => Math.max(mx, nodeComponent.get(id) ?? 0), -1);
    const numComponents = maxComp + 1;

    // Assign colors from palette
    const componentColors: THREE.Color[] = [];
    for (let i = 0; i < numComponents; i++) {
      componentColors.push(new THREE.Color(COMPONENT_COLORS[i % COMPONENT_COLORS.length]));
    }

    return { nodeComponent, componentColors };
  }, [solidEdges, activeNodes]);

  // Setup Three.js scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Create scene — no lights, shading is purely view-dependent
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    sceneRef.current = scene;

    // Create camera
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    cameraRef.current = camera;

    // Create renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Orbit controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    // Animation loop
    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
    };
  }, [width, height]);

  // Update scene content when data changes
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;

    // Clear existing meshes
    const toRemove: THREE.Object3D[] = [];
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
        toRemove.push(obj);
      }
    });
    for (const obj of toRemove) {
      scene.remove(obj);
      if ((obj as THREE.Mesh).geometry) (obj as THREE.Mesh).geometry.dispose();
      if ((obj as THREE.Mesh).material) {
        const mat = (obj as THREE.Mesh).material;
        if (Array.isArray(mat)) mat.forEach(m => m.dispose());
        else (mat as THREE.Material).dispose();
      }
    }

    if (solidEdges.length === 0 && activeNodes.length === 0) {
      // Nothing to render – position camera at default
      camera.position.set(0, 10, 15);
      controls.target.set(0, 0, 0);
      controls.update();
      return;
    }

    // Create per-component materials
    const componentMaterials: THREE.ShaderMaterial[] = componentColors.map(c => createNdvMaterial(c));

    const sphereGeometry = new THREE.SphereGeometry(tubeRadius, 16, 12);

    // Compute bounding box for camera positioning
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    // Up vector used to compute "right" offset for cross-level curves
    const up = new THREE.Vector3(0, 1, 0);

    // Render tubes for solid edges — color by component of endpoint A
    for (const edge of solidEdges) {
      const posA = getNodePosition(orbifoldGrid, edge.aOrbNode, edge.aVoltage, useAxialTransform, levelSpacing);
      const posB = getNodePosition(orbifoldGrid, edge.bOrbNode, edge.bVoltage, useAxialTransform, levelSpacing);

      // Update bounds
      for (const p of [posA, posB]) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }

      // Both endpoints are in the same component (by definition of connected component)
      const compIdx = nodeComponent.get(edge.aId) ?? 0;
      const material = componentMaterials[compIdx % componentMaterials.length];

      const isCrossLevel = edge.aLevel !== edge.bLevel;

      if (isCrossLevel) {
        const posLow  = edge.aLevel < edge.bLevel ? posA : posB;
        const posHigh = edge.aLevel < edge.bLevel ? posB : posA;

        const dir = new THREE.Vector3().subVectors(posHigh, posLow);
        const edgeLen = dir.length();

        const horiz = new THREE.Vector3(dir.x, 0, dir.z);
        const bowDir = new THREE.Vector3().crossVectors(up, horiz).normalize();
        if (bowDir.lengthSq() < 1e-6) bowDir.set(1, 0, 0);

        const mid = new THREE.Vector3().addVectors(posA, posB).multiplyScalar(0.5);
        mid.addScaledVector(bowDir, edgeLen * CROSS_LEVEL_BOW);

        const curve = new THREE.QuadraticBezierCurve3(posA, mid, posB);
        const tubeGeometry = new THREE.TubeGeometry(curve, TUBE_SEGMENTS_CURVED, tubeRadius, RADIAL_SEGMENTS, false);
        const tubeMesh = new THREE.Mesh(tubeGeometry, material);
        scene.add(tubeMesh);
      } else {
        const path = new THREE.LineCurve3(posA, posB);
        const tubeGeometry = new THREE.TubeGeometry(path, TUBE_SEGMENTS_STRAIGHT, tubeRadius, RADIAL_SEGMENTS, false);
        const tubeMesh = new THREE.Mesh(tubeGeometry, material);
        scene.add(tubeMesh);
      }
    }

    // Render spheres for active nodes
    for (const node of activeNodes) {
      const pos = getNodePosition(orbifoldGrid, node.orbifoldNode, node.voltage, useAxialTransform, levelSpacing);

      // Update bounds
      minX = Math.min(minX, pos.x); maxX = Math.max(maxX, pos.x);
      minY = Math.min(minY, pos.y); maxY = Math.max(maxY, pos.y);
      minZ = Math.min(minZ, pos.z); maxZ = Math.max(maxZ, pos.z);

      const compIdx = nodeComponent.get(node.id) ?? 0;
      const sphereMesh = new THREE.Mesh(
        sphereGeometry,
        componentMaterials[compIdx % componentMaterials.length],
      );
      sphereMesh.position.copy(pos);
      scene.add(sphereMesh);
    }

    // Position camera to see all content
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const rangeX = maxX - minX;
    const rangeY = maxY - minY;
    const rangeZ = maxZ - minZ;
    const maxRange = Math.max(rangeX, rangeY, rangeZ, 1);

    controls.target.set(centerX, centerY, centerZ);
    camera.position.set(
      centerX + maxRange * 0.8,
      centerY + maxRange * 0.8,
      centerZ + maxRange * 1.2,
    );
    controls.update();
  }, [solidEdges, activeNodes, orbifoldGrid, useAxialTransform, levelSpacing, tubeRadius, nodeComponent, componentColors]);

  // Update highlight meshes when highlighted node changes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove old highlight meshes
    for (const mesh of highlightMeshesRef.current) {
      scene.remove(mesh);
      mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else (mat as THREE.Material).dispose();
    }
    highlightMeshesRef.current = [];

    if (!highlightedOrbifoldNodeId) return;

    const highlightMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: highlightFragmentShader,
      uniforms: {
        uColor: { value: new THREE.Color(0xffd700) },
        uOpacity: { value: 0.7 },
      },
      transparent: true,
    });
    const highlightGeometry = new THREE.SphereGeometry(tubeRadius * 2.2, 20, 14);

    // Find all lifted nodes whose orbifold node matches
    for (const node of activeNodes) {
      if (node.orbifoldNode !== highlightedOrbifoldNodeId) continue;

      const pos = getNodePosition(orbifoldGrid, node.orbifoldNode, node.voltage, useAxialTransform, levelSpacing);
      const mesh = new THREE.Mesh(highlightGeometry, highlightMaterial);
      mesh.position.copy(pos);
      scene.add(mesh);
      highlightMeshesRef.current.push(mesh);
    }
  }, [highlightedOrbifoldNodeId, activeNodes, orbifoldGrid, useAxialTransform, levelSpacing, tubeRadius]);

  return (
    <div
      ref={containerRef}
      style={{
        width,
        height,
        border: "1px solid #ccc",
        borderRadius: "8px",
        overflow: "hidden",
      }}
    />
  );
}
