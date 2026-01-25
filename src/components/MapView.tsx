import React, { useMemo } from "react";
import type { ColorGrid, GridSolution, GridType } from "../problem";
import {
  getHexDimensions,
  getHexCenter,
  getCairoTile,
  createCairoTransformer,
  polyCentroid,
  calculateGridDimensions,
  DEFAULT_WALL_THICKNESS,
} from "./gridConstants";

interface MapViewProps {
  grid: ColorGrid;
  solution: GridSolution;
  cellSize?: number;
  gridType?: GridType;
}

// ============================================================================
// Types
// ============================================================================

interface NodeData {
  row: number;
  col: number;
  cx: number;
  cy: number;
  degree: number; // Number of connected edges
  connectedTo: Array<{ row: number; col: number; angle: number }>;
}

interface EdgeData {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  node1Key: string;
  node2Key: string;
  // For grids with diagonals (octagon, cairobridge)
  isDiagonal?: boolean;
  isDownSlant?: boolean; // NW-SE diagonal
}

interface RoadSegment {
  type: "straight" | "curve" | "junction";
  path: string;
  centerLinePath: string;
}

// ============================================================================
// Constants
// ============================================================================

const ROAD_COLOR = "#a0a0a0"; // Gray asphalt color
const ROAD_EDGE_COLOR = "#666666"; // Darker edge
const CENTER_LINE_COLOR = "#ffffff"; // White center line
const GRASS_COLOR = "#90c76a"; // Soft grass green
const BRIDGE_DECK_COLOR = "#b0a090"; // Light brownish for wooden bridge
const BRIDGE_SIDE_COLOR = "#8b7355"; // Darker brown for bridge sides
const BRIDGE_RAILING_COLOR = "#5c4033"; // Dark brown for railings

/**
 * Kid-friendly "map view" that renders the solution graph as roads
 * - Edges become roomy roads with dotted center lines
 * - 2-degree nodes become gentle curves
 * - 3+ degree nodes become traffic circles
 * - Crossing edges show isometric bridges
 */
