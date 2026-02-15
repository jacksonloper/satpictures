/**
 * Orbifold Grid Tools component - supports both color and inspect tools.
 * Renders nodes as polygons using their geometry, with thick black borders
 * for "dashed" edge style sides (walls).
 */
import {
  type OrbifoldGrid,
  type OrbifoldNodeId,
  type OrbifoldEdgeId,
  type Matrix3x3,
  type NodePolygon,
} from "../orbifoldbasics";
import {
  getEdgeLinestyle,
  type ColorData,
  type EdgeStyleData,
  type EdgeLinestyle,
} from "../createOrbifolds";

// Constants
const CELL_SIZE = 40;
const GRID_PADDING = 20;

export type ToolType = "color" | "inspect" | "root";

/**
 * Edge info for inspection display.
 */
export interface EdgeInfo {
  edgeId: OrbifoldEdgeId;
  targetNodeId: OrbifoldNodeId;
  targetCoord: readonly [number, number];
  voltage: Matrix3x3;
  linestyle: EdgeLinestyle;
}

/**
 * Information about an inspected node.
 */
export interface InspectionInfo {
  nodeId: OrbifoldNodeId;
  coord: readonly [number, number];
  edges: EdgeInfo[];
}

/** Compute centroid of a polygon. */
function polygonCentroid(polygon: NodePolygon): { x: number; y: number } {
  let cx = 0, cy = 0;
  for (const [x, y] of polygon) {
    cx += x;
    cy += y;
  }
  return { x: cx / polygon.length, y: cy / polygon.length };
}

export function OrbifoldGridTools({
  grid,
  tool,
  onColorToggle,
  onInspect,
  onSetRoot,
  inspectedNodeId,
  rootNodeId,
}: {
  n: number;
  grid: OrbifoldGrid<ColorData, EdgeStyleData>;
  tool: ToolType;
  onColorToggle: (nodeId: OrbifoldNodeId) => void;
  onInspect: (info: InspectionInfo | null) => void;
  onSetRoot?: (nodeId: OrbifoldNodeId) => void;
  inspectedNodeId: OrbifoldNodeId | null;
  rootNodeId?: OrbifoldNodeId | null;
  wallpaperGroup?: string;
}) {
  // Compute bounding box of all polygon vertices
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

  // Scale so the grid fits within a reasonable size
  // Use CELL_SIZE per 2 coordinate units (matching the standard square node size)
  const scale = CELL_SIZE / 2;
  const svgW = bboxW * scale + 2 * GRID_PADDING;
  const svgH = bboxH * scale + 2 * GRID_PADDING;

  // Transform orbifold coords to SVG coords
  const toSvgX = (x: number) => (x - minX) * scale + GRID_PADDING;
  const toSvgY = (y: number) => (y - minY) * scale + GRID_PADDING;

  // Build polygon SVG points string
  const polygonPoints = (polygon: NodePolygon): string =>
    polygon.map(([x, y]) => `${toSvgX(x)},${toSvgY(y)}`).join(" ");

  // Collect dashed-edge polygon sides:
  // For each node, gather the set of polygon side indices that have "dashed" edge style
  const dashedSides = new Map<OrbifoldNodeId, Set<number>>();
  for (const edge of grid.edges.values()) {
    const linestyle = getEdgeLinestyle(grid, edge.id);
    if (linestyle !== "dashed") continue;
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

  /**
   * Point-in-polygon test for click detection.
   */
  const pointInPolygon = (px: number, py: number, polygon: NodePolygon): boolean => {
    let inside = false;
    const n2 = polygon.length;
    for (let i = 0, j = n2 - 1; i < n2; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  };

  /**
   * Find which node was clicked at SVG coordinates.
   */
  const findClickedNode = (svgX: number, svgY: number): { nodeId: OrbifoldNodeId; coord: readonly [number, number] } | null => {
    // Convert SVG coords back to orbifold coords
    const ox = (svgX - GRID_PADDING) / scale + minX;
    const oy = (svgY - GRID_PADDING) / scale + minY;

    for (const node of grid.nodes.values()) {
      if (pointInPolygon(ox, oy, node.polygon)) {
        return { nodeId: node.id, coord: node.coord };
      }
    }
    return null;
  };

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const svgX = e.clientX - rect.left;
    const svgY = e.clientY - rect.top;

    const hit = findClickedNode(svgX, svgY);
    if (!hit) return;

    const { nodeId, coord } = hit;

    if (tool === "color") {
      onColorToggle(nodeId);
    } else if (tool === "root") {
      onSetRoot?.(nodeId);
    } else {
      // Inspect tool
      const edgeIds = grid.adjacency?.get(nodeId) ?? [];
      const edges: EdgeInfo[] = [];

      for (const edgeId of edgeIds) {
        const edge = grid.edges.get(edgeId);
        if (!edge) continue;
        const halfEdge = edge.halfEdges.get(nodeId);
        if (!halfEdge) continue;
        const targetNode = grid.nodes.get(halfEdge.to);
        if (!targetNode) continue;
        edges.push({
          edgeId,
          targetNodeId: halfEdge.to,
          targetCoord: targetNode.coord,
          voltage: halfEdge.voltage,
          linestyle: getEdgeLinestyle(grid, edgeId),
        });
      }

      onInspect({ nodeId, coord, edges });
    }
  };

  return (
    <svg
      width={svgW}
      height={svgH}
      style={{
        border: "1px solid #ccc",
        borderRadius: "4px",
        cursor: tool === "color" ? "pointer" : tool === "root" ? "cell" : "crosshair",
      }}
      onClick={handleSvgClick}
    >
      {/* Render node polygons */}
      {Array.from(grid.nodes.values()).map((node) => {
        const color = node.data?.color ?? "white";
        const isInspected = node.id === inspectedNodeId;
        const isRoot = node.id === rootNodeId;
        const centroid = polygonCentroid(node.polygon);
        const cx = toSvgX(centroid.x);
        const cy = toSvgY(centroid.y);

        return (
          <g key={node.id}>
            {/* Polygon fill with faint gray outline */}
            <polygon
              points={polygonPoints(node.polygon)}
              fill={color === "black" ? "#999" : "#eee"}
              stroke={isRoot ? "#e67e22" : isInspected ? "#3498db" : "#ddd"}
              strokeWidth={isRoot || isInspected ? 2 : 0.5}
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
            {/* Root marker */}
            {isRoot && (
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={16}
                fill={color === "black" ? "#f39c12" : "#e67e22"}
                style={{ pointerEvents: "none" }}
              >
                ◉
              </text>
            )}
            {/* Coordinate label (inspect mode or always visible) */}
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={node.polygon.length < 4 ? 8 : 10}
              fill={color === "black" ? "#ddd" : "#999"}
              fontFamily="monospace"
              style={{ pointerEvents: "none" }}
            >
              {node.coord[0]},{node.coord[1]}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
