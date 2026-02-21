/**
 * OrbifoldExamplesViewer – animated orbifold assembly visualization.
 *
 * Core idea:
 *   • Create an orbifold grid of the chosen wallpaper-group type with fixed n = 40.
 *   • Assign a "node voltage" (Matrix3x3) to every orbifold node — initially all identity.
 *   • An edge is "solid" when the two endpoint node voltages agree with the edge voltage
 *     (i.e. nodeVoltage_B == nodeVoltage_A * edgeVoltage), "dashed" otherwise.
 *   • Render each node's polygon transformed by its voltage (axial → Cartesian for P3 / P6).
 *   • For each unique voltage in the orbifold, create a shifted copy of all polygons,
 *     each group colored distinctly. The main group (identity) stays in place.
 *   • Animate: at each step pick a random dashed edge, pick one endpoint, compute the
 *     voltage it *would* need to agree with the other endpoint, check that the resulting
 *     set of solid edges still forms a single connected component, and if so accept.
 *   • The canvas supports zoom (wheel) and pan (drag) so the user can follow the shape.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  type Matrix3x3,
  type OrbifoldNodeId,
  I3,
  matMul,
  matEq,
  applyMatrix,
  axialToCartesian,
  buildAdjacency,
  voltageKey,
} from "../orbifoldbasics";
import { createOrbifoldGrid, type WallpaperGroupType } from "../createOrbifolds";
import { computeSolidEdges, doStepPure } from "./orbifoldExamplesHelpers";

// ─── helpers ────────────────────────────────────────────────────────

const FIXED_N = 40;
const SPEED_SLIDER_MAX = 200;
const MAX_STEPS_PER_FRAME = 100;

/**
 * Collect all unique voltages from the orbifold's half-edges.
 * Returns an array of unique Matrix3x3 voltages (including identity).
 */
function collectOrbifoldVoltages(
  grid: Parameters<typeof computeSolidEdges>[0],
): Matrix3x3[] {
  const seen = new Set<string>();
  const voltages: Matrix3x3[] = [];
  // Always include identity as the first entry
  seen.add(voltageKey(I3));
  voltages.push(I3);
  for (const edge of grid.edges.values()) {
    for (const halfEdge of edge.halfEdges.values()) {
      const key = voltageKey(halfEdge.voltage);
      if (!seen.has(key)) {
        seen.add(key);
        voltages.push(halfEdge.voltage);
      }
    }
  }
  return voltages;
}

/** Generate a distinct HSL color for a group index. */
function groupColor(groupIndex: number, totalGroups: number, alpha: number = 0.75): string {
  if (totalGroups <= 1) return `hsla(210, 80%, 55%, ${alpha})`;
  const hue = (groupIndex * 360 / totalGroups) % 360;
  return `hsla(${hue}, 80%, 55%, ${alpha})`;
}

// ─── component ──────────────────────────────────────────────────────

