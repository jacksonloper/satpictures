/**
 * PathResultRenderer — Renders the orbifold grid with proposed solid/dashed
 * edge styles from the nonbranching path SAT solver.
 * Shows which edges are solid (thick dark) vs dashed (thin gray).
 * Allows the user to Accept or Reject the result.
 */
import {
  type OrbifoldGrid,
  type NodePolygon,
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

/** Compute midpoint of a polygon side (from vertex i to vertex i+1). */
function polygonSideMidpoint(polygon: NodePolygon, sideIndex: number): { x: number; y: number } {
  const i = sideIndex % polygon.length;
  const j = (sideIndex + 1) % polygon.length;
  return {
    x: (polygon[i][0] + polygon[j][0]) / 2,
    y: (polygon[i][1] + polygon[j][1]) / 2,
  };
}

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
    if (count >= 2) {
      pathNodes.add(nodeId);
    }
  }

  // Build edge line segments for visualization
  const edgeLines: Array<{
    edgeId: string;
    x1: number; y1: number;
    x2: number; y2: number;
    style: "solid" | "dashed";
  }> = [];

  for (const [edgeId, edge] of grid.edges) {
    const style = edgeStyles[edgeId] ?? "dashed";
    const entries = Array.from(edge.halfEdges.entries());

    if (entries.length === 1) {
      // Self-edge: draw from centroid through polygon side midpoints
      const [nodeId, halfEdge] = entries[0];
      const node = grid.nodes.get(nodeId);
      if (!node) continue;
      const centroid = polygonCentroid(node.polygon);
      const cx = toSvgX(centroid.x);
      const cy = toSvgY(centroid.y);
      // Draw to the first polygon side midpoint
      if (halfEdge.polygonSides.length > 0) {
        const mid = polygonSideMidpoint(node.polygon, halfEdge.polygonSides[0]);
        edgeLines.push({ edgeId, x1: cx, y1: cy, x2: toSvgX(mid.x), y2: toSvgY(mid.y), style });
      }
    } else if (entries.length === 2) {
      // Regular edge: draw between centroids
      const [nodeIdA] = entries[0];
      const [nodeIdB] = entries[1];
      const nodeA = grid.nodes.get(nodeIdA);
      const nodeB = grid.nodes.get(nodeIdB);
      if (!nodeA || !nodeB) continue;
      const centA = polygonCentroid(nodeA.polygon);
      const centB = polygonCentroid(nodeB.polygon);
      edgeLines.push({
        edgeId,
        x1: toSvgX(centA.x),
        y1: toSvgY(centA.y),
        x2: toSvgX(centB.x),
        y2: toSvgY(centB.y),
        style,
      });
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
        Solid edges form nonbranching paths/cycles. Click Accept to apply or Reject to discard.
      </p>

      <svg
        width={svgW}
        height={svgH}
        style={{ border: "1px solid #e67e22", borderRadius: "4px", marginBottom: "8px" }}
      >
        {/* Draw nodes */}
        {Array.from(grid.nodes.values()).map((node) => {
          const isOnPath = pathNodes.has(node.id);
          return (
            <g key={node.id}>
              <polygon
                points={polygonPoints(node.polygon)}
                fill={isOnPath ? "#f5b041" : "white"}
                stroke={isOnPath ? "#e67e22" : "#bdc3c7"}
                strokeWidth={isOnPath ? 2 : 1}
              />
            </g>
          );
        })}

        {/* Draw edges */}
        {edgeLines.map((edge, idx) => (
          <line
            key={`${edge.edgeId}-${idx}`}
            x1={edge.x1} y1={edge.y1}
            x2={edge.x2} y2={edge.y2}
            stroke={edge.style === "solid" ? "#2c3e50" : "#bdc3c7"}
            strokeWidth={edge.style === "solid" ? 3 : 1}
            strokeDasharray={edge.style === "dashed" ? "4,3" : undefined}
          />
        ))}
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
