/**
 * Animated spanning tree example renderer using actual orbifold structure.
 *
 * For a given wallpaper group, creates an orbifold grid with n=40. Picks a
 * random root node and does DFS from it (randomly choosing among multi-edges),
 * which induces a spanning tree used to compute voltage (3x3 matrix) for each
 * node. Each node is rendered using its native polygon (square → 2 triangles,
 * triangle → 1 triangle) transformed by the voltage matrix (with axial
 * transform for P3/P6). Nodes are colored by tree depth from root.
 *
 * Animation: each frame moves the root to a random neighbor, then re-DFS.
 * Only nodes whose voltage changed get geometry updates in Three.js.
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

/**
 * A "simple edge" groups parallel orbifold edges between the same pair of
 * distinct nodes. During DFS we randomly pick one of the parallel orbifold
 * edges (which determines the voltage matrix used).
 */
interface SimpleEdge {
  a: number;
  b: number;
  orbEdgeIds: OrbifoldEdgeId[];
}

interface NodeInfo {
  orbNodeId: OrbifoldNodeId;
  orbNode: OrbifoldNode;
  vertexBase: number;
  vertexCount: number;   // 3 for triangle, 6 for quad (split into 2 tris)
  voltage: Matrix3x3;
  prevVoltage: Matrix3x3;
  dist: number;          // DFS depth from root
  prevDist: number;
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
        dist: 0,
        prevDist: 0,
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
        simpleEdges.push({ a: lo, b: hi, orbEdgeIds: [eid] });
      }
    }

    /* ---- per-node adjacency into simpleEdges ---- */
    const nodeAdj: number[][] = new Array(numNodes);
    for (let i = 0; i < numNodes; i++) nodeAdj[i] = [];
    for (let ei = 0; ei < simpleEdges.length; ei++) {
      nodeAdj[simpleEdges[ei].a].push(ei);
      nodeAdj[simpleEdges[ei].b].push(ei);
    }

    /* ---- DFS buffers ---- */
    const dfsStack = new Int32Array(numNodes);
    const dfsVisited = new Uint8Array(numNodes);

    /* ---- current root ---- */
    let rootIdx = Math.floor(Math.random() * numNodes);

    /**
     * DFS from rootIdx through ALL simple edges (randomly picking one orbifold
     * edge per simple edge). This induces a spanning tree and computes:
     * - voltage for each node (product of half-edge voltages along tree path)
     * - dist for each node (tree depth from root)
     */
    function dfsFromRoot(): void {
      dfsVisited.fill(0);
      nodes[rootIdx].voltage = I3;
      nodes[rootIdx].dist = 0;
      dfsVisited[rootIdx] = 1;
      dfsStack[0] = rootIdx;
      let top = 1;

      while (top > 0) {
        const ni = dfsStack[--top];
        const W = nodes[ni].voltage;
        const d = nodes[ni].dist;

        // Shuffle adjacency to randomize DFS tree among multi-edges
        const adj = nodeAdj[ni];
        for (let i = adj.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          const tmp = adj[i]; adj[i] = adj[j]; adj[j] = tmp;
        }

        for (const ei of adj) {
          const e = simpleEdges[ei];
          const nbIdx = e.a === ni ? e.b : e.a;
          if (dfsVisited[nbIdx]) continue;
          dfsVisited[nbIdx] = 1;

          // Randomly pick one orbifold edge from the parallel group
          const ids = e.orbEdgeIds;
          const orbId = ids[Math.floor(Math.random() * ids.length)];

          // Compute voltage: look up half-edge from this node toward neighbor
          const orbEdge = grid.edges.get(orbId)!;
          const thisNodeId = nodes[ni].orbNodeId;
          const half = orbEdge.halfEdges.get(thisNodeId);

          if (half) {
            nodes[nbIdx].voltage = matMul(W, half.voltage);
          } else {
            const nbNodeId = nodes[nbIdx].orbNodeId;
            const nbHalf = orbEdge.halfEdges.get(nbNodeId)!;
            nodes[nbIdx].voltage = matMul(W, matInvUnimodular(nbHalf.voltage));
          }

          nodes[nbIdx].dist = d + 1;
          dfsStack[top++] = nbIdx;
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

    /** Color a node by its tree depth (normalized to [0,1]). */
    function writeNodeColor(i: number, t: number): void {
      const info = nodes[i];
      const vb = info.vertexBase;
      tmpColor.setHSL(((t * 0.618033988749895) % 1 + 1) % 1, 0.85, 0.5);
      for (let k = 0; k < info.vertexCount; k++) {
        colorAttr.setXYZ(vb + k, tmpColor.r, tmpColor.g, tmpColor.b);
      }
    }

    /* ---- initial computation ---- */
    dfsFromRoot();

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (let i = 0; i < numNodes; i++) {
      writeNodeGeometry(i);
      const info = nodes[i];
      for (let k = 0; k < info.vertexCount; k++) {
        const vx = posAttr.getX(info.vertexBase + k);
        const vy = posAttr.getY(info.vertexBase + k);
        if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
        if (vy < minY) minY = vy; if (vy > maxY) maxY = vy;
      }
    }

    // Color by distance
    let maxDist = 0;
    for (let i = 0; i < numNodes; i++) {
      if (nodes[i].dist > maxDist) maxDist = nodes[i].dist;
    }
    const distRange = maxDist || 1;
    for (let i = 0; i < numNodes; i++) {
      writeNodeColor(i, nodes[i].dist / distRange);
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

    function tick() {
      animId = requestAnimationFrame(tick);

      // Save previous state
      for (let i = 0; i < numNodes; i++) {
        nodes[i].prevVoltage = nodes[i].voltage;
        nodes[i].prevDist = nodes[i].dist;
      }

      // Move root to a random neighbor
      const adj = nodeAdj[rootIdx];
      if (adj.length > 0) {
        const ei = adj[Math.floor(Math.random() * adj.length)];
        const e = simpleEdges[ei];
        rootIdx = e.a === rootIdx ? e.b : e.a;
      }

      // Re-DFS from new root
      dfsFromRoot();

      // Update geometry only for nodes whose voltage changed
      let posDirty = false;
      for (let i = 0; i < numNodes; i++) {
        if (!matEq(nodes[i].voltage, nodes[i].prevVoltage)) {
          writeNodeGeometry(i);
          posDirty = true;
        }
      }

      // Color by distance — update all since range may shift
      let newMaxDist = 0;
      for (let i = 0; i < numNodes; i++) {
        if (nodes[i].dist > newMaxDist) newMaxDist = nodes[i].dist;
      }
      const newDistRange = newMaxDist || 1;
      for (let i = 0; i < numNodes; i++) {
        writeNodeColor(i, nodes[i].dist / newDistRange);
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
