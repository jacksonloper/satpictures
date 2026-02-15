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
  nodeIdFromCoord,
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
  n,
  grid,
  pathNodeIds,
  rootNodeId,
  onAccept,
  onReject,
  wallpaperGroup,
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
  const cellSize = CELL_SIZE;
  const isP4g = wallpaperGroup === "P4g";
  const gridCols = isP4g ? n + 1 : n;
  const width = gridCols * cellSize + 2 * GRID_PADDING;
  const height = n * cellSize + 2 * GRID_PADDING;

  const getOddCoord = (index: number): number => 2 * index + 1;

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
        width={width}
        height={height}
        style={{ border: "1px solid #27ae60", borderRadius: "4px", marginBottom: "8px" }}
      >
        {isP4g
          ? Array.from({ length: n }, (_, row) =>
              Array.from({ length: n + 1 }, (_, col) => {
                const x = GRID_PADDING + col * cellSize;
                const y = GRID_PADDING + row * cellSize;
                let nodeId: string;
                let nodeExists: boolean;

                if (col === 0) {
                  const diagI = 4 * row + 3;
                  const diagJ = 4 * row + 1;
                  nodeId = nodeIdFromCoord([diagI, diagJ]);
                  nodeExists = grid.nodes.has(nodeId);
                } else {
                  const gridI = 4 * col + 2;
                  const gridJ = 4 * row + 2;
                  nodeId = nodeIdFromCoord([gridI, gridJ]);
                  nodeExists = grid.nodes.has(nodeId);
                }

                const color = nodeExists ? (grid.nodes.get(nodeId)?.data?.color ?? "white") : "white";
                const stepIndex = nodeStep.get(nodeId);
                const isInPath = stepIndex !== undefined;
                const isRoot = nodeId === rootNodeId;

                return (
                  <g key={`${row}-${col}`}>
                    <rect
                      x={x} y={y} width={cellSize} height={cellSize}
                      fill={
                        !nodeExists ? "#ecf0f1" :
                        isInPath ? (isRoot ? "#f39c12" : "#27ae60") :
                        (color === "black" ? "#2c3e50" : "white")
                      }
                      stroke={isInPath ? "#1a7a1a" : "#7f8c8d"}
                      strokeWidth={isInPath ? 2 : 1}
                    />
                    {isInPath && nodeExists && (
                      <text
                        x={x + cellSize / 2} y={y + cellSize / 2}
                        textAnchor="middle" dominantBaseline="middle"
                        fontSize={14} fontWeight="bold" fill="white"
                        style={{ pointerEvents: "none" }}
                      >
                        {stepIndex}
                      </text>
                    )}
                  </g>
                );
              })
            )
          : Array.from({ length: n }, (_, row) =>
              Array.from({ length: n }, (_, col) => {
                const x = GRID_PADDING + col * cellSize;
                const y = GRID_PADDING + row * cellSize;
                const i = getOddCoord(col);
                const j = getOddCoord(row);
                const nodeId = nodeIdFromCoord([i, j]);
                const nodeExists = grid.nodes.has(nodeId);
                const color = nodeExists ? (grid.nodes.get(nodeId)?.data?.color ?? "white") : "white";
                const stepIndex = nodeStep.get(nodeId);
                const isInPath = stepIndex !== undefined;
                const isRoot = nodeId === rootNodeId;

                return (
                  <g key={`${row}-${col}`}>
                    <rect
                      x={x} y={y} width={cellSize} height={cellSize}
                      fill={
                        !nodeExists ? "#ecf0f1" :
                        isInPath ? (isRoot ? "#f39c12" : "#27ae60") :
                        (color === "black" ? "#2c3e50" : "white")
                      }
                      stroke={isInPath ? "#1a7a1a" : "#7f8c8d"}
                      strokeWidth={isInPath ? 2 : 1}
                    />
                    {isInPath && nodeExists && (
                      <text
                        x={x + cellSize / 2} y={y + cellSize / 2}
                        textAnchor="middle" dominantBaseline="middle"
                        fontSize={14} fontWeight="bold" fill="white"
                        style={{ pointerEvents: "none" }}
                      >
                        {stepIndex}
                      </text>
                    )}
                  </g>
                );
              })
            )}
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
