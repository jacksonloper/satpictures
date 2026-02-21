/**
 * Animated spanning tree example renderer using actual orbifold structure.
 *
 * For a given wallpaper group, creates an orbifold grid with n=40, assigns
 * gaussian random weights to orbifold edges, builds a spanning tree via
 * Kruskal's, computes voltage (3x3 matrix) for each node by multiplying
 * voltages along the tree path from root. Each node is rendered using its
 * native polygon (square → 2 triangles, triangle → 1 triangle) transformed
 * by the voltage matrix (with axial transform for P3/P6).
 *
 * Animation: each frame perturbs weights via an OU process, recomputes tree
 * and voltages, and only updates Three.js geometry for nodes whose voltage
 * matrix changed.
 *
 * Three.js uses an orthographic camera with pan+zoom (no rotation).
 */

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createOrbifoldGrid, type WallpaperGroupType } from "../createOrbifolds";
import {
  buildAdjacency,
  matMul,
  matEq,
  matInvUnimodular,
  I3,
  applyMatrix,
  axialToCartesian,
  type OrbifoldGrid,
  type OrbifoldNodeId,
  type OrbifoldEdgeId,
  type Matrix3x3,
  type OrbifoldNode,
} from "../orbifoldbasics";

/* ---------- constants ---------- */

const ORBIFOLD_N = 40;

// OU process parameters
const THETA = 0.3;
const SIGMA = 0.25;

/* ---------- helpers ---------- */

