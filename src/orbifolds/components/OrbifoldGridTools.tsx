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
  getNodeColor,
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
}: {
  n: number;
  grid: OrbifoldGrid<ColorData, EdgeStyleData>;
  tool: ToolType;
  onColorToggle: (row: number, col: number) => void;
  onInspect: (info: InspectionInfo | null) => void;
  onSetRoot?: (nodeId: OrbifoldNodeId) => void;
  inspectedNodeId: OrbifoldNodeId | null;
  rootNodeId?: OrbifoldNodeId | null;
}) {
  const cellSize = CELL_SIZE;
  const width = n * cellSize + 2 * GRID_PADDING;
  const height = n * cellSize + 2 * GRID_PADDING;

  // Get odd coord from grid index
  const getOddCoord = (index: number): number => 2 * index + 1;

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left - GRID_PADDING;
    const y = e.clientY - rect.top - GRID_PADDING;
    
    const col = Math.floor(x / cellSize);
    const row = Math.floor(y / cellSize);
    
    if (row >= 0 && row < n && col >= 0 && col < n) {
      const i = getOddCoord(col);
      const j = getOddCoord(row);
      const nodeId = nodeIdFromCoord([i, j]);
      if (!grid.nodes.has(nodeId)) {
        return;
      }
      if (tool === "color") {
        onColorToggle(row, col);
      } else if (tool === "root") {
        onSetRoot?.(nodeId);
      } else {
        // Inspect tool
        // Get edges for this node (adjacency is built during grid creation)
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
        
        onInspect({
          nodeId,
          coord: [i, j],
          edges,
        });
      }
    }
  };

  return (
    <svg
      width={width}
      height={height}
      style={{ 
        border: "1px solid #ccc", 
        borderRadius: "4px", 
        cursor: tool === "color" ? "pointer" : tool === "root" ? "cell" : "crosshair" 
      }}
      onClick={handleSvgClick}
    >
      {/* Grid cells */}
      {Array.from({ length: n }, (_, row) =>
        Array.from({ length: n }, (_, col) => {
          const x = GRID_PADDING + col * cellSize;
          const y = GRID_PADDING + row * cellSize;
          const i = getOddCoord(col);
          const j = getOddCoord(row);
          const nodeId = nodeIdFromCoord([i, j]);
          const nodeExists = grid.nodes.has(nodeId);
          const color = nodeExists ? getNodeColor(grid, row, col) : "white";
          const isInspected = nodeId === inspectedNodeId;
          const isRoot = nodeId === rootNodeId;
          
          return (
            <g key={`${row}-${col}`}>
              <rect
                x={x}
                y={y}
                width={cellSize}
                height={cellSize}
                fill={nodeExists ? (color === "black" ? "#2c3e50" : "white") : "#ecf0f1"}
                stroke={nodeExists ? (isRoot ? "#e67e22" : isInspected ? "#3498db" : "#7f8c8d") : "#bdc3c7"}
                strokeWidth={isRoot ? 3 : isInspected ? 3 : 1}
              />
              {/* Root indicator */}
              {isRoot && nodeExists && (
                <text
                  x={x + cellSize / 2}
                  y={y + cellSize / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={16}
                  fill={color === "black" ? "#f39c12" : "#e67e22"}
                  style={{ pointerEvents: "none" }}
                >
                  ◉
                </text>
              )}
              {/* Show coordinates when in inspect mode */}
              {tool === "inspect" && nodeExists && (
                <text
                  x={x + cellSize / 2}
                  y={y + cellSize / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={10}
                  fill={color === "black" ? "#ecf0f1" : "#2c3e50"}
                  fontFamily="monospace"
                >
                  {i},{j}
                </text>
              )}
            </g>
          );
        })
      )}
    </svg>
  );
}