export function OrbifoldExamplesViewer({
  wallpaperGroup,
  onClose,
}: {
  wallpaperGroup: WallpaperGroupType;
  onClose: () => void;
}) {
  // ── grid (computed once) ──
  const grid = useMemo(() => {
    const g = createOrbifoldGrid(wallpaperGroup, FIXED_N);
    buildAdjacency(g);
    return g;
  }, [wallpaperGroup]);

  const nodeIds = useMemo(() => Array.from(grid.nodes.keys()), [grid]);
  const edgeIds = useMemo(() => Array.from(grid.edges.keys()), [grid]);

  // Collect all unique voltages from the orbifold (identity first)
  const orbifoldVoltages = useMemo(() => collectOrbifoldVoltages(grid), [grid]);

  // ── state: voltage per node ──
  const [nodeVoltages, setNodeVoltages] = useState<Map<OrbifoldNodeId, Matrix3x3>>(() => {
    const m = new Map<OrbifoldNodeId, Matrix3x3>();
    for (const nid of grid.nodes.keys()) m.set(nid, I3);
    return m;
  });

  // Derived: solid edges
  const solidEdges = useMemo(
    () => computeSolidEdges(grid, nodeVoltages),
    [grid, nodeVoltages],
  );

  // ── animation ──
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(50); // ms per step (1 = fastest single-step)
  const [stepsPerFrame, setStepsPerFrame] = useState(1);
  const animFrameRef = useRef<number | null>(null);
  const lastStepRef = useRef(0);
  const stateRef = useRef({ nodeVoltages, solidEdges, grid, nodeIds, edgeIds });
  useEffect(() => {
    stateRef.current = { nodeVoltages, solidEdges, grid, nodeIds, edgeIds };
  });

  const doStep = useCallback(() => {
    const { nodeVoltages: nv, solidEdges: se, grid: g, nodeIds: nids, edgeIds: eids } = stateRef.current;

    // Work on mutable copies so doStepPure can mutate in-place
    const nvCopy = new Map(nv);
    const seCopy = new Set(se);

    const result = doStepPure(nvCopy, seCopy, g, nids, eids);
    if (result.accepted) {
      setNodeVoltages(nvCopy);
    }
  }, []);

  const doMultipleSteps = useCallback((count: number) => {
    const { nodeVoltages: nv, solidEdges: se, grid: g, nodeIds: nids, edgeIds: eids } = stateRef.current;

    // Work on mutable copies for the whole batch
    const nvCopy = new Map(nv);
    const seCopy = new Set(se);
    let anyAccepted = false;

    for (let i = 0; i < count; i++) {
      const result = doStepPure(nvCopy, seCopy, g, nids, eids);
      if (result.accepted) anyAccepted = true;
    }

    // Commit the final state in one React update
    if (anyAccepted) {
      setNodeVoltages(nvCopy);
    }
  }, []);

  useEffect(() => {
    if (!running) {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
      return;
    }

    const loop = (ts: number) => {
      if (ts - lastStepRef.current >= speed) {
        if (stepsPerFrame > 1) {
          doMultipleSteps(stepsPerFrame);
        } else {
          doStep();
        }
        lastStepRef.current = ts;
      }
      animFrameRef.current = requestAnimationFrame(loop);
    };
    animFrameRef.current = requestAnimationFrame(loop);
    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
    };
  }, [running, speed, stepsPerFrame, doStep, doMultipleSteps]);

  // ── zoom & pan ──
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const panRef = useRef(pan);
  useEffect(() => { panRef.current = pan; });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setZoom((z) => Math.max(0.05, Math.min(20, z * factor)));
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const p = panRef.current;
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: p.x, panY: p.y };
    setDragging(true);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy });
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  // ── rendering to canvas ──
  const useAxial = wallpaperGroup === "P3" || wallpaperGroup === "P6";

  // Pre-compute polygon corners for the main group (identity voltage copy).
  // Each node's polygon is transformed by its node voltage.
  const mainPolygonData = useMemo(() => {
    const data: Array<{
      nodeId: OrbifoldNodeId;
      corners: Array<{ x: number; y: number }>;
    }> = [];
    for (const [nid, node] of grid.nodes) {
      const nv = nodeVoltages.get(nid) ?? I3;
      const corners = node.polygon.map(([px, py]) => {
        let pos = applyMatrix(nv, px, py);
        if (useAxial) pos = axialToCartesian(pos.x, pos.y);
        return pos;
      });
      data.push({ nodeId: nid, corners });
    }
    return data;
  }, [grid, nodeVoltages, useAxial]);

  // For each orbifold voltage V, create a shifted copy of the main polygons.
  // The main (identity) copy uses the node voltages as-is.
  // Other copies shift every corner by V (applied before axial transform).
  const groupPolygonData = useMemo(() => {
    const groups: Array<{
      groupIndex: number;
      groupVoltage: Matrix3x3;
      polygons: Array<{ corners: Array<{ x: number; y: number }> }>;
    }> = [];

    for (let gi = 0; gi < orbifoldVoltages.length; gi++) {
      const gv = orbifoldVoltages[gi];
      const isIdentity = matEq(gv, I3);

      if (isIdentity) {
        // Main group: use pre-computed data
        groups.push({
          groupIndex: gi,
          groupVoltage: gv,
          polygons: mainPolygonData.map(pd => ({ corners: pd.corners })),
        });
      } else {
        // Shifted copy: for each node, apply groupVoltage * nodeVoltage to polygon
        const polys: Array<{ corners: Array<{ x: number; y: number }> }> = [];
        for (const [nid, node] of grid.nodes) {
          const nv = nodeVoltages.get(nid) ?? I3;
          const combined = matMul(gv, nv);
          const corners = node.polygon.map(([px, py]) => {
            let pos = applyMatrix(combined, px, py);
            if (useAxial) pos = axialToCartesian(pos.x, pos.y);
            return pos;
          });
          polys.push({ corners });
        }
        groups.push({ groupIndex: gi, groupVoltage: gv, polygons: polys });
      }
    }
    return groups;
  }, [grid, nodeVoltages, orbifoldVoltages, mainPolygonData, useAxial]);

  // Compute bounding box of the main group only (for auto-zoom with ~50% margin)
  const mainBounds = useMemo(() => {
    let minX = 0, maxX = 1, minY = 0, maxY = 1;
    if (mainPolygonData.length > 0) {
      minX = Infinity; maxX = -Infinity; minY = Infinity; maxY = -Infinity;
      for (const pd of mainPolygonData) {
        for (const c of pd.corners) {
          minX = Math.min(minX, c.x);
          maxX = Math.max(maxX, c.x);
          minY = Math.min(minY, c.y);
          maxY = Math.max(maxY, c.y);
        }
      }
    }
    return { minX, maxX, minY, maxY };
  }, [mainPolygonData]);

  // Draw
  const CANVAS_W = 800;
  const CANVAS_H = 600;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.save();

    // Auto-zoom: fit main group with ~50% margin on each side
    // (i.e. main group occupies ~2/3 of the viewport)
    const rangeX = mainBounds.maxX - mainBounds.minX || 1;
    const rangeY = mainBounds.maxY - mainBounds.minY || 1;
    const margin = 1.5; // 50% extra on each side → scale by 1/1.5
    const baseScale = Math.min(CANVAS_W / (rangeX * margin), CANVAS_H / (rangeY * margin));
    const scale = baseScale * zoom;
    const cx = CANVAS_W / 2 + pan.x;
    const cy = CANVAS_H / 2 + pan.y;
    const midX = (mainBounds.minX + mainBounds.maxX) / 2;
    const midY = (mainBounds.minY + mainBounds.maxY) / 2;

    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-midX, -midY);

    const invScale = 1 / scale;
    const totalGroups = groupPolygonData.length;

    // Draw all groups: polygons only, each group in its own color
    for (const group of groupPolygonData) {
      const fill = groupColor(group.groupIndex, totalGroups, 0.75);
      const stroke = groupColor(group.groupIndex, totalGroups, 0.9);
      for (const poly of group.polygons) {
        ctx.beginPath();
        for (let i = 0; i < poly.corners.length; i++) {
          const c = poly.corners[i];
          if (i === 0) ctx.moveTo(c.x, c.y);
          else ctx.lineTo(c.x, c.y);
        }
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 0.5 * invScale;
        ctx.stroke();
      }
    }

    ctx.restore();
  }, [groupPolygonData, mainBounds, zoom, pan]);

  // Stats
  const dashedCount = edgeIds.length - solidEdges.size;

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      backgroundColor: "rgba(0,0,0,0.6)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
    }}>
      <div style={{
        backgroundColor: "white",
        borderRadius: "12px",
        padding: "20px",
        maxWidth: "900px",
        width: "95vw",
        maxHeight: "95vh",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h3 style={{ margin: 0 }}>
            🧩 {wallpaperGroup} Example (n={FIXED_N})
          </h3>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "20px",
              cursor: "pointer",
              padding: "4px 8px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "8px", flexWrap: "wrap" }}>
          <button
            onClick={() => setRunning((r) => !r)}
            style={{
              padding: "4px 12px",
              borderRadius: "4px",
              border: "1px solid #3498db",
              backgroundColor: running ? "#ebf5fb" : "#d5f5e3",
              cursor: "pointer",
            }}
          >
            {running ? "⏸ Pause" : "▶ Play"}
          </button>
          <button
            onClick={doStep}
            disabled={running}
            style={{
              padding: "4px 12px",
              borderRadius: "4px",
              border: "1px solid #ccc",
              backgroundColor: running ? "#eee" : "white",
              cursor: running ? "not-allowed" : "pointer",
            }}
          >
            ⏭ Step
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px" }}>
            Speed:
            <input
              type="range"
              min={1}
              max={SPEED_SLIDER_MAX * 2}
              value={stepsPerFrame > 1
                ? SPEED_SLIDER_MAX + Math.round(((stepsPerFrame - 2) / (MAX_STEPS_PER_FRAME - 2)) * SPEED_SLIDER_MAX)
                : SPEED_SLIDER_MAX + 1 - speed}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v <= SPEED_SLIDER_MAX) {
                  // Normal range: 1 step per frame, variable delay
                  setSpeed(SPEED_SLIDER_MAX + 1 - v);
                  setStepsPerFrame(1);
                } else {
                  // Turbo range: 0 delay, multiple steps per frame
                  setSpeed(0);
                  // Scale from 2 to MAX_STEPS_PER_FRAME across the turbo range
                  const frac = (v - SPEED_SLIDER_MAX) / SPEED_SLIDER_MAX;
                  setStepsPerFrame(Math.max(2, Math.round(2 + frac * (MAX_STEPS_PER_FRAME - 2))));
                }
              }}
              style={{ width: "120px" }}
            />
            {stepsPerFrame > 1 && (
              <span style={{ color: "#e67e22", fontWeight: "bold" }}>⚡ ×{stepsPerFrame}/frame</span>
            )}
          </label>
          <span style={{ fontSize: "12px", color: "#666" }}>
            Solid: {solidEdges.size} | Dashed: {dashedCount}
          </span>
        </div>

        {/* Canvas */}
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{
            border: "1px solid #ccc",
            borderRadius: "8px",
            cursor: dragging ? "grabbing" : "grab",
            width: "100%",
            height: "auto",
            backgroundColor: "#f8f9fa",
          }}
        />
        <p style={{ fontSize: "11px", color: "#999", marginTop: "4px" }}>
          Scroll to zoom · Drag to pan · Animation grows a connected shape by flipping node voltages
        </p>
      </div>
    </div>
  );
}