function randn(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * A "simple edge" groups parallel orbifold edges between the same pair of
 * distinct nodes. Each gets one OU weight; when the tree selects this edge
 * we randomly pick one of the parallel orbifold edges (which determines the
 * voltage matrix used).
 */
interface SimpleEdge {
  a: number;
  b: number;
  orbEdgeIds: OrbifoldEdgeId[];
  weight: number;
}

interface NodeInfo {
  orbNodeId: OrbifoldNodeId;
  orbNode: OrbifoldNode;
  vertexBase: number;
  vertexCount: number;   // 3 for triangle, 6 for quad (split into 2 tris)
  voltage: Matrix3x3;
  prevVoltage: Matrix3x3;
}

/* ---------- component ---------- */

interface SpanningTreeExampleRendererProps {
  wallpaperGroup?: WallpaperGroupType;
  width?: number;
  height?: number;
}

export function SpanningTreeExampleRenderer({
  wallpaperGroup = "P1",
  width = 900,
  height = 400,
}: SpanningTreeExampleRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const useAxial = wallpaperGroup === "P3" || wallpaperGroup === "P6";

    /* ---- build orbifold grid ---- */
    const grid: OrbifoldGrid = createOrbifoldGrid(wallpaperGroup, ORBIFOLD_N);
    buildAdjacency(grid);

    /* ---- flat node array ---- */
    const nodeIdToIdx = new Map<OrbifoldNodeId, number>();
    const nodes: NodeInfo[] = [];
    let vertexOffset = 0;

    for (const [nid, orbNode] of grid.nodes) {
      const idx = nodes.length;
      nodeIdToIdx.set(nid, idx);
      const isTriangle = orbNode.polygon.length === 3;
      const vertexCount = isTriangle ? 3 : 6;
      nodes.push({
        orbNodeId: nid,
        orbNode,
        vertexBase: vertexOffset,
        vertexCount,
        voltage: I3,
        prevVoltage: I3,
      });
      vertexOffset += vertexCount;
    }
    const totalVertices = vertexOffset;
    const numNodes = nodes.length;

    /* ---- simple edges (grouping parallel orbifold edges) ---- */
    const pairKeyToIdx = new Map<string, number>();
    const simpleEdges: SimpleEdge[] = [];

    for (const [eid, orbEdge] of grid.edges) {
      const endpoints = Array.from(orbEdge.halfEdges.keys());
      if (endpoints.length < 2) continue;
      const [nA, nB] = endpoints;
      if (nA === nB) continue;
      const idxA = nodeIdToIdx.get(nA)!;
      const idxB = nodeIdToIdx.get(nB)!;
      const lo = Math.min(idxA, idxB), hi = Math.max(idxA, idxB);
      const pk = `${lo}-${hi}`;

      const existing = pairKeyToIdx.get(pk);
      if (existing !== undefined) {
        simpleEdges[existing].orbEdgeIds.push(eid);
      } else {
        pairKeyToIdx.set(pk, simpleEdges.length);
        simpleEdges.push({ a: lo, b: hi, orbEdgeIds: [eid], weight: randn() });
      }
    }
    const numEdges = simpleEdges.length;

    /* ---- Kruskal buffers ---- */
    const sortArr = Array.from({ length: numEdges }, (_, i) => i);
    const ufParent = new Int32Array(numNodes);
    const ufRank = new Int32Array(numNodes);
    const treeOrbId: (OrbifoldEdgeId | null)[] = new Array(numEdges).fill(null);

    /* ---- BFS buffers ---- */
    const bfsQueue = new Int32Array(numNodes);
    const bfsVisited = new Uint8Array(numNodes);

    /* ---- per-node adjacency into simpleEdges ---- */
    const nodeAdj: number[][] = new Array(numNodes);
    for (let i = 0; i < numNodes; i++) nodeAdj[i] = [];
    for (let ei = 0; ei < numEdges; ei++) {
      nodeAdj[simpleEdges[ei].a].push(ei);
      nodeAdj[simpleEdges[ei].b].push(ei);
    }

    /* ---- Kruskal functions ---- */
    function find(x: number): number {
      while (ufParent[x] !== x) { ufParent[x] = ufParent[ufParent[x]]; x = ufParent[x]; }
      return x;
    }

    function buildTree(): void {
      for (let i = 0; i < numNodes; i++) { ufParent[i] = i; ufRank[i] = 0; }
      treeOrbId.fill(null);
      sortArr.sort((a, b) => simpleEdges[a].weight - simpleEdges[b].weight);

      let added = 0;
      for (let si = 0; si < numEdges && added < numNodes - 1; si++) {
        const ei = sortArr[si];
        const e = simpleEdges[ei];
        const ra = find(e.a), rb = find(e.b);
        if (ra !== rb) {
          if (ufRank[ra] < ufRank[rb]) ufParent[ra] = rb;
          else if (ufRank[ra] > ufRank[rb]) ufParent[rb] = ra;
          else { ufParent[rb] = ra; ufRank[ra]++; }
          const ids = e.orbEdgeIds;
          treeOrbId[ei] = ids[Math.floor(Math.random() * ids.length)];
          added++;
        }
      }
    }

    /**
     * BFS from root (node 0) through spanning tree edges.
     * Each node gets voltage = parentVoltage * halfEdgeVoltage.
     */
    function computeVoltages(): void {
      bfsVisited.fill(0);
      nodes[0].voltage = I3;
      bfsVisited[0] = 1;
      bfsQueue[0] = 0;
      let head = 0, tail = 1;

      while (head < tail) {
        const ni = bfsQueue[head++];
        const W = nodes[ni].voltage;

        for (const ei of nodeAdj[ni]) {
          const orbId = treeOrbId[ei];
          if (!orbId) continue;

          const e = simpleEdges[ei];
          const nbIdx = e.a === ni ? e.b : e.a;
          if (bfsVisited[nbIdx]) continue;
          bfsVisited[nbIdx] = 1;

          // Look up the half-edge from this node toward the neighbor.
          const orbEdge = grid.edges.get(orbId)!;
          const thisNodeId = nodes[ni].orbNodeId;
          const half = orbEdge.halfEdges.get(thisNodeId);

          if (half) {
            // A --(V)--> B: child voltage = W * V
            nodes[nbIdx].voltage = matMul(W, half.voltage);
          } else {
            // Fallback: use inverse of the other direction
            const nbNodeId = nodes[nbIdx].orbNodeId;
            const nbHalf = orbEdge.halfEdges.get(nbNodeId)!;
            nodes[nbIdx].voltage = matMul(W, matInvUnimodular(nbHalf.voltage));
          }

          bfsQueue[tail++] = nbIdx;
        }
      }
    }

    /* ---- vertex transform ---- */
    function transformVertex(px: number, py: number, V: Matrix3x3): { x: number; y: number } {
      let pos = applyMatrix(V, px, py);
      if (useAxial) pos = axialToCartesian(pos.x, pos.y);
      return pos;
    }

    /* ---- Three.js setup ---- */
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x222222);

    const positions = new Float32Array(totalVertices * 3);
    const colors = new Float32Array(totalVertices * 3);

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    scene.add(new THREE.Mesh(geom, mat));

    const posAttr = geom.getAttribute("position") as THREE.BufferAttribute;
    const colorAttr = geom.getAttribute("color") as THREE.BufferAttribute;
    const tmpColor = new THREE.Color();

    /* ---- write geometry for one node ---- */
    function writeNodeGeometry(i: number): void {
      const info = nodes[i];
      const poly = info.orbNode.polygon;
      const V = info.voltage;
      const vb = info.vertexBase;

      if (poly.length === 3) {
        for (let k = 0; k < 3; k++) {
          const p = transformVertex(poly[k][0], poly[k][1], V);
          posAttr.setXYZ(vb + k, p.x, p.y, 0);
        }
      } else {
        // Quad → 2 triangles: (0,1,2) and (0,2,3)
        const c: { x: number; y: number }[] = [];
        for (let k = 0; k < 4; k++) c.push(transformVertex(poly[k][0], poly[k][1], V));
        posAttr.setXYZ(vb + 0, c[0].x, c[0].y, 0);
        posAttr.setXYZ(vb + 1, c[1].x, c[1].y, 0);
        posAttr.setXYZ(vb + 2, c[2].x, c[2].y, 0);
        posAttr.setXYZ(vb + 3, c[0].x, c[0].y, 0);
        posAttr.setXYZ(vb + 4, c[2].x, c[2].y, 0);
        posAttr.setXYZ(vb + 5, c[3].x, c[3].y, 0);
      }
    }

    /**
     * Map a voltage matrix to a scalar for HSL coloring. We use the
     * translation part (col 2) plus a trace contribution to spread colors.
     */
    function voltageToScalar(V: Matrix3x3): number {
      return V[0][2] * 0.37 + V[1][2] * 0.61 + (V[0][0] + V[1][1]) * 0.13;
    }

    function writeNodeColor(i: number, t: number): void {
      const info = nodes[i];
      const vb = info.vertexBase;
      // Golden-ratio hue spread for perceptual variety
      tmpColor.setHSL(((t * 0.618033988749895) % 1 + 1) % 1, 0.85, 0.5);
      for (let k = 0; k < info.vertexCount; k++) {
        colorAttr.setXYZ(vb + k, tmpColor.r, tmpColor.g, tmpColor.b);
      }
    }

    /* ---- initial computation ---- */
    buildTree();
    computeVoltages();

    const voltageScalars = new Float64Array(numNodes);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (let i = 0; i < numNodes; i++) {
      voltageScalars[i] = voltageToScalar(nodes[i].voltage);
      writeNodeGeometry(i);
      const info = nodes[i];
      for (let k = 0; k < info.vertexCount; k++) {
        const vx = posAttr.getX(info.vertexBase + k);
        const vy = posAttr.getY(info.vertexBase + k);
        if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
        if (vy < minY) minY = vy; if (vy > maxY) maxY = vy;
      }
    }

    let sLo = Infinity, sHi = -Infinity;
    for (let i = 0; i < numNodes; i++) {
      if (voltageScalars[i] < sLo) sLo = voltageScalars[i];
      if (voltageScalars[i] > sHi) sHi = voltageScalars[i];
    }
    const sRange = sHi - sLo || 1;
    for (let i = 0; i < numNodes; i++) {
      writeNodeColor(i, (voltageScalars[i] - sLo) / sRange);
    }
    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;

    /* ---- camera ---- */
    const gridW = (maxX - minX) || 1;
    const gridH = (maxY - minY) || 1;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const aspect = width / height;
    const gridAspect = gridW / gridH;
    let camHalfW: number, camHalfH: number;
    if (gridAspect > aspect) {
      camHalfW = gridW / 2 * 1.05;
      camHalfH = camHalfW / aspect;
    } else {
      camHalfH = gridH / 2 * 1.05;
      camHalfW = camHalfH * aspect;
    }
    const camera = new THREE.OrthographicCamera(
      -camHalfW, camHalfW, camHalfH, -camHalfH, 0.1, 100,
    );
    camera.position.set(cx, cy, 10);
    camera.lookAt(cx, cy, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.screenSpacePanning = true;
    controls.target.set(cx, cy, 0);
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.update();

    /* ---- animation loop ---- */
    let animId = 0;
    let lastTime = performance.now();

    function tick() {
      animId = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      // OU step
      const sd = SIGMA * Math.sqrt(dt);
      for (let i = 0; i < numEdges; i++) {
        simpleEdges[i].weight += -THETA * simpleEdges[i].weight * dt + sd * randn();
      }

      // Save previous voltages
      for (let i = 0; i < numNodes; i++) nodes[i].prevVoltage = nodes[i].voltage;

      buildTree();
      computeVoltages();

      // Recompute scalars
      let newSLo = Infinity, newSHi = -Infinity;
      for (let i = 0; i < numNodes; i++) {
        voltageScalars[i] = voltageToScalar(nodes[i].voltage);
        if (voltageScalars[i] < newSLo) newSLo = voltageScalars[i];
        if (voltageScalars[i] > newSHi) newSHi = voltageScalars[i];
      }
      const newSRange = newSHi - newSLo || 1;

      // Update geometry only for nodes whose voltage changed
      let posDirty = false;
      for (let i = 0; i < numNodes; i++) {
        if (!matEq(nodes[i].voltage, nodes[i].prevVoltage)) {
          writeNodeGeometry(i);
          posDirty = true;
        }
      }
      // Colors depend on global range so update all
      for (let i = 0; i < numNodes; i++) {
        writeNodeColor(i, (voltageScalars[i] - newSLo) / newSRange);
      }

      if (posDirty) posAttr.needsUpdate = true;
      colorAttr.needsUpdate = true;

      controls.update();
      renderer.render(scene, camera);
    }
    tick();

    /* ---- cleanup ---- */
    return () => {
      cancelAnimationFrame(animId);
      controls.dispose();
      renderer.dispose();
      geom.dispose();
      mat.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [wallpaperGroup, width, height]);

  return (
    <div
      ref={containerRef}
      style={{
        width,
        height,
        border: "1px solid #444",
        borderRadius: 8,
        overflow: "hidden",
      }}
    />
  );
}
