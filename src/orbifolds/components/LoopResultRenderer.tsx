/**
 * LoopResultRenderer - Renders the orbifold grid with each node numbered by
 * its order in a found loop path. Allows the user to Accept or Reject the result.
 *
 * When there are multi-edges (multiple orbifold edges connecting the same pair
 * of consecutive nodes), the user can select which edge to use at each choice
 * point.  The final voltage (product of all selected edge voltages along the
 * loop) is displayed.
 */
import { useState, useMemo } from "react";
import {
  type OrbifoldGrid,
  type OrbifoldNodeId,
  type OrbifoldEdgeId,
  type Matrix3x3,
  type NodePolygon,
  matMul,
  I3,
  formatVoltage,
  rootOfUnityOrder,
} from "../orbifoldbasics";
import {
  type ColorData,
  type EdgeStyleData,
} from "../createOrbifolds";

// Constants (matching OrbifoldGridTools)
const CELL_SIZE = 40;
const GRID_PADDING = 20;

/** Compute centroid of a polygon. */
function polygonCentroid(polygon: NodePolygon): { x: number; y: number } {
  let cx = 0, cy = 0;
  for (const [x, y] of polygon) {
    cx += x;
    cy += y;
  }
  return { x: cx / polygon.length, y: cy / polygon.length };
}

/** Info about a single step in the loop path. */
interface StepEdgeInfo {
  /** Index of this step (t → t+1) */
  stepIndex: number;
  /** Source node id */
  from: string;
  /** Target node id */
  to: string;
  /** Orbifold edge IDs that connect this pair */
  edgeIds: OrbifoldEdgeId[];
}

/**
 * For each step in the path, find all orbifold edges connecting the
 * consecutive pair of nodes.
 */
function buildStepEdges(
  pathNodeIds: string[],
  grid: OrbifoldGrid<ColorData, EdgeStyleData>,
): StepEdgeInfo[] {
  const steps: StepEdgeInfo[] = [];

  for (let t = 0; t < pathNodeIds.length - 1; t++) {
    const from = pathNodeIds[t];
    const to = pathNodeIds[t + 1];

    // Find all edges connecting `from` and `to`
    const edgeIds: OrbifoldEdgeId[] = [];
    for (const [edgeId, edge] of grid.edges) {
      const half = edge.halfEdges.get(from);
      if (half && half.to === to) {
        edgeIds.push(edgeId);
      }
    }

    steps.push({ stepIndex: t, from, to, edgeIds });
  }

  return steps;
}

/**
 * Compute the product of voltages along the path for the given edge
 * selections.  For each step t, the voltage is taken from the half-edge
 * of the selected edge that starts at `pathNodeIds[t]`.
 */
function computeLoopVoltage(
  steps: StepEdgeInfo[],
  selections: string[],
  grid: OrbifoldGrid<ColorData, EdgeStyleData>,
): Matrix3x3 {
  let product: Matrix3x3 = I3;
  for (let t = 0; t < steps.length; t++) {
    const edgeId = selections[t];
    const edge = grid.edges.get(edgeId);
    if (!edge) continue;
    const half = edge.halfEdges.get(steps[t].from);
    if (!half) continue;
    product = matMul(product, half.voltage);
  }
  return product;
}

