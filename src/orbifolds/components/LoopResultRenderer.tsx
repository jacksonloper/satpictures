/**
 * LoopResultRenderer - Renders the orbifold grid with each node numbered by
 * its order in a found loop path. Allows the user to Accept or Reject the result.
 */
import {
  type OrbifoldGrid,
  type OrbifoldNodeId,
  nodeIdFromCoord,
} from "../orbifoldbasics";
import {
  getNodeColor,
  type ColorData,
  type EdgeStyleData,
} from "../createOrbifolds";

// Constants (matching OrbifoldGridTools)
const CELL_SIZE = 40;
const GRID_PADDING = 20;

export function LoopResultRenderer({
  n,
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
  onAccept: () => void;
  onReject: () => void;
}) {
  const cellSize = CELL_SIZE;
  const width = n * cellSize + 2 * GRID_PADDING;
  const height = n * cellSize + 2 * GRID_PADDING;

  const getOddCoord = (index: number): number => 2 * index + 1;

  // Build a map from nodeId -> step index (first occurrence, excluding the final root)
  // For display: step 0 = root (start), steps 1..(L-2) = intermediate, step L-1 = root (end, shown as "→0")
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
        🔄 Loop Found (length {pathNodeIds.length})
      </h4>
      <p style={{ fontSize: "12px", color: "#555", marginBottom: "8px" }}>
        Numbers show the visit order. Click Accept to apply (solid = loop edges, dashed = others) or Reject to keep current edge styles.
      </p>

      <svg
        width={width}
        height={height}
        style={{ border: "1px solid #27ae60", borderRadius: "4px", marginBottom: "8px" }}
      >
        {Array.from({ length: n }, (_, row) =>
          Array.from({ length: n }, (_, col) => {
            const x = GRID_PADDING + col * cellSize;
            const y = GRID_PADDING + row * cellSize;
            const i = getOddCoord(col);
            const j = getOddCoord(row);
            const nodeId = nodeIdFromCoord([i, j]);
            const nodeExists = grid.nodes.has(nodeId);
            const color = nodeExists ? getNodeColor(grid, row, col) : "white";
            const stepIndex = nodeStep.get(nodeId);
            const isInPath = stepIndex !== undefined;
            const isRoot = nodeId === rootNodeId;

            return (
              <g key={`${row}-${col}`}>
                <rect
                  x={x}
                  y={y}
                  width={cellSize}
                  height={cellSize}
                  fill={
                    !nodeExists ? "#ecf0f1" :
                    isInPath ? (isRoot ? "#f39c12" : "#27ae60") :
                    (color === "black" ? "#2c3e50" : "white")
                  }
                  stroke={isInPath ? "#1a7a1a" : "#7f8c8d"}
                  strokeWidth={isInPath ? 2 : 1}
                />
                {/* Step number */}
                {isInPath && nodeExists && (
                  <text
                    x={x + cellSize / 2}
                    y={y + cellSize / 2}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontSize={14}
                    fontWeight="bold"
                    fill="white"
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

      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={onAccept}
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
