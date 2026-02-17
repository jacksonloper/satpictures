/**
 * 3D renderer for orbifold weave lifted graphs using Three.js.
 *
 * Renders:
 * - Tubes for each solid-styled lifted edge
 *   - Same-level edges are straight and colored by their level
 *   - Cross-level edges curve to the "left when looking from above
 *     along low→high" (so that lowA→highB and lowB→highA bow in
 *     opposite directions and don't intersect) and use a vertex-color
 *     gradient from one level's color to the other
 * - Spheres for lifted nodes that touch at least one solid edge
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

interface WeaveThreeRendererProps {
  liftedGraph: LiftedGraph<ColorData, EdgeStyleData>;
  orbifoldGrid: OrbifoldGrid<ColorData, EdgeStyleData>;
  useAxialTransform?: boolean;
  width?: number;
  height?: number;
  levelSpacing?: number;
  highlightedOrbifoldNodeId?: string | null;
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
 * Paint per-vertex colors on an existing TubeGeometry so the tube
 * smoothly transitions from `colorA` (at parameter t=0) to `colorB`
 * (at parameter t=1).
 *
 * TubeGeometry vertices are laid out as (tubularSegments+1) rings
 * of (radialSegments+1) vertices each.
 */
function applyGradientToTube(
  geometry: THREE.TubeGeometry,
  colorA: THREE.Color,
  colorB: THREE.Color,
  tubularSegments: number,
): void {
  const posCount = geometry.attributes.position.count;
  const colors = new Float32Array(posCount * 3);
  const ringsPerSegment = posCount / (tubularSegments + 1);
  const mix = new THREE.Color();

  for (let i = 0; i < posCount; i++) {
    const ring = Math.floor(i / ringsPerSegment);
    const t = ring / tubularSegments;           // 0 → 1 along the tube
    mix.copy(colorA).lerp(colorB, t);
    colors[i * 3]     = mix.r;
    colors[i * 3 + 1] = mix.g;
    colors[i * 3 + 2] = mix.b;
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
}

export function WeaveThreeRenderer({
  liftedGraph,
  orbifoldGrid,
  useAxialTransform = false,
  width = 700,
  height = 500,
  levelSpacing = 3,
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

  // Setup Three.js scene
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Create scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);
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

    // Lighting – key + fill + ambient to bring out surface differences
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
    keyLight.position.set(5, 10, 7);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-4, -6, -5);
    scene.add(fillLight);

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

    // Clear existing meshes (keep lights)
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

    // Highly distinct level colors
    const level0Color = new THREE.Color(0x00838f); // Deep teal for level 0
    const level1Color = new THREE.Color(0xff8c00); // Vivid orange for level 1

    // Solid-color materials for same-level edges
    const tubeMaterialLevel0 = new THREE.MeshPhongMaterial({ color: level0Color, shininess: 70 });
    const tubeMaterialLevel1 = new THREE.MeshPhongMaterial({ color: level1Color, shininess: 70 });
    // Gradient material for cross-level edges (uses per-vertex colors)
    const tubeGradientMaterial = new THREE.MeshPhongMaterial({
      vertexColors: true,
      shininess: 70,
    });

    const sphereMaterialLevel0 = new THREE.MeshPhongMaterial({ color: level0Color, shininess: 90 });
    const sphereMaterialLevel1 = new THREE.MeshPhongMaterial({ color: level1Color, shininess: 90 });
    const sphereGeometry = new THREE.SphereGeometry(EDGE_RADIUS, 16, 12);

    // Compute bounding box for camera positioning
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    // Up vector used to compute "right" offset for cross-level curves
    const up = new THREE.Vector3(0, 1, 0);

    // Render tubes for solid edges
    for (const edge of solidEdges) {
      const posA = getNodePosition(orbifoldGrid, edge.aOrbNode, edge.aVoltage, useAxialTransform, levelSpacing);
      const posB = getNodePosition(orbifoldGrid, edge.bOrbNode, edge.bVoltage, useAxialTransform, levelSpacing);

      // Update bounds
      for (const p of [posA, posB]) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      }

      const isCrossLevel = edge.aLevel !== edge.bLevel;

      if (isCrossLevel) {
        // Curved cross-level edge.  To prevent intersections we need
        // every cross-level edge to bow to the same side when viewed
        // from above along the low→high direction.
        //
        // 1. Orient the edge so it goes from the LOW endpoint to the
        //    HIGH endpoint.
        // 2. Project the low→high direction onto the horizontal (XZ)
        //    plane.
        // 3. "Left when looking from above along low→high" is
        //    cross(up, horizontal).  This is the bow offset direction.
        //
        // Because this orientation is defined solely by the low→high
        // view, edges lowA→highB and lowB→highA will bow in
        // *different* directions (the horizontal component flips) and
        // therefore won't intersect.
        const posLow  = edge.aLevel < edge.bLevel ? posA : posB;
        const posHigh = edge.aLevel < edge.bLevel ? posB : posA;

        const dir = new THREE.Vector3().subVectors(posHigh, posLow);
        const edgeLen = dir.length();

        // Horizontal component of the low→high direction
        const horiz = new THREE.Vector3(dir.x, 0, dir.z);
        // "Left" when looking from above along the low→high direction
        const bowDir = new THREE.Vector3().crossVectors(up, horiz).normalize();
        // If the horizontal projection was zero (nodes stacked
        // vertically), fall back to an arbitrary perpendicular
        if (bowDir.lengthSq() < 1e-6) bowDir.set(1, 0, 0);

        const mid = new THREE.Vector3().addVectors(posA, posB).multiplyScalar(0.5);
        mid.addScaledVector(bowDir, edgeLen * CROSS_LEVEL_BOW);

        const curve = new THREE.QuadraticBezierCurve3(posA, mid, posB);
        const tubeGeometry = new THREE.TubeGeometry(curve, TUBE_SEGMENTS_CURVED, EDGE_RADIUS, RADIAL_SEGMENTS, false);

        // Gradient vertex colors from A-level color to B-level color
        const colA = edge.aLevel === 0 ? level0Color : level1Color;
        const colB = edge.bLevel === 0 ? level0Color : level1Color;
        applyGradientToTube(tubeGeometry, colA, colB, TUBE_SEGMENTS_CURVED);

        const tubeMesh = new THREE.Mesh(tubeGeometry, tubeGradientMaterial);
        scene.add(tubeMesh);
      } else {
        // Straight same-level edge
        const path = new THREE.LineCurve3(posA, posB);
        const tubeGeometry = new THREE.TubeGeometry(path, TUBE_SEGMENTS_STRAIGHT, EDGE_RADIUS, RADIAL_SEGMENTS, false);
        const material = edge.aLevel === 0 ? tubeMaterialLevel0 : tubeMaterialLevel1;
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

      const sphereMesh = new THREE.Mesh(
        sphereGeometry,
        node.level === 0 ? sphereMaterialLevel0 : sphereMaterialLevel1,
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
  }, [solidEdges, activeNodes, orbifoldGrid, useAxialTransform, levelSpacing]);

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

    const highlightMaterial = new THREE.MeshPhongMaterial({
      color: 0xffd700,
      emissive: 0xffd700,
      emissiveIntensity: 0.6,
      shininess: 100,
      transparent: true,
      opacity: 0.7,
    });
    const highlightGeometry = new THREE.SphereGeometry(EDGE_RADIUS * 2.2, 20, 14);

    // Find all lifted nodes whose orbifold node matches
    for (const node of activeNodes) {
      if (node.orbifoldNode !== highlightedOrbifoldNodeId) continue;

      const pos = getNodePosition(orbifoldGrid, node.orbifoldNode, node.voltage, useAxialTransform, levelSpacing);
      const mesh = new THREE.Mesh(highlightGeometry, highlightMaterial);
      mesh.position.copy(pos);
      scene.add(mesh);
      highlightMeshesRef.current.push(mesh);
    }
  }, [highlightedOrbifoldNodeId, activeNodes, orbifoldGrid, useAxialTransform, levelSpacing]);

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
