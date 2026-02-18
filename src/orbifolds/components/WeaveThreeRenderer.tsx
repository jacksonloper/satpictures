/**
 * 3D renderer for orbifold weave lifted graphs using Three.js.
 *
 * Renders:
 * - Tubes for each solid-styled lifted edge: straight for same-level edges,
 *   bowed (quadratic Bézier) for cross-level edges to prevent intersection
 * - Spheres for lifted nodes that touch at least one solid edge
 *
 * Shading: custom view-dependent shader where brightness = dot(normal, viewDir).
 * Black at perpendicular, full color at intermediate, white at aligned.
 *
 * Color: by connected component in the lifted graph (solid edges only).
 *
 * The (x, y) position comes from the lifted node's 2D coordinates
 * (voltage applied to orbifold node coords). The z position comes
 * from the level of the lifted node (inherited from the orbifold
 * node's @0 or @1 suffix): level 0 → z=0, level 1 → z=levelSpacing.
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
const RADIAL_SEGMENTS = 10;

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
  beadSpeed?: number;
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
  beadSpeed = 1.0,
}: WeaveThreeRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animFrameRef = useRef<number>(0);
  const highlightMeshesRef = useRef<THREE.Mesh[]>([]);
  const beadMeshesRef = useRef<THREE.Mesh[]>([]);
  const beadDataRef = useRef<Array<{
    mesh: THREE.Mesh;
    path: THREE.Curve<THREE.Vector3>;
    startStep: number;
    edgeIndex: number;
    totalEdges: number;
    beadForward: boolean;
  }>>([]);

  // Compute solid edges and active nodes
  const { solidEdges, activeNodes, maxLoopStep } = useMemo(() => {
    const solidEdges: Array<{
      aId: string;
      bId: string;
      aOrbNode: string;
      bOrbNode: string;
      aVoltage: Matrix3x3;
      bVoltage: Matrix3x3;
      aLevel: number;
      bLevel: number;
      orbifoldEdgeId: string;
    }> = [];
    const activeNodeIds = new Set<string>();
    let maxStep = -1;

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

      // Track max loop step from orbifold edge loopSteps
      const loopSteps = orbEdge?.data?.loopSteps ?? [];
      for (const ls of loopSteps) {
        if (ls.startStep > maxStep) maxStep = ls.startStep;
      }

      solidEdges.push({
        aId: edge.a,
        bId: edge.b,
        aOrbNode: nodeA.orbifoldNode,
        bOrbNode: nodeB.orbifoldNode,
        aVoltage: nodeA.voltage,
        bVoltage: nodeB.voltage,
        aLevel: getLevelFromNodeId(nodeA.orbifoldNode) ?? 0,
        bLevel: getLevelFromNodeId(nodeB.orbifoldNode) ?? 0,
        orbifoldEdgeId: orbEdgeId,
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

    return { solidEdges, activeNodes, maxLoopStep: maxStep };
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
    beadMeshesRef.current = [];
    beadDataRef.current = [];

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

    const BOW_AMOUNT = 0.8; // how far cross-level edges bow outward

    // Bead material (bright white emissive)
    const beadMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const beadGeometry = new THREE.SphereGeometry(tubeRadius * 1.8, 12, 8);

    // --- Step 1: Compute edge waypoints and build adjacency ---
    interface EdgeWaypoints {
      aId: string;
      bId: string;
      /** Points from A to B (includes waypoint for cross-level) */
      points: THREE.Vector3[];
      orbifoldEdgeId: string;
      aOrbNode: string;
      bOrbNode: string;
    }

    const edgeWaypoints: EdgeWaypoints[] = [];
    // adjacency: nodeId → list of { edgeIdx, otherNodeId }
    const adjacency = new Map<string, Array<{ edgeIdx: number; otherNodeId: string }>>();

    for (let ei = 0; ei < solidEdges.length; ei++) {
      const edge = solidEdges[ei];
      const posA = getNodePosition(orbifoldGrid, edge.aOrbNode, edge.aVoltage, useAxialTransform, levelSpacing);
      const posB = getNodePosition(orbifoldGrid, edge.bOrbNode, edge.bVoltage, useAxialTransform, levelSpacing);

      for (const p of [posA, posB]) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }

      const isCrossLevel = edge.aLevel !== edge.bLevel;
      let points: THREE.Vector3[];

      if (isCrossLevel) {
        const lowPos = edge.aLevel < edge.bLevel ? posA : posB;
        const highPos = edge.aLevel < edge.bLevel ? posB : posA;

        const horizDir = new THREE.Vector3(
          highPos.x - lowPos.x, 0, highPos.z - lowPos.z,
        );
        const horizLen = horizDir.length();
        const up = new THREE.Vector3(0, 1, 0);
        let bowOffset: THREE.Vector3;

        if (horizLen > 1e-6) {
          bowOffset = new THREE.Vector3().crossVectors(up, horizDir.normalize()).multiplyScalar(BOW_AMOUNT);
        } else {
          bowOffset = new THREE.Vector3(BOW_AMOUNT, 0, 0);
        }

        const waypoint = new THREE.Vector3().addVectors(lowPos, highPos).multiplyScalar(0.5);
        waypoint.add(bowOffset);
        // Points go A → waypoint → B
        points = [posA.clone(), waypoint, posB.clone()];
      } else {
        points = [posA.clone(), posB.clone()];
      }

      edgeWaypoints.push({
        aId: edge.aId,
        bId: edge.bId,
        points,
        orbifoldEdgeId: edge.orbifoldEdgeId,
        aOrbNode: edge.aOrbNode,
        bOrbNode: edge.bOrbNode,
      });

      // Build adjacency
      if (!adjacency.has(edge.aId)) adjacency.set(edge.aId, []);
      if (!adjacency.has(edge.bId)) adjacency.set(edge.bId, []);
      adjacency.get(edge.aId)!.push({ edgeIdx: ei, otherNodeId: edge.bId });
      adjacency.get(edge.bId)!.push({ edgeIdx: ei, otherNodeId: edge.aId });
    }

    // --- Step 2: Trace ordered paths per connected component ---
    // Each component is a path or cycle (each node has degree ≤ 2).
    const visited = new Set<number>(); // visited edge indices

    // Group nodes by component
    const compNodes = new Map<number, string[]>();
    for (const node of activeNodes) {
      const comp = nodeComponent.get(node.id) ?? 0;
      if (!compNodes.has(comp)) compNodes.set(comp, []);
      compNodes.get(comp)!.push(node.id);
    }

    for (const [compIdx, nodeIds] of compNodes) {
      // Find a degree-1 node to start (for open paths), or any node (for cycles)
      let startNode = nodeIds[0];
      for (const nid of nodeIds) {
        const adj = adjacency.get(nid) ?? [];
        if (adj.length === 1) { startNode = nid; break; }
      }

      // Trace the path
      const orderedEdgeIndices: number[] = [];
      const orderedDirections: boolean[] = []; // true = edge goes A→B from current node
      let currentNode = startNode;

      while (true) {
        const adj = adjacency.get(currentNode) ?? [];
        let foundNext = false;
        for (const { edgeIdx, otherNodeId } of adj) {
          if (visited.has(edgeIdx)) continue;
          visited.add(edgeIdx);
          const ew = edgeWaypoints[edgeIdx];
          orderedEdgeIndices.push(edgeIdx);
          orderedDirections.push(ew.aId === currentNode);
          currentNode = otherNodeId;
          foundNext = true;
          break;
        }
        if (!foundNext) break;
      }

      if (orderedEdgeIndices.length === 0) continue;

      // Collect ordered waypoints from all edges in the traced path
      const splinePoints: THREE.Vector3[] = [];
      for (let i = 0; i < orderedEdgeIndices.length; i++) {
        const ew = edgeWaypoints[orderedEdgeIndices[i]];
        const forward = orderedDirections[i];
        const pts = forward ? ew.points : [...ew.points].reverse();
        // Skip the first point for all edges after the first (shared with previous edge's last point)
        const startIdx = i === 0 ? 0 : 1;
        for (let j = startIdx; j < pts.length; j++) {
          splinePoints.push(pts[j]);
        }
      }

      // Create a CatmullRom cubic spline through the ordered waypoints
      const isClosed = (orderedEdgeIndices.length > 1 &&
        edgeWaypoints[orderedEdgeIndices[0]].aId === currentNode ||
        edgeWaypoints[orderedEdgeIndices[0]].bId === currentNode) &&
        startNode === currentNode;
      const spline = new THREE.CatmullRomCurve3(splinePoints, isClosed, "catmullrom", 0.5);

      // Determine tube segments based on number of waypoints
      const tubeSegments = Math.max(splinePoints.length * 8, 32);
      const tubeGeometry = new THREE.TubeGeometry(spline, tubeSegments, tubeRadius, RADIAL_SEGMENTS, isClosed);
      const material = componentMaterials[compIdx % componentMaterials.length];
      const tubeMesh = new THREE.Mesh(tubeGeometry, material);
      scene.add(tubeMesh);

      // --- Step 3: Create beads for this component ---
      // Each edge in the traced path has loopSteps; the bead travels along the
      // component spline, with each edge occupying an equal fraction of the total t range.
      const totalEdges = orderedEdgeIndices.length;
      for (let i = 0; i < totalEdges; i++) {
        const ew = edgeWaypoints[orderedEdgeIndices[i]];
        const forward = orderedDirections[i];
        const orbEdge = orbifoldGrid.edges.get(ew.orbifoldEdgeId);
        const loopSteps = orbEdge?.data?.loopSteps ?? [];

        for (const ls of loopSteps) {
          // Determine if this bead travels in the same direction as the traced path
          const beadForward = (forward && ls.startNode === ew.aOrbNode) ||
            (!forward && ls.startNode === ew.bOrbNode);

          const beadMesh = new THREE.Mesh(beadGeometry, beadMaterial);
          beadMesh.visible = false;
          scene.add(beadMesh);
          beadMeshesRef.current.push(beadMesh);
          beadDataRef.current.push({
            mesh: beadMesh,
            path: spline,
            startStep: ls.startStep,
            // Store edge position info for mapping step fraction to spline t
            edgeIndex: i,
            totalEdges,
            beadForward,
          });
        }
      }
    }

    // Render spheres for active nodes
    for (const node of activeNodes) {
      const pos = getNodePosition(orbifoldGrid, node.orbifoldNode, node.voltage, useAxialTransform, levelSpacing);

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

  // Animate beads along their paths
  useEffect(() => {
    if (maxLoopStep < 0 || beadDataRef.current.length === 0) return;

    const totalSteps = maxLoopStep + 1;
    const startTime = performance.now();

    function updateBeads() {
      const elapsed = (performance.now() - startTime) / 1000; // seconds
      const t = (elapsed * beadSpeed) % totalSteps;
      const currentStep = Math.floor(t);
      const frac = t - currentStep;

      for (const bd of beadDataRef.current) {
        if (bd.startStep === currentStep) {
          bd.mesh.visible = true;
          // Map edge fraction to spline t: each edge occupies 1/totalEdges of the spline
          const edgeFrac = bd.beadForward ? frac : (1 - frac);
          const splineT = (bd.edgeIndex + edgeFrac) / bd.totalEdges;
          const pos = bd.path.getPoint(splineT);
          bd.mesh.position.copy(pos);
        } else {
          bd.mesh.visible = false;
        }
      }

      beadAnimRef.current = requestAnimationFrame(updateBeads);
    }

    const beadAnimRef = { current: requestAnimationFrame(updateBeads) };

    return () => {
      cancelAnimationFrame(beadAnimRef.current);
    };
  }, [maxLoopStep, beadSpeed]);

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
