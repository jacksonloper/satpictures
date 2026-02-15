/**
 * Orbifold Grid Tools component - supports both color and inspect tools.
 */
import {
  type OrbifoldGrid,
  type OrbifoldNodeId,
  type OrbifoldEdgeId,
  type Matrix3x3,
  nodeIdFromCoord,
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

export function OrbifoldGridTools({
  n,
  grid,
  tool,
  onColorToggle,
  onInspect,
  onSetRoot,
  inspectedNodeId,
  rootNodeId,
  wallpaperGroup,
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
  const cellSize = CELL_SIZE;
  const isP4g = wallpaperGroup === "P4g";

  // For P4g, the grid is (n+1) cells wide and (n) cells tall to accommodate
  // the upper triangle grid nodes plus diagonal half-triangle nodes.
  const gridCols = isP4g ? n + 1 : n;
  const gridRows = n;
  const width = gridCols * cellSize + 2 * GRID_PADDING;
  const height = gridRows * cellSize + 2 * GRID_PADDING;

  /**
   * Find which node (if any) was clicked at (pixelX, pixelY) relative to the SVG padding.
   * For P4g, col=0 contains diagonal half-triangle nodes, cols 1..n contain grid nodes.
   * For other groups, standard n×n grid with odd coordinates.
   */
  const findClickedNode = (pixelX: number, pixelY: number): { nodeId: OrbifoldNodeId; coord: readonly [number, number] } | null => {
    if (isP4g) {
      const col = Math.floor(pixelX / cellSize);
      const row = Math.floor(pixelY / cellSize);
      if (row < 0 || row >= n || col < 0 || col >= n + 1) return null;

      if (col === 0) {
        // Diagonal half-triangle column: node k=row at (4*row+3, 4*row+1)
        const diagI = 4 * row + 3;
        const diagJ = 4 * row + 1;
        const nodeId = nodeIdFromCoord([diagI, diagJ]);
        if (grid.nodes.has(nodeId)) return { nodeId, coord: [diagI, diagJ] };
        return null;
      } else {
        // Grid node column: col index maps to grid col = col (col >= 1)
        // Grid node at (4*gridCol+2, 4*row+2) where gridCol = col
        const gridCol = col;
        const gridI = 4 * gridCol + 2;
        const gridJ = 4 * row + 2;
        const nodeId = nodeIdFromCoord([gridI, gridJ]);
        if (grid.nodes.has(nodeId)) return { nodeId, coord: [gridI, gridJ] };
        return null;
      }
    } else {
      const col = Math.floor(pixelX / cellSize);
      const row = Math.floor(pixelY / cellSize);
      if (row < 0 || row >= n || col < 0 || col >= n) return null;
      const i = 2 * col + 1;
      const j = 2 * row + 1;
      const nodeId = nodeIdFromCoord([i, j]);
      if (grid.nodes.has(nodeId)) return { nodeId, coord: [i, j] };
      return null;
    }
  };

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const pixelX = e.clientX - rect.left - GRID_PADDING;
    const pixelY = e.clientY - rect.top - GRID_PADDING;

    const hit = findClickedNode(pixelX, pixelY);
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

  /**
   * Render a single cell (rect + optional labels) for a given node.
   */
  const renderCell = (
    key: string,
    x: number,
    y: number,
    w: number,
    h: number,
    nodeId: OrbifoldNodeId | null,
    nodeExists: boolean,
    coord: readonly [number, number] | null,
  ) => {
    const color = nodeExists && nodeId ? (grid.nodes.get(nodeId)?.data?.color ?? "white") : "white";
    const isInspected = nodeId === inspectedNodeId;
    const isRoot = nodeId === rootNodeId;

    return (
      <g key={key}>
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          fill={nodeExists ? (color === "black" ? "#2c3e50" : "white") : "#ecf0f1"}
          stroke={nodeExists ? (isRoot ? "#e67e22" : isInspected ? "#3498db" : "#7f8c8d") : "#bdc3c7"}
          strokeWidth={isRoot ? 3 : isInspected ? 3 : 1}
        />
        {isRoot && nodeExists && (
          <text
            x={x + w / 2}
            y={y + h / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={16}
            fill={color === "black" ? "#f39c12" : "#e67e22"}
            style={{ pointerEvents: "none" }}
          >
            ◉
          </text>
        )}
        {tool === "inspect" && nodeExists && coord && (
          <text
            x={x + w / 2}
            y={y + h / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={w < cellSize ? 8 : 10}
            fill={color === "black" ? "#ecf0f1" : "#2c3e50"}
            fontFamily="monospace"
          >
            {coord[0]},{coord[1]}
          </text>
        )}
      </g>
    );
  };

  return (
    <svg
      width={width}
      height={height}
      style={{
        border: "1px solid #ccc",
        borderRadius: "4px",
        cursor: tool === "color" ? "pointer" : tool === "root" ? "cell" : "crosshair",
      }}
      onClick={handleSvgClick}
    >
      {isP4g
        ? /* P4g layout: col 0 = diagonal nodes, cols 1..n = grid nodes */
          Array.from({ length: n }, (_, row) =>
            Array.from({ length: n + 1 }, (_, col) => {
              const x = GRID_PADDING + col * cellSize;
              const y = GRID_PADDING + row * cellSize;

              if (col === 0) {
                // Diagonal half-triangle node
                const diagI = 4 * row + 3;
                const diagJ = 4 * row + 1;
                const nodeId = nodeIdFromCoord([diagI, diagJ]);
                const nodeExists = grid.nodes.has(nodeId);
                return renderCell(`diag-${row}`, x, y, cellSize, cellSize, nodeId, nodeExists, [diagI, diagJ]);
              } else {
                // Grid node at (4*col+2, 4*row+2)
                const gridCol = col;
                const gridI = 4 * gridCol + 2;
                const gridJ = 4 * row + 2;
                const nodeId = nodeIdFromCoord([gridI, gridJ]);
                const nodeExists = grid.nodes.has(nodeId);
                return renderCell(`grid-${row}-${gridCol}`, x, y, cellSize, cellSize, nodeId, nodeExists, [gridI, gridJ]);
              }
            })
          )
        : /* Standard n×n grid layout */
          Array.from({ length: n }, (_, row) =>
            Array.from({ length: n }, (_, col) => {
              const x = GRID_PADDING + col * cellSize;
              const y = GRID_PADDING + row * cellSize;
              const i = 2 * col + 1;
              const j = 2 * row + 1;
              const nodeId = nodeIdFromCoord([i, j]);
              const nodeExists = grid.nodes.has(nodeId);
              return renderCell(`${row}-${col}`, x, y, cellSize, cellSize, nodeId, nodeExists, [i, j]);
            })
          )}
    </svg>
  );
}