export const MapView: React.FC<MapViewProps> = ({
  grid,
  solution,
  cellSize = 40,
  gridType = "square",
}) => {
  const wallThickness = DEFAULT_WALL_THICKNESS;
  
  // Calculate dimensions based on grid type
  const { hexSize, hexWidth, hexHorizSpacing, hexVertSpacing } = getHexDimensions(cellSize);
  
  const { totalWidth, totalHeight } = calculateGridDimensions(
    grid.width,
    grid.height,
    cellSize,
    gridType,
    wallThickness
  );
  
  const svgWidth = totalWidth;
  const svgHeight = totalHeight;
  const padding = wallThickness;

  // Road width is proportional to cell size - make it roomy!
  const roadWidth = cellSize * 0.45;
  const centerLineWidth = 2;
  const centerLineDash = "6,4"; // Dashed line pattern

  // Compute all visualization data
  const { nodes, roadSegments, bridges } = useMemo(() => {
    // ========================================================================
    // Step 1: Compute node positions
    // ========================================================================
    const nodeList: NodeData[] = [];
    
    if (gridType === "square") {
      for (let row = 0; row < grid.height; row++) {
        for (let col = 0; col < grid.width; col++) {
          const cx = col * cellSize + cellSize / 2;
          const cy = row * cellSize + cellSize / 2;
          nodeList.push({ row, col, cx, cy, degree: 0, connectedTo: [] });
        }
      }
    } else if (gridType === "hex") {
      for (let row = 0; row < grid.height; row++) {
        for (let col = 0; col < grid.width; col++) {
          const { cx, cy } = getHexCenter(row, col, hexWidth, hexSize, hexHorizSpacing, hexVertSpacing, padding);
          nodeList.push({ row, col, cx, cy, degree: 0, connectedTo: [] });
        }
      }
    } else if (gridType === "octagon") {
      for (let row = 0; row < grid.height; row++) {
        for (let col = 0; col < grid.width; col++) {
          const cx = padding + cellSize / 2 + col * cellSize;
          const cy = padding + cellSize / 2 + row * cellSize;
          nodeList.push({ row, col, cx, cy, degree: 0, connectedTo: [] });
        }
      }
    } else if (gridType === "cairo" || gridType === "cairobridge") {
      const availableWidth = svgWidth - 2 * padding;
      const availableHeight = svgHeight - 2 * padding;
      const toSvg = createCairoTransformer(grid.width, grid.height, availableWidth, availableHeight, padding);
      
      for (let row = 0; row < grid.height; row++) {
        for (let col = 0; col < grid.width; col++) {
          const tile = getCairoTile(row, col);
          const centroid = toSvg(polyCentroid(tile));
          nodeList.push({ row, col, cx: centroid[0], cy: centroid[1], degree: 0, connectedTo: [] });
        }
      }
    }

    // Create lookup map
    const nodeMapLocal = new Map<string, NodeData>();
    for (const node of nodeList) {
      nodeMapLocal.set(`${node.row},${node.col}`, node);
    }

    // ========================================================================
    // Step 2: Compute edges from kept edges
    // ========================================================================
    const edgeList: EdgeData[] = [];
    const processedEdges = new Set<string>();
    
    const isDiagonalEdge = (e: { u: { row: number; col: number }; v: { row: number; col: number } }) => {
      return e.u.row !== e.v.row && e.u.col !== e.v.col;
    };
    
    const isDownSlantDiagonal = (e: { u: { row: number; col: number }; v: { row: number; col: number } }) => {
      const dRow = e.v.row - e.u.row;
      const dCol = e.v.col - e.u.col;
      return (dRow > 0 && dCol > 0) || (dRow < 0 && dCol < 0);
    };
    
    for (const edge of solution.keptEdges) {
      const key1 = `${edge.u.row},${edge.u.col}-${edge.v.row},${edge.v.col}`;
      const key2 = `${edge.v.row},${edge.v.col}-${edge.u.row},${edge.u.col}`;
      
      if (processedEdges.has(key1) || processedEdges.has(key2)) continue;
      processedEdges.add(key1);
      processedEdges.add(key2);
      
      const node1 = nodeMapLocal.get(`${edge.u.row},${edge.u.col}`);
      const node2 = nodeMapLocal.get(`${edge.v.row},${edge.v.col}`);
      
      if (node1 && node2) {
        const diagonal = isDiagonalEdge(edge);
        const downSlant = diagonal ? isDownSlantDiagonal(edge) : undefined;
        
        edgeList.push({
          key: key1,
          x1: node1.cx,
          y1: node1.cy,
          x2: node2.cx,
          y2: node2.cy,
          node1Key: `${node1.row},${node1.col}`,
          node2Key: `${node2.row},${node2.col}`,
          isDiagonal: diagonal,
          isDownSlant: downSlant,
        });
        
        // Update node degrees and connections
        node1.degree++;
        node2.degree++;
        
        const angle1to2 = Math.atan2(node2.cy - node1.cy, node2.cx - node1.cx);
        const angle2to1 = Math.atan2(node1.cy - node2.cy, node1.cx - node2.cx);
        
        node1.connectedTo.push({ row: node2.row, col: node2.col, angle: angle1to2 });
        node2.connectedTo.push({ row: node1.row, col: node1.col, angle: angle2to1 });
      }
    }

    // ========================================================================
    // Step 3: Generate road segments
    // ========================================================================
    const roadSegmentList: RoadSegment[] = [];
    const halfRoad = roadWidth / 2;

    // Generate road segments for each edge
    for (const edge of edgeList) {
      const node1 = nodeMapLocal.get(edge.node1Key)!;
      const node2 = nodeMapLocal.get(edge.node2Key)!;
      
      const dx = edge.x2 - edge.x1;
      const dy = edge.y2 - edge.y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 0.001) continue;
      
      const ux = dx / len;
      const uy = dy / len;
      const perpX = -uy;
      const perpY = ux;
      
      // Shorten the road at nodes with 3+ edges (traffic circles)
      const startOffset = node1.degree >= 3 ? roadWidth * 0.8 : 0;
      const endOffset = node2.degree >= 3 ? roadWidth * 0.8 : 0;
      
      const x1Adj = edge.x1 + ux * startOffset;
      const y1Adj = edge.y1 + uy * startOffset;
      const x2Adj = edge.x2 - ux * endOffset;
      const y2Adj = edge.y2 - uy * endOffset;
      
      // Road rectangle
      const roadPath = `
        M ${x1Adj + perpX * halfRoad} ${y1Adj + perpY * halfRoad}
        L ${x2Adj + perpX * halfRoad} ${y2Adj + perpY * halfRoad}
        L ${x2Adj - perpX * halfRoad} ${y2Adj - perpY * halfRoad}
        L ${x1Adj - perpX * halfRoad} ${y1Adj - perpY * halfRoad}
        Z
      `;
      
      // Center line (dashed)
      const centerLinePath = `M ${x1Adj} ${y1Adj} L ${x2Adj} ${y2Adj}`;
      
      roadSegmentList.push({
        type: "straight",
        path: roadPath,
        centerLinePath,
      });
    }

    // Generate curves for 2-degree nodes
    for (const node of nodeList) {
      if (node.degree === 2) {
        // Gentle curve connecting two edges
        const [conn1, conn2] = node.connectedTo;
        
        // Calculate control points for a smooth curve
        const curveRadius = roadWidth * 0.8;
        
        // Points where the roads meet this node
        const p1x = node.cx + Math.cos(conn1.angle) * curveRadius;
        const p1y = node.cy + Math.sin(conn1.angle) * curveRadius;
        const p2x = node.cx + Math.cos(conn2.angle) * curveRadius;
        const p2y = node.cy + Math.sin(conn2.angle) * curveRadius;
        
        // Perpendicular vectors
        const perp1x = -Math.sin(conn1.angle);
        const perp1y = Math.cos(conn1.angle);
        const perp2x = -Math.sin(conn2.angle);
        const perp2y = Math.cos(conn2.angle);
        
        // Create curved road polygon using quadratic bezier-like approximation
        // Outer edge of curve
        const outer1x = p1x + perp1x * halfRoad;
        const outer1y = p1y + perp1y * halfRoad;
        const outer2x = p2x + perp2x * halfRoad;
        const outer2y = p2y + perp2y * halfRoad;
        
        // Inner edge of curve
        const inner1x = p1x - perp1x * halfRoad;
        const inner1y = p1y - perp1y * halfRoad;
        const inner2x = p2x - perp2x * halfRoad;
        const inner2y = p2y - perp2y * halfRoad;
        
        // Control points for the curve (at node center, pushed out)
        const outerCtrlX = node.cx + (perp1x + perp2x) * halfRoad * 0.5;
        const outerCtrlY = node.cy + (perp1y + perp2y) * halfRoad * 0.5;
        const innerCtrlX = node.cx - (perp1x + perp2x) * halfRoad * 0.5;
        const innerCtrlY = node.cy - (perp1y + perp2y) * halfRoad * 0.5;
        
        const curvePath = `
          M ${outer1x} ${outer1y}
          Q ${outerCtrlX} ${outerCtrlY} ${outer2x} ${outer2y}
          L ${inner2x} ${inner2y}
          Q ${innerCtrlX} ${innerCtrlY} ${inner1x} ${inner1y}
          Z
        `;
        
        // Center line curve
        const centerLinePath = `M ${p1x} ${p1y} Q ${node.cx} ${node.cy} ${p2x} ${p2y}`;
        
        roadSegmentList.push({
          type: "curve",
          path: curvePath,
          centerLinePath,
        });
      }
    }

    // Generate traffic circles for 3+ degree nodes
    for (const node of nodeList) {
      if (node.degree >= 3) {
        const circleRadius = roadWidth * 0.9;
        const innerRadius = circleRadius * 0.4;
        
        // Full circle for the traffic circle
        const circlePath = `
          M ${node.cx + circleRadius} ${node.cy}
          A ${circleRadius} ${circleRadius} 0 1 1 ${node.cx - circleRadius} ${node.cy}
          A ${circleRadius} ${circleRadius} 0 1 1 ${node.cx + circleRadius} ${node.cy}
          Z
          M ${node.cx + innerRadius} ${node.cy}
          A ${innerRadius} ${innerRadius} 0 1 0 ${node.cx - innerRadius} ${node.cy}
          A ${innerRadius} ${innerRadius} 0 1 0 ${node.cx + innerRadius} ${node.cy}
          Z
        `;
        
        // Center line is a circle
        const centerLinePath = `
          M ${node.cx + (circleRadius + innerRadius) / 2} ${node.cy}
          A ${(circleRadius + innerRadius) / 2} ${(circleRadius + innerRadius) / 2} 0 1 1 ${node.cx - (circleRadius + innerRadius) / 2} ${node.cy}
          A ${(circleRadius + innerRadius) / 2} ${(circleRadius + innerRadius) / 2} 0 1 1 ${node.cx + (circleRadius + innerRadius) / 2} ${node.cy}
        `;
        
        roadSegmentList.push({
          type: "junction",
          path: circlePath,
          centerLinePath,
        });
      }
    }

    // ========================================================================
    // Step 4: Generate bridges for crossing edges
    // ========================================================================
    interface BridgeData {
      deckPath: string;
      leftSidePath: string;
      rightSidePath: string;
      leftRailingPath: string;
      rightRailingPath: string;
      underEdge: EdgeData;
      overEdge: EdgeData;
    }
    
    const bridgeList: BridgeData[] = [];
    
    if (gridType === "octagon" || gridType === "cairobridge") {
      // Find crossing diagonal pairs
      const downSlantEdges = edgeList.filter(e => e.isDiagonal && e.isDownSlant);
      const upSlantEdges = edgeList.filter(e => e.isDiagonal && !e.isDownSlant);
      
      // For each up-slant edge, check if it crosses a down-slant edge
      for (const upEdge of upSlantEdges) {
        // Find if there's a down-slant edge that crosses this up-slant edge
        // They cross if they share a common center (approximately)
        
        for (const downEdge of downSlantEdges) {
          // Check if edges intersect
          const intersection = lineIntersection(
            upEdge.x1, upEdge.y1, upEdge.x2, upEdge.y2,
            downEdge.x1, downEdge.y1, downEdge.x2, downEdge.y2
          );
          
          if (intersection) {
            // Create isometric bridge
            const bridge = createIsometricBridge(upEdge, intersection, roadWidth);
            bridgeList.push({
              ...bridge,
              underEdge: downEdge,
              overEdge: upEdge,
            });
          }
        }
      }
    }

    return { 
      nodes: nodeList, 
      edges: edgeList, 
      nodeMap: nodeMapLocal, 
      roadSegments: roadSegmentList,
      bridges: bridgeList,
    };
  }, [grid, solution, cellSize, gridType, hexWidth, hexSize, hexHorizSpacing, hexVertSpacing, padding, svgWidth, svgHeight, roadWidth]);

  return (
    <div
      className="map-view-container"
      style={{
        position: "relative",
        userSelect: "none",
      }}
    >
      <svg width={svgWidth} height={svgHeight} style={{ display: "block" }}>
        {/* Background - grass */}
        <rect x={0} y={0} width={svgWidth} height={svgHeight} fill={GRASS_COLOR} />
        
        {/* Layer 1: All road segments (gray asphalt) */}
        <g className="roads">
          {roadSegments.map((segment, i) => (
            <path
              key={`road-${i}`}
              d={segment.path}
              fill={ROAD_COLOR}
              stroke={ROAD_EDGE_COLOR}
              strokeWidth={1}
            />
          ))}
        </g>
        
        {/* Layer 2: Bridge under-roads (if any) - these go under bridges */}
        {bridges.map((bridge, i) => (
          <g key={`bridge-under-${i}`}>
            {/* The road that goes under is already rendered, just add shadow */}
            <ellipse
              cx={(bridge.underEdge.x1 + bridge.underEdge.x2) / 2}
              cy={(bridge.underEdge.y1 + bridge.underEdge.y2) / 2 + 2}
              rx={roadWidth * 0.6}
              ry={roadWidth * 0.3}
              fill="rgba(0,0,0,0.2)"
            />
          </g>
        ))}
        
        {/* Layer 3: Bridge structures */}
        {bridges.map((bridge, i) => (
          <g key={`bridge-${i}`}>
            {/* Left side (3D effect) */}
            <path d={bridge.leftSidePath} fill={BRIDGE_SIDE_COLOR} />
            {/* Right side (3D effect) */}
            <path d={bridge.rightSidePath} fill={BRIDGE_SIDE_COLOR} />
            {/* Bridge deck */}
            <path d={bridge.deckPath} fill={BRIDGE_DECK_COLOR} stroke={BRIDGE_SIDE_COLOR} strokeWidth={1} />
            {/* Railings */}
            <path d={bridge.leftRailingPath} stroke={BRIDGE_RAILING_COLOR} strokeWidth={2} fill="none" />
            <path d={bridge.rightRailingPath} stroke={BRIDGE_RAILING_COLOR} strokeWidth={2} fill="none" />
          </g>
        ))}
        
        {/* Layer 4: Center lines (dashed white) */}
        <g className="center-lines">
          {roadSegments.map((segment, i) => (
            <path
              key={`centerline-${i}`}
              d={segment.centerLinePath}
              fill="none"
              stroke={CENTER_LINE_COLOR}
              strokeWidth={centerLineWidth}
              strokeDasharray={centerLineDash}
              strokeLinecap="round"
            />
          ))}
        </g>
        
        {/* Layer 5: Traffic circle centers (green grass) */}
        {nodes.filter(n => n.degree >= 3).map((node, i) => {
          const innerRadius = roadWidth * 0.9 * 0.4;
          return (
            <circle
              key={`circle-center-${i}`}
              cx={node.cx}
              cy={node.cy}
              r={innerRadius}
              fill={GRASS_COLOR}
            />
          );
        })}
        
        {/* Layer 6: Optional decorations - small trees in traffic circles */}
        {nodes.filter(n => n.degree >= 3).map((node, i) => {
          const treeRadius = roadWidth * 0.15;
          return (
            <g key={`tree-${i}`}>
              {/* Tree trunk */}
              <rect
                x={node.cx - 1.5}
                y={node.cy - 2}
                width={3}
                height={6}
                fill="#8B4513"
              />
              {/* Tree canopy */}
              <circle
                cx={node.cx}
                cy={node.cy - 4}
                r={treeRadius}
                fill="#228B22"
              />
            </g>
          );
        })}
        
        {/* Debug: Show node degrees (hidden by default) */}
        {/* {nodes.filter(n => n.degree > 0).map((node, i) => (
          <text
            key={`debug-${i}`}
            x={node.cx}
            y={node.cy}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="10"
            fill="red"
          >
            {node.degree}
          </text>
        ))} */}
      </svg>
    </div>
  );
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find intersection point of two line segments
 */
