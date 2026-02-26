/**
 * PathResultRenderer — Renders the orbifold grid with proposed solid/dashed
 * edge styles from the nonbranching path SAT solver.
 * Shows walls (thick black lines on polygon sides for dashed edges),
 * matching the OrbifoldGridTools wall rendering.
 * Allows the user to Accept or Reject the result.
 */
import {
  type OrbifoldGrid,
  type OrbifoldNodeId,
  type NodePolygon,
} from "../orbifoldbasics";
import {
  type ColorData,
  type EdgeStyleData,
} from "../createOrbifolds";

// Constants (matching OrbifoldGridTools)
const CELL_SIZE = 40;
const GRID_PADDING = 20;

export function PathResultRenderer({
  grid,
  edgeStyles,
  pathNodeCount,
  onAccept,
  onReject,
  wallpaperGroup,
}: {
  grid: OrbifoldGrid<ColorData, EdgeStyleData>;
  /** Proposed solid/dashed assignment for each edge */
  edgeStyles: Record<string, "solid" | "dashed">;
  /** Number of nodes on the paths */
  pathNodeCount: number;
  onAccept: () => void;
  onReject: () => void;
  wallpaperGroup?: string;
}) {
  // Groups with doubled coordinate systems need halved visual scale
  const isDoubled = wallpaperGroup === "P3" || wallpaperGroup === "P4" || wallpaperGroup === "P4g" || wallpaperGroup === "P6";

  // Compute bounding box
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
  const scale = isDoubled ? CELL_SIZE / 4 : CELL_SIZE / 2;
  const svgW = bboxW * scale + 2 * GRID_PADDING;
  const svgH = bboxH * scale + 2 * GRID_PADDING;

  const toSvgX = (x: number) => (x - minX) * scale + GRID_PADDING;
  const toSvgY = (y: number) => (y - minY) * scale + GRID_PADDING;

  const polygonPoints = (polygon: NodePolygon): string =>
    polygon.map(([x, y]) => `${toSvgX(x)},${toSvgY(y)}`).join(" ");

  // Determine which nodes have exactly 2 solid edges (path nodes)
  const pathNodes = new Set<string>();
  const nodeEdgeCount = new Map<string, number>();
  for (const [edgeId, edge] of grid.edges) {
    const style = edgeStyles[edgeId];
    if (style === "solid") {
      for (const nodeId of edge.halfEdges.keys()) {
        nodeEdgeCount.set(nodeId, (nodeEdgeCount.get(nodeId) ?? 0) + 1);
      }
    }
  }
  for (const [nodeId, count] of nodeEdgeCount) {
    if (count === 2) {
      pathNodes.add(nodeId);
    }
  }

  // Collect dashed-edge polygon sides (walls) — same pattern as OrbifoldGridTools
  const dashedSides = new Map<OrbifoldNodeId, Set<number>>();
  for (const edge of grid.edges.values()) {
    const style = edgeStyles[edge.id] ?? "dashed";
    if (style !== "dashed") continue;
    for (const [nodeId, halfEdge] of edge.halfEdges) {
      let set = dashedSides.get(nodeId);
      if (!set) {
        set = new Set();
        dashedSides.set(nodeId, set);
      }
      for (const side of halfEdge.polygonSides) {
        set.add(side);
      }
    }
  }

  return (
    <div style={{
      marginBottom: "10px",
      padding: "12px",
      backgroundColor: "#fef9e7",
      borderRadius: "8px",
      border: "2px solid #e67e22",
    }}>
      <h4 style={{ marginBottom: "8px", color: "#e67e22" }}>
        🛤️ Nonbranching Paths Found ({pathNodeCount} nodes)
      </h4>
      <p style={{ fontSize: "12px", color: "#555", marginBottom: "8px" }}>
        Walls show dashed edges. Click Accept to apply or Reject to discard.
      </p>

      <svg
        width={svgW}
        height={svgH}
        style={{ border: "1px solid #e67e22", borderRadius: "4px", marginBottom: "8px" }}
      >
        {/* Draw nodes */}
        {Array.from(grid.nodes.values()).map((node) => {
          const isOnPath = pathNodes.has(node.id);
          const color = node.data?.color ?? "white";
          return (
            <g key={node.id}>
              <polygon
                points={polygonPoints(node.polygon)}
                fill={color === "black" ? "#2c3e50" : (isOnPath ? "#f5b041" : "white")}
                stroke={isOnPath ? "#e67e22" : "#bdc3c7"}
                strokeWidth={isOnPath ? 2 : 1}
              />
              {/* Thick black lines for dashed-edge polygon sides (walls) */}
              {dashedSides.has(node.id) &&
                Array.from(dashedSides.get(node.id)!).map((sideIdx) => {
                  const p1 = node.polygon[sideIdx];
                  const p2 = node.polygon[(sideIdx + 1) % node.polygon.length];
                  return (
                    <line
                      key={`wall-${node.id}-${sideIdx}`}
                      x1={toSvgX(p1[0])}
                      y1={toSvgY(p1[1])}
                      x2={toSvgX(p2[0])}
                      y2={toSvgY(p2[1])}
                      stroke="black"
                      strokeWidth={3}
                      strokeLinecap="round"
                    />
                  );
                })}
            </g>
          );
        })}
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