export function LoopResultRenderer({
  grid,
  pathNodeIds,
  rootNodeId,
  onAccept,
  onReject,
}: {
  n: number;
  grid: OrbifoldGrid<ColorData, EdgeStyleData>;
  /** Ordered node IDs in path (step 0 = root, last step = root) */
  pathNodeIds: string[];
  rootNodeId: OrbifoldNodeId;
  onAccept: (selectedEdgeIds: string[]) => void;
  onReject: () => void;
  wallpaperGroup?: string;
}) {
  // Build step-edge info and identify choice points
  const steps = useMemo(
    () => buildStepEdges(pathNodeIds, grid),
    [pathNodeIds, grid],
  );

  // Initialise selections: first available edge for each step
  const [selections, setSelections] = useState<string[]>(() =>
    steps.map((s) => s.edgeIds[0] ?? ""),
  );

  // Recompute voltage whenever selections change
  const loopVoltage = useMemo(
    () => computeLoopVoltage(steps, selections, grid),
    [steps, selections, grid],
  );

  // Check whether the voltage is a root of unity (V^k = I for small k)
  const MAX_ROOT_CHECK = 8;
  const unityOrder = useMemo(
    () => rootOfUnityOrder(loopVoltage, MAX_ROOT_CHECK),
    [loopVoltage],
  );

  // Steps that have more than one edge option (choice points)
  const choiceSteps = useMemo(
    () => steps.filter((s) => s.edgeIds.length > 1),
    [steps],
  );

  // Build a map from nodeId -> step index (first occurrence, excluding the final root)
  const nodeStep = new Map<string, number>();
  for (let t = 0; t < pathNodeIds.length - 1; t++) {
    if (!nodeStep.has(pathNodeIds[t])) {
      nodeStep.set(pathNodeIds[t], t);
    }
  }

  // Compute bounding box of all polygon vertices (sketchpad layout)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of grid.nodes.values()) {
    for (const [x, y] of node.polygon) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const bboxW = maxX - minX;
  const bboxH = maxY - minY;

  const scale = CELL_SIZE / 2;
  const svgW = bboxW * scale + 2 * GRID_PADDING;
  const svgH = bboxH * scale + 2 * GRID_PADDING;

  const toSvgX = (x: number) => (x - minX) * scale + GRID_PADDING;
  const toSvgY = (y: number) => (y - minY) * scale + GRID_PADDING;

  const polygonPoints = (polygon: NodePolygon): string =>
    polygon.map(([x, y]) => `${toSvgX(x)},${toSvgY(y)}`).join(" ");

  return (
    <div style={{
      marginBottom: "10px",
      padding: "12px",
      backgroundColor: "#eaf7ea",
      borderRadius: "8px",
      border: "2px solid #27ae60",
    }}>
      <h4 style={{ marginBottom: "8px", color: "#27ae60" }}>
        🔄 Loop Found ({pathNodeIds.length - 1} nodes)
      </h4>
      <p style={{ fontSize: "12px", color: "#555", marginBottom: "8px" }}>
        Numbers show the visit order. Click Accept to apply (solid = loop edges, dashed = others) or Reject to keep current edge styles.
      </p>

      <svg
        width={svgW}
        height={svgH}
        style={{ border: "1px solid #27ae60", borderRadius: "4px", marginBottom: "8px" }}
      >
        {Array.from(grid.nodes.values()).map((node) => {
          const color = node.data?.color ?? "white";
          const stepIndex = nodeStep.get(node.id);
          const isInPath = stepIndex !== undefined;
          const isRoot = node.id === rootNodeId;
          const centroid = polygonCentroid(node.polygon);
          const cx = toSvgX(centroid.x);
          const cy = toSvgY(centroid.y);

          return (
            <g key={node.id}>
              <polygon
                points={polygonPoints(node.polygon)}
                fill={
                  isInPath ? (isRoot ? "#f39c12" : "#27ae60") :
                  (color === "black" ? "#2c3e50" : "white")
                }
                stroke={isInPath ? "#1a7a1a" : "#7f8c8d"}
                strokeWidth={isInPath ? 2 : 1}
              />
              {isInPath && (
                <text
                  x={cx} y={cy}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={node.polygon.length < 4 ? 10 : 14} fontWeight="bold" fill="white"
                  style={{ pointerEvents: "none" }}
                >
                  {stepIndex}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Multi-edge choice selectors */}
      {choiceSteps.length > 0 && (
        <div style={{ marginBottom: "8px" }}>
          <p style={{ fontSize: "12px", fontWeight: "bold", color: "#555", marginBottom: "4px" }}>
            Edge choices (multi-edges):
          </p>
          {choiceSteps.map((step) => (
            <div key={step.stepIndex} style={{ marginBottom: "4px", fontSize: "12px" }}>
              <label>
                Step {step.stepIndex}→{step.stepIndex + 1}{" "}
                ({step.from} → {step.to}):{" "}
                <select
                  value={selections[step.stepIndex]}
                  onChange={(e) => {
                    setSelections((prev) => {
                      const next = [...prev];
                      next[step.stepIndex] = e.target.value;
                      return next;
                    });
                  }}
                  style={{ fontSize: "12px" }}
                >
                  {step.edgeIds.map((edgeId) => (
                    <option key={edgeId} value={edgeId}>
                      {edgeId}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
        </div>
      )}

      {/* Final voltage display */}
      <div style={{
        marginBottom: "8px",
        padding: "6px 8px",
        backgroundColor: "#fff",
        border: "1px solid #bdc3c7",
        borderRadius: "4px",
        fontSize: "12px",
        fontFamily: "monospace",
        overflowX: "auto",
      }}>
        <span style={{ fontWeight: "bold" }}>Final voltage: </span>
        {formatVoltage(loopVoltage)}
        <br />
        {unityOrder !== null
          ? <span style={{ color: "#27ae60" }}>voltage^{unityOrder} = I</span>
          : <span style={{ color: "#e67e22" }}>voltage^k ≠ I for any positive integer k ≤ {MAX_ROOT_CHECK}</span>
        }
      </div>

      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={() => onAccept(selections)}
          style={{
            padding: "6px 16px",
            borderRadius: "4px",
            border: "1px solid #27ae60",
            backgroundColor: "#27ae60",
            color: "white",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          ✓ Accept
        </button>
        <button
          onClick={onReject}
          style={{
            padding: "6px 16px",
            borderRadius: "4px",
            border: "1px solid #e74c3c",
            backgroundColor: "#fadbd8",
            color: "#c0392b",
            cursor: "pointer",
          }}
        >
          ✗ Reject
        </button>
      </div>
    </div>
  );
}