function lineIntersection(
  x1: number, y1: number, x2: number, y2: number,
  x3: number, y3: number, x4: number, y4: number
): { x: number; y: number } | null {
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 0.0001) return null; // Parallel lines
  
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
  
  // Check if intersection is within both segments
  if (t >= 0.1 && t <= 0.9 && u >= 0.1 && u <= 0.9) {
    return {
      x: x1 + t * (x2 - x1),
      y: y1 + t * (y2 - y1),
    };
  }
  return null;
}

/**
 * Create isometric bridge structure for an edge crossing another
 */
function createIsometricBridge(
  overEdge: EdgeData,
  intersection: { x: number; y: number },
  roadWidth: number
): {
  deckPath: string;
  leftSidePath: string;
  rightSidePath: string;
  leftRailingPath: string;
  rightRailingPath: string;
} {
  const dx = overEdge.x2 - overEdge.x1;
  const dy = overEdge.y2 - overEdge.y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  
  if (len < 0.001) {
    return {
      deckPath: "",
      leftSidePath: "",
      rightSidePath: "",
      leftRailingPath: "",
      rightRailingPath: "",
    };
  }
  
  const ux = dx / len;
  const uy = dy / len;
  const perpX = -uy;
  const perpY = ux;
  
  // Bridge dimensions
  const bridgeLength = roadWidth * 1.5;
  const bridgeWidth = roadWidth * 0.9;
  const bridgeHeight = roadWidth * 0.3; // Isometric height
  const railingHeight = roadWidth * 0.15;
  
  const halfLen = bridgeLength / 2;
  const halfWidth = bridgeWidth / 2;
  
  // Bridge deck corners (top surface, elevated)
  const deckCorners = [
    // Front left (closer to viewer in isometric)
    { 
      x: intersection.x - ux * halfLen - perpX * halfWidth, 
      y: intersection.y - uy * halfLen - perpY * halfWidth - bridgeHeight 
    },
    // Front right
    { 
      x: intersection.x - ux * halfLen + perpX * halfWidth, 
      y: intersection.y - uy * halfLen + perpY * halfWidth - bridgeHeight 
    },
    // Back right  
    { 
      x: intersection.x + ux * halfLen + perpX * halfWidth, 
      y: intersection.y + uy * halfLen + perpY * halfWidth - bridgeHeight 
    },
    // Back left
    { 
      x: intersection.x + ux * halfLen - perpX * halfWidth, 
      y: intersection.y + uy * halfLen - perpY * halfWidth - bridgeHeight 
    },
  ];
  
  // Side panels (3D effect) - left side
  const leftSide = [
    deckCorners[0], // Top front left
    deckCorners[3], // Top back left
    { x: deckCorners[3].x, y: deckCorners[3].y + bridgeHeight }, // Bottom back left
    { x: deckCorners[0].x, y: deckCorners[0].y + bridgeHeight }, // Bottom front left
  ];
  
  // Right side
  const rightSide = [
    deckCorners[1], // Top front right
    deckCorners[2], // Top back right
    { x: deckCorners[2].x, y: deckCorners[2].y + bridgeHeight }, // Bottom back right
    { x: deckCorners[1].x, y: deckCorners[1].y + bridgeHeight }, // Bottom front right
  ];
  
  // Create paths
  const deckPath = `M ${deckCorners[0].x} ${deckCorners[0].y} 
    L ${deckCorners[1].x} ${deckCorners[1].y} 
    L ${deckCorners[2].x} ${deckCorners[2].y} 
    L ${deckCorners[3].x} ${deckCorners[3].y} Z`;
  
  const leftSidePath = `M ${leftSide[0].x} ${leftSide[0].y} 
    L ${leftSide[1].x} ${leftSide[1].y} 
    L ${leftSide[2].x} ${leftSide[2].y} 
    L ${leftSide[3].x} ${leftSide[3].y} Z`;
  
  const rightSidePath = `M ${rightSide[0].x} ${rightSide[0].y} 
    L ${rightSide[1].x} ${rightSide[1].y} 
    L ${rightSide[2].x} ${rightSide[2].y} 
    L ${rightSide[3].x} ${rightSide[3].y} Z`;
  
  // Railings (raised lines on edges of deck)
  const leftRailingPath = `M ${deckCorners[0].x} ${deckCorners[0].y - railingHeight} 
    L ${deckCorners[3].x} ${deckCorners[3].y - railingHeight}`;
  
  const rightRailingPath = `M ${deckCorners[1].x} ${deckCorners[1].y - railingHeight} 
    L ${deckCorners[2].x} ${deckCorners[2].y - railingHeight}`;
  
  return {
    deckPath,
    leftSidePath,
    rightSidePath,
    leftRailingPath,
    rightRailingPath,
  };
}

export default MapView;
