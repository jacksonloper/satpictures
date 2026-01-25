import React, { useCallback, useMemo, useState } from "react";
import type { ColorGrid, GridSolution, GridType, PathlengthConstraint, ColorRoots } from "../problem";
import { HATCH_COLOR } from "../problem";
import {
  COLORS,
  HATCH_BG_COLOR,
  BLANK_COLOR,
  WALL_COLOR,
  DEFAULT_WALL_THICKNESS,
  getHexDimensions,
  getHexNeighbors,
  createHexPath,
  getHexCenter,
  getHexWallSegment,
  getOctagonDimensions,
  createOctagonPath,
  getCairoTile,
  getCairoNeighborsWithDirection,
  getCairoBridgeNeighborsWithDirection,
  findSharedEdge,
  createCairoTransformer,
  polyCentroid,
  calculateGridDimensions,
} from "./gridConstants";

// Re-export color constants for convenience
export { HATCH_COLOR };
// Re-export COLORS for components that need it
export { COLORS };

// Blank cell appearance
const BLANK_PATTERN = `repeating-linear-gradient(
  45deg,
  #e0e0e0,
  #e0e0e0 2px,
  #f5f5f5 2px,
  #f5f5f5 8px
)`;

// Hatch cell appearance - crosshatch pattern on yellow background
const HATCH_PATTERN = `repeating-linear-gradient(
  45deg,
  #ff9800,
  #ff9800 2px,
  transparent 2px,
  transparent 8px
),
repeating-linear-gradient(
  -45deg,
  #ff9800,
  #ff9800 2px,
  transparent 2px,
  transparent 8px
),
${HATCH_BG_COLOR}`;

interface GridProps {
  grid: ColorGrid;
  solution: GridSolution | null;
  selectedColor: number | null;
  onCellClick: (row: number, col: number) => void;
  onCellDrag: (row: number, col: number) => void;
  cellSize?: number;
  gridType?: GridType;
  viewMode?: "sketchpad" | "solution";
  showDistanceLevels?: boolean;
  selectedConstraintId?: string | null;
  graphMode?: boolean;
  colorRoots?: ColorRoots;
  distanceConstraint?: PathlengthConstraint;
}

export const Grid: React.FC<GridProps> = ({
  grid,
  solution,
  selectedColor: _selectedColor,
  onCellClick,
  onCellDrag,
  cellSize = 40,
  gridType = "square",
  viewMode = "sketchpad",
  showDistanceLevels = false,
  selectedConstraintId = null,
  graphMode = false,
  colorRoots = {},
  distanceConstraint,
}) => {
  // selectedColor is used by parent for painting, not needed here directly
  void _selectedColor;
  const [isDragging, setIsDragging] = useState(false);

  // Determine if we should show solution colors (when viewing solution mode and solution exists)
  const showSolutionColors = viewMode === "solution" && solution !== null;

  // Helper to check if a cell is a root for its color
  const isRootCell = useCallback(
    (row: number, col: number): boolean => {
      const cellColor = grid.colors[row][col];
      if (cellColor === null || cellColor === HATCH_COLOR || cellColor < 0) {
        return false;
      }
      const root = colorRoots[String(cellColor)];
      return root !== undefined && root.row === row && root.col === col;
    },
    [grid.colors, colorRoots]
  );

  // Helper to get distance level for a cell
  const getDistanceLevel = useCallback(
    (row: number, col: number): number | null => {
      if (!showDistanceLevels || !selectedConstraintId || !solution?.distanceLevels?.[selectedConstraintId]) {
        return null;
      }
      return solution.distanceLevels[selectedConstraintId][row][col];
    },
    [showDistanceLevels, selectedConstraintId, solution]
  );

  // Helper to get min distance constraint for a cell (from sketchpad constraint)
  const getMinDistanceConstraint = useCallback(
    (row: number, col: number): number | null => {
      if (!distanceConstraint?.minDistances) {
        return null;
      }
      const cellKey = `${row},${col}`;
      return distanceConstraint.minDistances[cellKey] ?? null;
    },
    [distanceConstraint]
  );

  // Create a set of kept edge keys for quick lookup
  const keptEdgeSet = useMemo(() => {
    const set = new Set<string>();
    if (solution) {
      for (const edge of solution.keptEdges) {
        // Store both directions for easy lookup
        set.add(`${edge.u.row},${edge.u.col}-${edge.v.row},${edge.v.col}`);
        set.add(`${edge.v.row},${edge.v.col}-${edge.u.row},${edge.u.col}`);
      }
    }
    return set;
  }, [solution]);

  const handleMouseDown = useCallback(
    (row: number, col: number) => {
      setIsDragging(true);
      onCellClick(row, col);
    },
    [onCellClick]
  );

  const handleMouseEnter = useCallback(
    (row: number, col: number) => {
      if (isDragging) {
        onCellDrag(row, col);
      }
    },
    [isDragging, onCellDrag]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Check if there should be a wall between two adjacent cells
  const hasWall = useCallback(
    (r1: number, c1: number, r2: number, c2: number): boolean => {
      if (!solution) {
        // No solution yet - don't show any internal walls
        // Only show walls at grid boundary
        return !(r2 >= 0 && r2 < grid.height && c2 >= 0 && c2 < grid.width);
      }
      // With solution - check if edge is kept (no wall) or blocked (wall)
      const key = `${r1},${c1}-${r2},${c2}`;
      return !keptEdgeSet.has(key);
    },
    [solution, keptEdgeSet, grid]
  );

  const wallThickness = DEFAULT_WALL_THICKNESS;
  
  // Hex grid calculations
  const { hexSize, hexWidth, hexHorizSpacing, hexVertSpacing } = getHexDimensions(cellSize);

  // Octagon grid calculations
  const { octInset, octBandWidth } = getOctagonDimensions(cellSize);
  
  // Calculate total dimensions based on grid type
  const { totalWidth, totalHeight } = calculateGridDimensions(
    grid.width,
    grid.height,
    cellSize,
    gridType,
    wallThickness
  );

  // Graph mode rendering - shows edges as lines and nodes as small dots
  if (graphMode && solution) {
    const svgWidth = totalWidth;
    const svgHeight = totalHeight;
    const padding = wallThickness;
    // Graph mode sizing constants (as fractions of cellSize)
    const GRAPH_NODE_RADIUS_RATIO = 0.08; // Small dots for nodes
    const GRAPH_EDGE_WIDTH_RATIO = 0.06; // Thin lines for edges
    const nodeRadius = cellSize * GRAPH_NODE_RADIUS_RATIO;
    const edgeWidth = cellSize * GRAPH_EDGE_WIDTH_RATIO;
    
    // Helper to get display color for a cell
    const getNodeColor = (row: number, col: number): string => {
      const displayColor = solution.assignedColors[row][col];
      const isHatch = displayColor === HATCH_COLOR;
      
      if (isHatch) {
        return "#ff9800"; // Orange for hatch
      } else {
        return COLORS[(displayColor ?? 0) % COLORS.length];
      }
    };
    
    // Compute node centroids based on grid type
    interface NodeData {
      row: number;
      col: number;
      cx: number;
      cy: number;
      color: string;
    }
    
    const nodes: NodeData[] = [];
    
    if (gridType === "square") {
      for (let row = 0; row < grid.height; row++) {
        for (let col = 0; col < grid.width; col++) {
          const cx = col * cellSize + cellSize / 2;
          const cy = row * cellSize + cellSize / 2;
          nodes.push({ row, col, cx, cy, color: getNodeColor(row, col) });
        }
      }
    } else if (gridType === "hex") {
      for (let row = 0; row < grid.height; row++) {
        for (let col = 0; col < grid.width; col++) {
          const { cx, cy } = getHexCenter(row, col, hexWidth, hexSize, hexHorizSpacing, hexVertSpacing, padding);
          nodes.push({ row, col, cx, cy, color: getNodeColor(row, col) });
        }
      }
    } else if (gridType === "octagon") {
      for (let row = 0; row < grid.height; row++) {
        for (let col = 0; col < grid.width; col++) {
          const cx = padding + cellSize / 2 + col * cellSize;
          const cy = padding + cellSize / 2 + row * cellSize;
          nodes.push({ row, col, cx, cy, color: getNodeColor(row, col) });
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
          nodes.push({ row, col, cx: centroid[0], cy: centroid[1], color: getNodeColor(row, col) });
        }
      }
    }
    
    // Create a lookup map for node positions
    const nodeMap = new Map<string, NodeData>();
    for (const node of nodes) {
      nodeMap.set(`${node.row},${node.col}`, node);
    }
    
    // Compute edges from kept edges
    interface EdgeData {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
      // For octagon/cairobridge: track if this is a diagonal edge and its type
      isDiagonal?: boolean;
      isDownSlant?: boolean; // true = down-slant (NW-SE), false = up-slant (NE-SW)
      // Node keys to identify endpoints for adjacency tracking
      nodeKey1: string;
      nodeKey2: string;
      // Edge index for adjacency lookup
      edgeIndex: number;
      // Control point for curved edges (set after finding straight-path pairs)
      controlPoint?: { x: number; y: number };
    }
    
    const edges: EdgeData[] = [];
    
    // Helper to check if an edge is diagonal (different row AND different col)
    const isDiagonalEdge = (e: { u: { row: number; col: number }; v: { row: number; col: number } }) => {
      return e.u.row !== e.v.row && e.u.col !== e.v.col;
    };
    
    // Helper to determine if a diagonal is down-slant (NW-SE) or up-slant (NE-SW)
    const isDownSlantDiagonal = (e: { u: { row: number; col: number }; v: { row: number; col: number } }) => {
      // Down-slant: when going from smaller row to larger row, col also increases
      // (row increases, col increases) OR (row decreases, col decreases)
      const dRow = e.v.row - e.u.row;
      const dCol = e.v.col - e.u.col;
      return (dRow > 0 && dCol > 0) || (dRow < 0 && dCol < 0);
    };
    
    for (const edge of solution.keptEdges) {
      const node1 = nodeMap.get(`${edge.u.row},${edge.u.col}`);
      const node2 = nodeMap.get(`${edge.v.row},${edge.v.col}`);
      
      if (node1 && node2) {
        const diagonal = isDiagonalEdge(edge);
        const downSlant = diagonal ? isDownSlantDiagonal(edge) : undefined;
        const nodeKey1 = `${edge.u.row},${edge.u.col}`;
        const nodeKey2 = `${edge.v.row},${edge.v.col}`;
        
        edges.push({
          x1: node1.cx,
          y1: node1.cy,
          x2: node2.cx,
          y2: node2.cy,
          color: node1.color,
          isDiagonal: diagonal,
          isDownSlant: downSlant,
          nodeKey1,
          nodeKey2,
          edgeIndex: edges.length,
        });
      }
    }
    
    // Build adjacency list: for each node, list of edges connected to it
    const nodeEdges = new Map<string, number[]>(); // nodeKey -> list of edge indices
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i];
      if (!nodeEdges.has(edge.nodeKey1)) {
        nodeEdges.set(edge.nodeKey1, []);
      }
      if (!nodeEdges.has(edge.nodeKey2)) {
        nodeEdges.set(edge.nodeKey2, []);
      }
      nodeEdges.get(edge.nodeKey1)!.push(i);
      nodeEdges.get(edge.nodeKey2)!.push(i);
    }
    
    // For nodes with 2+ edges, find the pair closest to 180° and curve them
    // This creates smoother visual paths through vertices
    const CURVE_CONTROL_RATIO = 0.3; // Control point offset ratio from edge midpoint
    
    for (const [nodeKey, edgeIndices] of nodeEdges.entries()) {
      if (edgeIndices.length < 2) continue;
      
      const node = nodeMap.get(nodeKey);
      if (!node) continue;
      
      // Compute angle for each edge from this node's perspective
      interface EdgeAngle {
        edgeIndex: number;
        angle: number; // angle in radians, relative to positive x-axis
        otherEndX: number;
        otherEndY: number;
      }
      
      const edgeAngles: EdgeAngle[] = edgeIndices.map(idx => {
        const e = edges[idx];
        // Determine which end is this node and which is the other
        const isNode1 = e.nodeKey1 === nodeKey;
        const otherEndX = isNode1 ? e.x2 : e.x1;
        const otherEndY = isNode1 ? e.y2 : e.y1;
        const dx = otherEndX - node.cx;
        const dy = otherEndY - node.cy;
        const angle = Math.atan2(dy, dx);
        return { edgeIndex: idx, angle, otherEndX, otherEndY };
      });
      
      // Find the pair of edges with angles closest to 180° apart (straightest path)
      let bestPair: [EdgeAngle, EdgeAngle] | null = null;
      let bestAngleDiff = 0; // Looking for diff closest to PI
      
      for (let i = 0; i < edgeAngles.length; i++) {
        for (let j = i + 1; j < edgeAngles.length; j++) {
          const a1 = edgeAngles[i].angle;
          const a2 = edgeAngles[j].angle;
          // Compute absolute angle difference, normalized to [0, PI]
          let diff = Math.abs(a1 - a2);
          if (diff > Math.PI) diff = 2 * Math.PI - diff;
          
          // We want diff closest to PI (180°)
          if (bestPair === null || Math.abs(diff - Math.PI) < Math.abs(bestAngleDiff - Math.PI)) {
            bestPair = [edgeAngles[i], edgeAngles[j]];
            bestAngleDiff = diff;
          }
        }
      }
      
      // Only curve if angle is reasonably close to 180° (at least 120°)
      if (bestPair && bestAngleDiff > (2 * Math.PI / 3)) {
        const [ea1, ea2] = bestPair;
        const edge1 = edges[ea1.edgeIndex];
        const edge2 = edges[ea2.edgeIndex];
        
        // Compute the "through" direction: average of the two outgoing directions
        // This gives us the tangent direction at the node for the smooth path
        const dx1 = ea1.otherEndX - node.cx;
        const dy1 = ea1.otherEndY - node.cy;
        const dx2 = ea2.otherEndX - node.cx;
        const dy2 = ea2.otherEndY - node.cy;
        
        // Normalize directions
        const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
        const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        if (len1 < 0.001 || len2 < 0.001) continue;
        
        const ux1 = dx1 / len1;
        const uy1 = dy1 / len1;
        const ux2 = dx2 / len2;
        const uy2 = dy2 / len2;
        
        // Control point: place it along the tangent direction from node
        // at a distance proportional to the edge length
        // For edge1, use direction toward edge2 (the continuation) to get smooth tangent
        const controlDist1 = len1 * CURVE_CONTROL_RATIO;
        const ctrl1X = node.cx + ux2 * controlDist1; // use direction toward other edge
        const ctrl1Y = node.cy + uy2 * controlDist1;
        
        // Similarly for edge2, use direction toward edge1
        const controlDist2 = len2 * CURVE_CONTROL_RATIO;
        const ctrl2X = node.cx + ux1 * controlDist2; // use direction toward edge1
        const ctrl2Y = node.cy + uy1 * controlDist2;
        
        // Only set control point if edge doesn't already have one
        // (another node may have already curved this edge)
        if (!edge1.controlPoint) {
          edge1.controlPoint = { x: ctrl1X, y: ctrl1Y };
        }
        if (!edge2.controlPoint) {
          edge2.controlPoint = { x: ctrl2X, y: ctrl2Y };
        }
      }
    }
    
    // For octagon and cairobridge, we need to handle crossing edges with bridges
    // Separate edges into regular edges and crossing diagonal pairs
    const regularEdges: EdgeData[] = [];
    const downSlantEdges: EdgeData[] = [];
    const upSlantEdges: EdgeData[] = [];
    
    if (gridType === "octagon") {
      for (const edge of edges) {
        if (edge.isDiagonal) {
          if (edge.isDownSlant) {
            downSlantEdges.push(edge);
          } else {
            upSlantEdges.push(edge);
          }
        } else {
          regularEdges.push(edge);
        }
      }
    } else if (gridType === "cairobridge") {
      // For cairobridge, identify bridge diagonals (non-Cairo diagonals)
      for (const edge of edges) {
        if (edge.isDiagonal) {
          // Treat all diagonals as potential crossing edges
          // Down-slant vs up-slant determines layer
          if (edge.isDownSlant) {
            downSlantEdges.push(edge);
          } else {
            upSlantEdges.push(edge);
          }
        } else {
          regularEdges.push(edge);
        }
      }
    } else {
      // For other grid types, all edges are regular
      regularEdges.push(...edges);
    }
    
    // Compute bridge rectangles for crossing edges
    // The bridge is a white-filled rectangle that the "over" edge passes through
    interface BridgeData {
      path: string;
    }
    
    const bridges: BridgeData[] = [];
    // Bridge sizing ratios - chosen for visual clarity at typical cell sizes
    const BRIDGE_WIDTH_RATIO = 0.12; // Width of the white bridge perpendicular to edge
    const BRIDGE_LENGTH_RATIO = 0.25; // Length of the bridge section along the edge
    const bridgeWidth = cellSize * BRIDGE_WIDTH_RATIO;
    
    // For up-slant edges (which go "over"), create bridges at crossing points
    if (gridType === "octagon" || gridType === "cairobridge") {
      for (const upEdge of upSlantEdges) {
        // Direction vector of the edge
        const dx = upEdge.x2 - upEdge.x1;
        const dy = upEdge.y2 - upEdge.y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        
        // Skip zero-length edges to avoid division by zero
        if (len < 0.001) continue;
        
        // Find the midpoint of this edge (where it crosses)
        const midX = (upEdge.x1 + upEdge.x2) / 2;
        const midY = (upEdge.y1 + upEdge.y2) / 2;
        
        const unitX = dx / len;
        const unitY = dy / len;
        
        // Perpendicular vector
        const perpX = -unitY;
        const perpY = unitX;
        
        // Bridge extends bridgeWidth/2 perpendicular on each side
        // and BRIDGE_LENGTH_RATIO * len along the edge direction
        const halfLen = len * BRIDGE_LENGTH_RATIO / 2;
        const halfWidth = bridgeWidth / 2;
        
        // Four corners of the bridge
        const c1x = midX - unitX * halfLen + perpX * halfWidth;
        const c1y = midY - unitY * halfLen + perpY * halfWidth;
        const c2x = midX - unitX * halfLen - perpX * halfWidth;
        const c2y = midY - unitY * halfLen - perpY * halfWidth;
        const c3x = midX + unitX * halfLen - perpX * halfWidth;
        const c3y = midY + unitY * halfLen - perpY * halfWidth;
        const c4x = midX + unitX * halfLen + perpX * halfWidth;
        const c4y = midY + unitY * halfLen + perpY * halfWidth;
        
        const bridgePath = `M ${c1x} ${c1y} L ${c2x} ${c2y} L ${c3x} ${c3y} L ${c4x} ${c4y} Z`;
        bridges.push({ path: bridgePath });
      }
    }
    
    // Helper to render an edge - either as a line or a quadratic Bézier curve
    const renderEdge = (edge: EdgeData, keyPrefix: string, i: number) => {
      if (edge.controlPoint) {
        // Render as quadratic Bézier curve
        const d = `M ${edge.x1} ${edge.y1} Q ${edge.controlPoint.x} ${edge.controlPoint.y} ${edge.x2} ${edge.y2}`;
        return (
          <path
            key={`${keyPrefix}-${i}`}
            d={d}
            stroke={edge.color}
            strokeWidth={edgeWidth}
            strokeLinecap="round"
            fill="none"
          />
        );
      } else {
        // Render as straight line
        return (
          <line
            key={`${keyPrefix}-${i}`}
            x1={edge.x1}
            y1={edge.y1}
            x2={edge.x2}
            y2={edge.y2}
            stroke={edge.color}
            strokeWidth={edgeWidth}
            strokeLinecap="round"
          />
        );
      }
    };
    
    return (
      <div
        className="grid-container"
        style={{
          position: "relative",
          userSelect: "none",
        }}
      >
        <svg width={svgWidth} height={svgHeight} style={{ display: "block", backgroundColor: "#f5f5f5" }}>
          {/* Layer 1: Regular edges (non-diagonal) */}
          {regularEdges.map((edge, i) => renderEdge(edge, "regular-edge", i))}
          
          {/* Layer 2: Down-slant diagonal edges (go "under") */}
          {downSlantEdges.map((edge, i) => renderEdge(edge, "down-edge", i))}
          
          {/* Layer 3: White bridges for up-slant edges */}
          {bridges.map((bridge, i) => (
            <path
              key={`bridge-${i}`}
              d={bridge.path}
              fill="white"
              stroke="none"
            />
          ))}
          
          {/* Layer 4: Up-slant diagonal edges (go "over") */}
          {upSlantEdges.map((edge, i) => renderEdge(edge, "up-edge", i))}
          
          {/* Layer 5: Render nodes as small dots on top */}
          {nodes.map(({ row, col, cx, cy, color }) => (
            <circle
              key={`node-${row}-${col}`}
              cx={cx}
              cy={cy}
              r={nodeRadius}
              fill={color}
            />
          ))}
        </svg>
      </div>
    );
  }

  // For hex grid, we use SVG
  if (gridType === "hex") {
    const svgWidth = totalWidth;
    const svgHeight = totalHeight;
    const padding = wallThickness;
    
    // Pre-compute all hex data
    const hexData: {
      row: number;
      col: number;
      cx: number;
      cy: number;
      path: string;
      fill: string;
      isBlank: boolean;
      isHatch: boolean;
      isRoot: boolean;
      walls: { x1: number; y1: number; x2: number; y2: number }[];
      reachLevel: number | null;
      minDistConstraint: number | null;
    }[] = [];
    
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const inputColor = grid.colors[row][col];
        // In solution view mode, always show solution colors
        // In sketchpad mode, always show user colors (inputColor), even if null
        const displayColor = showSolutionColors
          ? solution!.assignedColors[row][col]
          : inputColor;
        const isBlank = inputColor === null && !showSolutionColors;
        const isHatch = displayColor === HATCH_COLOR;
        const isRoot = isRootCell(row, col);
        
        let fill: string;
        if (isBlank) {
          fill = "url(#blankPattern)";
        } else if (isHatch) {
          fill = "url(#hatchPattern)";
        } else {
          fill = COLORS[(displayColor ?? 0) % COLORS.length];
        }

        // Calculate hex center position - for pointy-topped, odd rows are offset right
        const { cx, cy } = getHexCenter(row, col, hexWidth, hexSize, hexHorizSpacing, hexVertSpacing, padding);
        
        const path = createHexPath(cx, cy, hexSize);

        // Check for walls to neighbors
        const neighbors = getHexNeighbors(row, col);
        const walls: { x1: number; y1: number; x2: number; y2: number }[] = [];
        
        for (const [nRow, nCol, direction] of neighbors) {
          // Skip walls to out-of-bounds neighbors (boundary)
          if (nRow < 0 || nRow >= grid.height || nCol < 0 || nCol >= grid.width) {
            continue;
          }
          if (hasWall(row, col, nRow, nCol)) {
            const segment = getHexWallSegment(direction, cx, cy, hexSize);
            if (segment) {
              walls.push(segment);
            }
          }
        }
        
        // Get distance level if available
        const reachLevel = getDistanceLevel(row, col);
        // Get min distance constraint if available
        const minDistConstraint = getMinDistanceConstraint(row, col);
        
        hexData.push({ row, col, cx, cy, path, fill, isBlank, isHatch, isRoot, walls, reachLevel, minDistConstraint });
      }
    }
    
    return (
      <div
        className="grid-container"
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          position: "relative",
          userSelect: "none",
        }}
      >
        <svg width={svgWidth} height={svgHeight} style={{ display: "block" }}>
          {/* Define patterns for blank and hatch fills */}
          <defs>
            <pattern id="blankPattern" patternUnits="userSpaceOnUse" width="10" height="10">
              <rect width="10" height="10" fill="#f5f5f5"/>
              <line x1="0" y1="0" x2="10" y2="10" stroke="#e0e0e0" strokeWidth="2"/>
            </pattern>
            <pattern id="hatchPattern" patternUnits="userSpaceOnUse" width="8" height="8">
              <rect width="8" height="8" fill="#fffde7"/>
              <line x1="0" y1="0" x2="8" y2="8" stroke="#ff9800" strokeWidth="1.5"/>
              <line x1="8" y1="0" x2="0" y2="8" stroke="#ff9800" strokeWidth="1.5"/>
            </pattern>
          </defs>
          
          {/* First pass: render all hex fills */}
          {hexData.map(({ row, col, path, fill }) => (
            <path
              key={`fill-${row}-${col}`}
              d={path}
              fill={fill}
              stroke="none"
              style={{ cursor: viewMode === "solution" ? "default" : "pointer" }}
              onMouseDown={() => handleMouseDown(row, col)}
              onMouseEnter={() => handleMouseEnter(row, col)}
            />
          ))}
          
          {/* Second pass: render all walls on top */}
          {hexData.flatMap(({ row, col, walls }) =>
            walls.map((wall, i) => (
              <line
                key={`wall-${row}-${col}-${i}`}
                x1={wall.x1}
                y1={wall.y1}
                x2={wall.x2}
                y2={wall.y2}
                stroke={WALL_COLOR}
                strokeWidth={wallThickness}
                strokeLinecap="round"
              />
            ))
          )}
          
          {/* Third pass: render reachability levels on top of everything */}
          {hexData.map(({ row, col, cx, cy, reachLevel }) =>
            reachLevel !== null && (
              <text
                key={`level-${row}-${col}`}
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#fff"
                fontWeight="bold"
                fontSize={cellSize > 30 ? "14px" : "10px"}
                style={{
                  textShadow: "1px 1px 2px rgba(0,0,0,0.5)",
                  pointerEvents: "none",
                }}
              >
                {reachLevel === -1 ? "∞" : reachLevel}
              </text>
            )
          )}
          
          {/* Fourth pass: render root indicators */}
          {hexData.map(({ row, col, cx, cy, isRoot }) =>
            isRoot && (
              <g key={`root-${row}-${col}`}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={cellSize * 0.2}
                  fill="white"
                  stroke="#2c3e50"
                  strokeWidth="2"
                  style={{ pointerEvents: "none" }}
                />
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#2c3e50"
                  fontWeight="bold"
                  fontSize={cellSize > 30 ? "12px" : "8px"}
                  style={{ pointerEvents: "none" }}
                >
                  R
                </text>
              </g>
            )
          )}
          
          {/* Fifth pass: render min distance constraint markers */}
          {hexData.map(({ row, col, cx, cy, minDistConstraint, isRoot }) =>
            minDistConstraint !== null && !isRoot && (
              <g key={`mindist-${row}-${col}`}>
                <rect
                  x={cx - cellSize * 0.25}
                  y={cy - cellSize * 0.15}
                  width={cellSize * 0.5}
                  height={cellSize * 0.3}
                  rx={3}
                  fill="rgba(231, 76, 60, 0.85)"
                  stroke="white"
                  strokeWidth="1.5"
                  style={{ pointerEvents: "none" }}
                />
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="white"
                  fontWeight="bold"
                  fontSize={cellSize > 30 ? "10px" : "8px"}
                  style={{ pointerEvents: "none" }}
                >
                  ≥{minDistConstraint}
                </text>
              </g>
            )
          )}
        </svg>
      </div>
    );
  }

  // Octagon grid rendering
  if (gridType === "octagon") {
    const svgWidth = totalWidth;
    const svgHeight = totalHeight;
    const padding = wallThickness;

    // Helper to get color for a cell
    const getCellColor = (row: number, col: number): string => {
      const inputColor = grid.colors[row][col];
      // In solution view mode, always show solution colors
      // In sketchpad mode, always show user colors (inputColor), even if null
      const displayColor = showSolutionColors
        ? solution!.assignedColors[row][col]
        : inputColor;
      const isBlank = inputColor === null && !showSolutionColors;
      const isHatch = displayColor === HATCH_COLOR;
      
      if (isBlank) {
        return "url(#blankPattern)";
      } else if (isHatch) {
        return "url(#hatchPattern)";
      } else {
        return COLORS[(displayColor ?? 0) % COLORS.length];
      }
    };

    // Pre-compute all octagon data
    interface OctData {
      row: number;
      col: number;
      cx: number;
      cy: number;
      path: string;
      fill: string;
      reachLevel: number | null;
      isRoot: boolean;
      minDistConstraint: number | null;
    }
    
    const octData: OctData[] = [];
    
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const cx = padding + cellSize / 2 + col * cellSize;
        const cy = padding + cellSize / 2 + row * cellSize;
        const path = createOctagonPath(cx, cy, cellSize, octInset);
        const fill = getCellColor(row, col);
        
        // Get distance level if available
        const reachLevel = getDistanceLevel(row, col);
        
        // Check if this cell is a root
        const isRoot = isRootCell(row, col);
        
        // Get min distance constraint if available
        const minDistConstraint = getMinDistanceConstraint(row, col);

        octData.push({ row, col, cx, cy, path, fill, reachLevel, isRoot, minDistConstraint });
      }
    }

    // Pre-compute diagonal bands at intersection points
    // Each intersection (where 4 octagons meet) has two crossing bands:
    // - Down-slant band connects top-left cell to bottom-right cell (NW-SE direction)
    // - Up-slant band connects top-right cell to bottom-left cell (NE-SW direction)
    // Down-slanting bands render beneath, up-slanting bands render on top
    interface DiagonalBand {
      path: string;
      fill: string;
    }
    
    interface UpSlantBand {
      path: string;
      fill: string;
      // Long edges for outline (only for up-slant bands)
      edge1: { x1: number; y1: number; x2: number; y2: number };
      edge2: { x1: number; y1: number; x2: number; y2: number };
    }
    
    const downSlantBands: DiagonalBand[] = [];
    const upSlantBands: UpSlantBand[] = [];
    
    // Iterate over intersection points (corners where 4 cells meet)
    // Intersection at (iRow, iCol) is between cells:
    //   top-left: (iRow-1, iCol-1), top-right: (iRow-1, iCol)
    //   bottom-left: (iRow, iCol-1), bottom-right: (iRow, iCol)
    for (let iRow = 1; iRow < grid.height; iRow++) {
      for (let iCol = 1; iCol < grid.width; iCol++) {
        // Center of the small square gap at this intersection
        const ix = padding + iCol * cellSize;
        const iy = padding + iRow * cellSize;
        
        // The gap forms a small square. Its corners are at the octagon vertices.
        // For truncated square tiling, the gap has size 2*octInset on each side.
        const gapHalf = octInset; // Half the gap size
        
        // Cell coordinates for the 4 adjacent cells
        const tlRow = iRow - 1, tlCol = iCol - 1; // top-left
        const trRow = iRow - 1, trCol = iCol;     // top-right  
        const blRow = iRow, blCol = iCol - 1;     // bottom-left
        const brRow = iRow, brCol = iCol;         // bottom-right
        
        // Down-slant band: connects top-left to bottom-right
        // This band runs from NW to SE through the gap
        // Only draw the band if there's a passage (not a wall)
        const downSlantWall = hasWall(tlRow, tlCol, brRow, brCol);
        
        if (!downSlantWall) {
          const downSlantFill = getCellColor(tlRow, tlCol);
          
          // Band spans from top-left corner to bottom-right corner of the gap
          // Band width is octBandWidth, centered on the diagonal
          const halfBand = octBandWidth / 2;
          // Down-slant diagonal goes from (-gapHalf, -gapHalf) to (gapHalf, gapHalf)
          // Perpendicular direction is (1, -1) normalized
          const downPerpX = halfBand * Math.SQRT1_2;
          const downPerpY = halfBand * Math.SQRT1_2;
          const downPath = `M ${ix - gapHalf + downPerpX} ${iy - gapHalf - downPerpY} ` +
                          `L ${ix - gapHalf - downPerpX} ${iy - gapHalf + downPerpY} ` +
                          `L ${ix + gapHalf - downPerpX} ${iy + gapHalf + downPerpY} ` +
                          `L ${ix + gapHalf + downPerpX} ${iy + gapHalf - downPerpY} Z`;
          downSlantBands.push({ path: downPath, fill: downSlantFill });
        }
        
        // Up-slant band: connects top-right to bottom-left
        // This band runs from NE to SW through the gap
        // Only draw the band if there's a passage (not a wall)
        const upSlantWall = hasWall(trRow, trCol, blRow, blCol);
        
        if (!upSlantWall) {
          const upSlantFill = getCellColor(trRow, trCol);
          
          // Band spans from top-right corner to bottom-left corner of the gap
          // Up-slant diagonal goes from (gapHalf, -gapHalf) to (-gapHalf, gapHalf)
          // Perpendicular direction is (1, 1) normalized
          const halfBand = octBandWidth / 2;
          const upPerpX = halfBand * Math.SQRT1_2;
          const upPerpY = halfBand * Math.SQRT1_2;
          
          // The four corners of the band (clockwise from top-right outer edge)
          // Corner 1: top-right, outer (toward NE)
          const c1x = ix + gapHalf + upPerpX, c1y = iy - gapHalf + upPerpY;
          // Corner 2: top-right, inner (toward center)
          const c2x = ix + gapHalf - upPerpX, c2y = iy - gapHalf - upPerpY;
          // Corner 3: bottom-left, inner (toward center)
          const c3x = ix - gapHalf - upPerpX, c3y = iy + gapHalf - upPerpY;
          // Corner 4: bottom-left, outer (toward SW)
          const c4x = ix - gapHalf + upPerpX, c4y = iy + gapHalf + upPerpY;
          
          const upPath = `M ${c1x} ${c1y} L ${c2x} ${c2y} L ${c3x} ${c3y} L ${c4x} ${c4y} Z`;
          
          // Long edges are: c1-c4 (outer edge) and c2-c3 (inner edge)
          upSlantBands.push({ 
            path: upPath, 
            fill: upSlantFill,
            edge1: { x1: c1x, y1: c1y, x2: c4x, y2: c4y }, // outer long edge
            edge2: { x1: c2x, y1: c2y, x2: c3x, y2: c3y }, // inner long edge
          });
        }
      }
    }

    // Pre-compute cardinal walls (N, S, E, W edges)
    interface CardinalWall {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
    
    const cardinalWalls: CardinalWall[] = [];
    
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const cx = padding + cellSize / 2 + col * cellSize;
        const cy = padding + cellSize / 2 + row * cellSize;
        const halfSize = cellSize / 2;
        
        // Check each cardinal direction
        // North wall
        if (row > 0 && hasWall(row, col, row - 1, col)) {
          cardinalWalls.push({
            x1: cx - halfSize + octInset,
            y1: cy - halfSize,
            x2: cx + halfSize - octInset,
            y2: cy - halfSize,
          });
        }
        // East wall
        if (col < grid.width - 1 && hasWall(row, col, row, col + 1)) {
          cardinalWalls.push({
            x1: cx + halfSize,
            y1: cy - halfSize + octInset,
            x2: cx + halfSize,
            y2: cy + halfSize - octInset,
          });
        }
        // South wall
        if (row < grid.height - 1 && hasWall(row, col, row + 1, col)) {
          cardinalWalls.push({
            x1: cx - halfSize + octInset,
            y1: cy + halfSize,
            x2: cx + halfSize - octInset,
            y2: cy + halfSize,
          });
        }
        // West wall
        if (col > 0 && hasWall(row, col, row, col - 1)) {
          cardinalWalls.push({
            x1: cx - halfSize,
            y1: cy - halfSize + octInset,
            x2: cx - halfSize,
            y2: cy + halfSize - octInset,
          });
        }
      }
    }

    return (
      <div
        className="grid-container"
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          position: "relative",
          userSelect: "none",
        }}
      >
        <svg width={svgWidth} height={svgHeight} style={{ display: "block", backgroundColor: "#000000" }}>
          {/* Define patterns for blank and hatch fills */}
          <defs>
            <pattern id="blankPattern" patternUnits="userSpaceOnUse" width="10" height="10">
              <rect width="10" height="10" fill="#f5f5f5"/>
              <line x1="0" y1="0" x2="10" y2="10" stroke="#e0e0e0" strokeWidth="2"/>
            </pattern>
            <pattern id="hatchPattern" patternUnits="userSpaceOnUse" width="8" height="8">
              <rect width="8" height="8" fill="#fffde7"/>
              <line x1="0" y1="0" x2="8" y2="8" stroke="#ff9800" strokeWidth="1.5"/>
              <line x1="8" y1="0" x2="0" y2="8" stroke="#ff9800" strokeWidth="1.5"/>
            </pattern>
          </defs>
          
          {/* Layer 1: Down-slanting diagonal bands (beneath) - no outline */}
          {downSlantBands.map((band, i) => (
            <path
              key={`down-band-${i}`}
              d={band.path}
              fill={band.fill}
              stroke="none"
            />
          ))}
          
          {/* Layer 2: Octagon fills */}
          {octData.map(({ row, col, path, fill }) => (
            <path
              key={`oct-${row}-${col}`}
              d={path}
              fill={fill}
              stroke="none"
              style={{ cursor: viewMode === "solution" ? "default" : "pointer" }}
              onMouseDown={() => handleMouseDown(row, col)}
              onMouseEnter={() => handleMouseEnter(row, col)}
            />
          ))}
          
          {/* Layer 3: Up-slanting diagonal bands (on top) - fill only, no stroke on path */}
          {upSlantBands.map((band, i) => (
            <path
              key={`up-band-${i}`}
              d={band.path}
              fill={band.fill}
              stroke="none"
            />
          ))}
          
          {/* Layer 3b: Up-slanting band long edge outlines */}
          {upSlantBands.map((band, i) => (
            <React.Fragment key={`up-band-edges-${i}`}>
              <line
                x1={band.edge1.x1}
                y1={band.edge1.y1}
                x2={band.edge1.x2}
                y2={band.edge1.y2}
                stroke={WALL_COLOR}
                strokeWidth={0.5}
              />
              <line
                x1={band.edge2.x1}
                y1={band.edge2.y1}
                x2={band.edge2.x2}
                y2={band.edge2.y2}
                stroke={WALL_COLOR}
                strokeWidth={0.5}
              />
            </React.Fragment>
          ))}
          
          {/* Layer 4: Cardinal walls (on top of everything) */}
          {cardinalWalls.map((wall, i) => (
            <line
              key={`cardinal-wall-${i}`}
              x1={wall.x1}
              y1={wall.y1}
              x2={wall.x2}
              y2={wall.y2}
              stroke={WALL_COLOR}
              strokeWidth={wallThickness}
              strokeLinecap="round"
            />
          ))}
          
          {/* Outer boundary */}
          <rect
            x={wallThickness / 2}
            y={wallThickness / 2}
            width={svgWidth - wallThickness}
            height={svgHeight - wallThickness}
            fill="none"
            stroke={WALL_COLOR}
            strokeWidth={wallThickness}
          />
          
          {/* Reachability levels on top of everything */}
          {octData.map(({ row, col, cx, cy, reachLevel }) =>
            reachLevel !== null && (
              <text
                key={`level-${row}-${col}`}
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#fff"
                fontWeight="bold"
                fontSize={cellSize > 30 ? "14px" : "10px"}
                style={{
                  textShadow: "1px 1px 2px rgba(0,0,0,0.5)",
                  pointerEvents: "none",
                }}
              >
                {reachLevel === -1 ? "∞" : reachLevel}
              </text>
            )
          )}
          
          {/* Root indicators (show R when not displaying levels) */}
          {octData.map(({ row, col, cx, cy, reachLevel, isRoot }) =>
            isRoot && reachLevel === null && (
              <g key={`root-${row}-${col}`}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={cellSize * 0.2}
                  fill="white"
                  stroke="#2c3e50"
                  strokeWidth="2"
                  style={{ pointerEvents: "none" }}
                />
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#2c3e50"
                  fontWeight="bold"
                  fontSize={cellSize > 30 ? "12px" : "8px"}
                  style={{ pointerEvents: "none" }}
                >
                  R
                </text>
              </g>
            )
          )}
          
          {/* Min distance constraint markers */}
          {octData.map(({ row, col, cx, cy, minDistConstraint, isRoot }) =>
            minDistConstraint !== null && !isRoot && (
              <g key={`mindist-${row}-${col}`}>
                <rect
                  x={cx - cellSize * 0.25}
                  y={cy - cellSize * 0.15}
                  width={cellSize * 0.5}
                  height={cellSize * 0.3}
                  rx={3}
                  fill="rgba(231, 76, 60, 0.85)"
                  stroke="white"
                  strokeWidth="1.5"
                  style={{ pointerEvents: "none" }}
                />
                <text
                  x={cx}
                  y={cy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="white"
                  fontWeight="bold"
                  fontSize={cellSize > 30 ? "10px" : "8px"}
                  style={{ pointerEvents: "none" }}
                >
                  ≥{minDistConstraint}
                </text>
              </g>
            )
          )}
        </svg>
      </div>
    );
  }

  // Cairo pentagonal tiling rendering
  if (gridType === "cairo") {
    const svgWidth = totalWidth;
    const svgHeight = totalHeight;
    const padding = wallThickness;
    
    // Create coordinate transformer
    const availableWidth = svgWidth - 2 * padding;
    const availableHeight = svgHeight - 2 * padding;
    const toSvg = createCairoTransformer(grid.width, grid.height, availableWidth, availableHeight, padding);
    
    // Helper to get color for a cell
    const getCellColor = (row: number, col: number): string => {
      const inputColor = grid.colors[row][col];
      const displayColor = showSolutionColors
        ? solution!.assignedColors[row][col]
        : inputColor;
      const isBlank = inputColor === null && !showSolutionColors;
      const isHatch = displayColor === HATCH_COLOR;
      
      if (isBlank) {
        return "url(#blankPattern)";
      } else if (isHatch) {
        return "url(#hatchPattern)";
      } else {
        return COLORS[(displayColor ?? 0) % COLORS.length];
      }
    };
    
    // Pre-compute all Cairo tile data
    interface CairoData {
      row: number;
      col: number;
      path: string;
      fill: string;
      centroid: [number, number];
      reachLevel: number | null;
      isRoot: boolean;
      minDistConstraint: number | null;
    }
    
    const cairoData: CairoData[] = [];
    
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const tile = getCairoTile(row, col);
        const svgTile = tile.map(toSvg);
        const path = svgTile.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z';
        const fill = getCellColor(row, col);
        const centroid = toSvg(polyCentroid(tile));
        
        // Get distance level if available
        const reachLevel = getDistanceLevel(row, col);
        
        // Check if this cell is a root
        const isRoot = isRootCell(row, col);
        
        // Get min distance constraint if available
        const minDistConstraint = getMinDistanceConstraint(row, col);

        cairoData.push({ row, col, path, fill, centroid, reachLevel, isRoot, minDistConstraint });
      }
    }
    
    // Pre-compute walls between tiles
    interface CairoWall {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
    
    const cairoWalls: CairoWall[] = [];
    const processedEdges = new Set<string>();
    
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const tile = getCairoTile(row, col);
        const neighbors = getCairoNeighborsWithDirection(row, col);
        
        for (const [nRow, nCol] of neighbors) {
          if (nRow < 0 || nRow >= grid.height || nCol < 0 || nCol >= grid.width) {
            continue;
          }
          
          // Create unique edge key
          const edgeKey = row < nRow || (row === nRow && col < nCol)
            ? `${row},${col}-${nRow},${nCol}`
            : `${nRow},${nCol}-${row},${col}`;
            
          if (processedEdges.has(edgeKey)) {
            continue;
          }
          processedEdges.add(edgeKey);
          
          if (hasWall(row, col, nRow, nCol)) {
            const neighborTile = getCairoTile(nRow, nCol);
            const sharedEdge = findSharedEdge(tile, neighborTile);
            
            if (sharedEdge) {
              const [p1, p2] = sharedEdge.map(toSvg);
              cairoWalls.push({ x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] });
            }
          }
        }
      }
    }

    return (
      <div
        className="grid-container"
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          position: "relative",
          userSelect: "none",
        }}
      >
        <svg width={svgWidth} height={svgHeight} style={{ display: "block" }}>
          {/* Define patterns for blank and hatch fills */}
          <defs>
            <pattern id="blankPattern" patternUnits="userSpaceOnUse" width="10" height="10">
              <rect width="10" height="10" fill="#f5f5f5"/>
              <line x1="0" y1="0" x2="10" y2="10" stroke="#e0e0e0" strokeWidth="2"/>
            </pattern>
            <pattern id="hatchPattern" patternUnits="userSpaceOnUse" width="8" height="8">
              <rect width="8" height="8" fill="#fffde7"/>
              <line x1="0" y1="0" x2="8" y2="8" stroke="#ff9800" strokeWidth="1.5"/>
              <line x1="8" y1="0" x2="0" y2="8" stroke="#ff9800" strokeWidth="1.5"/>
            </pattern>
          </defs>
          
          {/* First pass: render all Cairo tile fills */}
          {cairoData.map(({ row, col, path, fill }) => (
            <path
              key={`fill-${row}-${col}`}
              d={path}
              fill={fill}
              style={{ cursor: viewMode === "solution" ? "default" : "pointer" }}
              onMouseDown={() => handleMouseDown(row, col)}
              onMouseEnter={() => handleMouseEnter(row, col)}
            />
          ))}
          
          {/* Second pass: render all walls on top */}
          {cairoWalls.map((wall, i) => (
            <line
              key={`wall-${i}`}
              x1={wall.x1}
              y1={wall.y1}
              x2={wall.x2}
              y2={wall.y2}
              stroke={WALL_COLOR}
              strokeWidth={wallThickness}
              strokeLinecap="round"
            />
          ))}
          
          {/* Third pass: render distance levels on top of everything */}
          {cairoData.map(({ row, col, centroid, reachLevel }) =>
            reachLevel !== null && (
              <text
                key={`level-${row}-${col}`}
                x={centroid[0]}
                y={centroid[1]}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#fff"
                fontWeight="bold"
                fontSize={cellSize > 30 ? "14px" : "10px"}
                style={{
                  textShadow: "1px 1px 2px rgba(0,0,0,0.5)",
                  pointerEvents: "none",
                }}
              >
                {reachLevel === -1 ? "∞" : reachLevel}
              </text>
            )
          )}
          
          {/* Fourth pass: render root indicators (show R when not displaying levels) */}
          {cairoData.map(({ row, col, centroid, reachLevel, isRoot }) =>
            isRoot && reachLevel === null && (
              <g key={`root-${row}-${col}`}>
                <circle
                  cx={centroid[0]}
                  cy={centroid[1]}
                  r={cellSize * 0.2}
                  fill="white"
                  stroke="#2c3e50"
                  strokeWidth="2"
                  style={{ pointerEvents: "none" }}
                />
                <text
                  x={centroid[0]}
                  y={centroid[1]}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#2c3e50"
                  fontWeight="bold"
                  fontSize={cellSize > 30 ? "12px" : "8px"}
                  style={{ pointerEvents: "none" }}
                >
                  R
                </text>
              </g>
            )
          )}
          
          {/* Fifth pass: render min distance constraint markers */}
          {cairoData.map(({ row, col, centroid, minDistConstraint, isRoot }) =>
            minDistConstraint !== null && !isRoot && (
              <g key={`mindist-${row}-${col}`}>
                <rect
                  x={centroid[0] - cellSize * 0.25}
                  y={centroid[1] - cellSize * 0.15}
                  width={cellSize * 0.5}
                  height={cellSize * 0.3}
                  rx={3}
                  fill="rgba(231, 76, 60, 0.85)"
                  stroke="white"
                  strokeWidth="1.5"
                  style={{ pointerEvents: "none" }}
                />
                <text
                  x={centroid[0]}
                  y={centroid[1]}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="white"
                  fontWeight="bold"
                  fontSize={cellSize > 30 ? "10px" : "8px"}
                  style={{ pointerEvents: "none" }}
                >
                  ≥{minDistConstraint}
                </text>
              </g>
            )
          )}
        </svg>
      </div>
    );
  }

  // Cairo Bridge pentagonal tiling rendering (like Cairo but with bridge connections for extra diagonal neighbors)
  if (gridType === "cairobridge") {
    const svgWidth = totalWidth;
    const svgHeight = totalHeight;
    const padding = wallThickness;
    
    // Create coordinate transformer
    const availableWidth = svgWidth - 2 * padding;
    const availableHeight = svgHeight - 2 * padding;
    const toSvg = createCairoTransformer(grid.width, grid.height, availableWidth, availableHeight, padding);
    
    // Helper to get color for a cell
    const getCellColor = (row: number, col: number): string => {
      const inputColor = grid.colors[row][col];
      const displayColor = showSolutionColors
        ? solution!.assignedColors[row][col]
        : inputColor;
      const isBlank = inputColor === null && !showSolutionColors;
      const isHatch = displayColor === HATCH_COLOR;
      
      if (isBlank) {
        return "url(#blankPattern)";
      } else if (isHatch) {
        return "url(#hatchPattern)";
      } else {
        return COLORS[(displayColor ?? 0) % COLORS.length];
      }
    };
    
    // Pre-compute all Cairo tile data
    interface CairoData {
      row: number;
      col: number;
      path: string;
      fill: string;
      centroid: [number, number];
      reachLevel: number | null;
      isRoot: boolean;
      minDistConstraint: number | null;
    }
    
    const cairoData: CairoData[] = [];
    
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const tile = getCairoTile(row, col);
        const svgTile = tile.map(toSvg);
        const path = svgTile.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z';
        const fill = getCellColor(row, col);
        const centroid = toSvg(polyCentroid(tile));
        
        // Get distance level if available
        const reachLevel = getDistanceLevel(row, col);
        
        // Check if this cell is a root
        const isRoot = isRootCell(row, col);
        
        // Get min distance constraint if available
        const minDistConstraint = getMinDistanceConstraint(row, col);

        cairoData.push({ row, col, path, fill, centroid, reachLevel, isRoot, minDistConstraint });
      }
    }
    
    // Pre-compute walls between tiles (for base Cairo-like edges)
    interface CairoWall {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
    
    const cairoWalls: CairoWall[] = [];
    const processedEdges = new Set<string>();
    
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const tile = getCairoTile(row, col);
        const neighbors = getCairoBridgeNeighborsWithDirection(row, col);
        
        for (const [nRow, nCol, direction] of neighbors) {
          if (nRow < 0 || nRow >= grid.height || nCol < 0 || nCol >= grid.width) {
            continue;
          }
          
          // Create unique edge key
          const edgeKey = row < nRow || (row === nRow && col < nCol)
            ? `${row},${col}-${nRow},${nCol}`
            : `${nRow},${nCol}-${row},${col}`;
            
          if (processedEdges.has(edgeKey)) {
            continue;
          }
          processedEdges.add(edgeKey);
          
          // Only draw walls for shared-edge neighbors (cardinal + Cairo's diagonal)
          // Diagonal bridge neighbors don't have a shared edge to draw a wall on
          const isCardinal = direction === "N" || direction === "S" || direction === "E" || direction === "W";
          // Check if this is the original Cairo diagonal (which has a shared edge)
          const parityCol = col % 2;
          const parityRow = row % 2;
          let isCairoDiagonal = false;
          if (parityCol === 0 && parityRow === 0 && direction === "SW") isCairoDiagonal = true;
          else if (parityCol === 1 && parityRow === 0 && direction === "NW") isCairoDiagonal = true;
          else if (parityCol === 0 && parityRow === 1 && direction === "SE") isCairoDiagonal = true;
          else if (parityCol === 1 && parityRow === 1 && direction === "NE") isCairoDiagonal = true;
          
          if ((isCardinal || isCairoDiagonal) && hasWall(row, col, nRow, nCol)) {
            const neighborTile = getCairoTile(nRow, nCol);
            const sharedEdge = findSharedEdge(tile, neighborTile);
            
            if (sharedEdge) {
              const [p1, p2] = sharedEdge.map(toSvg);
              cairoWalls.push({ x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] });
            }
          }
        }
      }
    }
    
    // Pre-compute bridge connections for the extra diagonal neighbors
    // These are thin bands like in octagon that cross over each other
    interface Bridge {
      path: string;
      fill: string;
      // The two long edges of the bridge for outline
      edge1: { x1: number; y1: number; x2: number; y2: number };
      edge2: { x1: number; y1: number; x2: number; y2: number };
    }
    
    const bridges: Bridge[] = [];
    const bridgeBandWidth = cellSize * 0.08; // Thin bridges
    
    for (let row = 0; row < grid.height; row++) {
      for (let col = 0; col < grid.width; col++) {
        const neighbors = getCairoBridgeNeighborsWithDirection(row, col);
        const parityCol = col % 2;
        const parityRow = row % 2;
        
        // Determine which diagonals are "bridge" diagonals (not the Cairo diagonal)
        // Cairo diagonal for each parity:
        // (0,0): SW, (1,0): NW, (0,1): SE, (1,1): NE
        let cairoDiagonal: string;
        if (parityCol === 0 && parityRow === 0) cairoDiagonal = "SW";
        else if (parityCol === 1 && parityRow === 0) cairoDiagonal = "NW";
        else if (parityCol === 0 && parityRow === 1) cairoDiagonal = "SE";
        else cairoDiagonal = "NE";
        
        const tile = getCairoTile(row, col);
        const centroid1 = toSvg(polyCentroid(tile));
        
        for (const [nRow, nCol, direction] of neighbors) {
          if (nRow < 0 || nRow >= grid.height || nCol < 0 || nCol >= grid.width) {
            continue;
          }
          
          // Only process non-Cairo diagonals (the bridge diagonals)
          const isCardinal = direction === "N" || direction === "S" || direction === "E" || direction === "W";
          if (isCardinal || direction === cairoDiagonal) {
            continue;
          }
          
          // Only process each bridge once (from lower row/col cell)
          if (row > nRow || (row === nRow && col > nCol)) {
            continue;
          }
          
          // Check if there's no wall (passage exists)
          if (hasWall(row, col, nRow, nCol)) {
            continue;
          }
          
          // Draw bridge from this cell's centroid to neighbor's centroid
          const neighborTile = getCairoTile(nRow, nCol);
          const centroid2 = toSvg(polyCentroid(neighborTile));
          
          // Create a thin band covering only the middle 30% of the trajectory
          const dx = centroid2[0] - centroid1[0];
          const dy = centroid2[1] - centroid1[1];
          const len = Math.sqrt(dx * dx + dy * dy);
          
          // Unit vector along the bridge direction
          const unitX = dx / len;
          const unitY = dy / len;
          
          // Start at 35% and end at 65% of the trajectory (middle 30%)
          const startX = centroid1[0] + unitX * len * 0.35;
          const startY = centroid1[1] + unitY * len * 0.35;
          const endX = centroid1[0] + unitX * len * 0.65;
          const endY = centroid1[1] + unitY * len * 0.65;
          
          // Perpendicular unit vector
          const perpX = -dy / len * bridgeBandWidth / 2;
          const perpY = dx / len * bridgeBandWidth / 2;
          
          // Four corners of the bridge band (shortened)
          const c1x = startX + perpX, c1y = startY + perpY;
          const c2x = startX - perpX, c2y = startY - perpY;
          const c3x = endX - perpX, c3y = endY - perpY;
          const c4x = endX + perpX, c4y = endY + perpY;
          
          const bridgePath = `M ${c1x} ${c1y} L ${c2x} ${c2y} L ${c3x} ${c3y} L ${c4x} ${c4y} Z`;
          // In sketchpad mode, don't fill with color since we don't know what it will be
          const bridgeFill = showSolutionColors ? getCellColor(row, col) : "none";
          
          bridges.push({
            path: bridgePath,
            fill: bridgeFill,
            edge1: { x1: c1x, y1: c1y, x2: c4x, y2: c4y },
            edge2: { x1: c2x, y1: c2y, x2: c3x, y2: c3y },
          });
        }
      }
    }

    return (
      <div
        className="grid-container"
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          position: "relative",
          userSelect: "none",
        }}
      >
        <svg width={svgWidth} height={svgHeight} style={{ display: "block" }}>
          {/* Define patterns for blank and hatch fills */}
          <defs>
            <pattern id="blankPattern" patternUnits="userSpaceOnUse" width="10" height="10">
              <rect width="10" height="10" fill="#f5f5f5"/>
              <line x1="0" y1="0" x2="10" y2="10" stroke="#e0e0e0" strokeWidth="2"/>
            </pattern>
            <pattern id="hatchPattern" patternUnits="userSpaceOnUse" width="8" height="8">
              <rect width="8" height="8" fill="#fffde7"/>
              <line x1="0" y1="0" x2="8" y2="8" stroke="#ff9800" strokeWidth="1.5"/>
              <line x1="8" y1="0" x2="0" y2="8" stroke="#ff9800" strokeWidth="1.5"/>
            </pattern>
          </defs>
          
          {/* First pass: render all Cairo tile fills */}
          {cairoData.map(({ row, col, path, fill }) => (
            <path
              key={`fill-${row}-${col}`}
              d={path}
              fill={fill}
              style={{ cursor: viewMode === "solution" ? "default" : "pointer" }}
              onMouseDown={() => handleMouseDown(row, col)}
              onMouseEnter={() => handleMouseEnter(row, col)}
            />
          ))}
          
          {/* Second pass: render all walls */}
          {cairoWalls.map((wall, i) => (
            <line
              key={`wall-${i}`}
              x1={wall.x1}
              y1={wall.y1}
              x2={wall.x2}
              y2={wall.y2}
              stroke={WALL_COLOR}
              strokeWidth={wallThickness}
              strokeLinecap="round"
            />
          ))}
          
          {/* Third pass: render bridge connections on top of walls (thin bands) */}
          {bridges.map((bridge, i) => (
            <g key={`bridge-${i}`}>
              <path
                d={bridge.path}
                fill={bridge.fill}
                stroke="none"
              />
              {/* Outline on long edges */}
              <line
                x1={bridge.edge1.x1}
                y1={bridge.edge1.y1}
                x2={bridge.edge1.x2}
                y2={bridge.edge1.y2}
                stroke={WALL_COLOR}
                strokeWidth={0.5}
              />
              <line
                x1={bridge.edge2.x1}
                y1={bridge.edge2.y1}
                x2={bridge.edge2.x2}
                y2={bridge.edge2.y2}
                stroke={WALL_COLOR}
                strokeWidth={0.5}
              />
            </g>
          ))}
          
          {/* Fourth pass: render reachability levels on top of everything */}
          {cairoData.map(({ row, col, centroid, reachLevel }) =>
            reachLevel !== null && (
              <text
                key={`level-${row}-${col}`}
                x={centroid[0]}
                y={centroid[1]}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#fff"
                fontWeight="bold"
                fontSize={cellSize > 30 ? "14px" : "10px"}
                style={{
                  textShadow: "1px 1px 2px rgba(0,0,0,0.5)",
                  pointerEvents: "none",
                }}
              >
                {reachLevel === -1 ? "∞" : reachLevel}
              </text>
            )
          )}
          
          {/* Fifth pass: render root indicators (show R when not displaying levels) */}
          {cairoData.map(({ row, col, centroid, reachLevel, isRoot }) =>
            isRoot && reachLevel === null && (
              <g key={`root-${row}-${col}`}>
                <circle
                  cx={centroid[0]}
                  cy={centroid[1]}
                  r={cellSize * 0.2}
                  fill="white"
                  stroke="#2c3e50"
                  strokeWidth="2"
                  style={{ pointerEvents: "none" }}
                />
                <text
                  x={centroid[0]}
                  y={centroid[1]}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#2c3e50"
                  fontWeight="bold"
                  fontSize={cellSize > 30 ? "12px" : "8px"}
                  style={{ pointerEvents: "none" }}
                >
                  R
                </text>
              </g>
            )
          )}
          
          {/* Sixth pass: render min distance constraint markers */}
          {cairoData.map(({ row, col, centroid, minDistConstraint, isRoot }) =>
            minDistConstraint !== null && !isRoot && (
              <g key={`mindist-${row}-${col}`}>
                <rect
                  x={centroid[0] - cellSize * 0.25}
                  y={centroid[1] - cellSize * 0.15}
                  width={cellSize * 0.5}
                  height={cellSize * 0.3}
                  rx={3}
                  fill="rgba(231, 76, 60, 0.85)"
                  stroke="white"
                  strokeWidth="1.5"
                  style={{ pointerEvents: "none" }}
                />
                <text
                  x={centroid[0]}
                  y={centroid[1]}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="white"
                  fontWeight="bold"
                  fontSize={cellSize > 30 ? "10px" : "8px"}
                  style={{ pointerEvents: "none" }}
                >
                  ≥{minDistConstraint}
                </text>
              </g>
            )
          )}
        </svg>
      </div>
    );
  }

  // Square grid rendering (original code)

  return (
    <div
      className="grid-container"
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{
        position: "relative",
        width: totalWidth,
        height: totalHeight,
        border: `${wallThickness}px solid ${WALL_COLOR}`,
        boxSizing: "content-box",
        userSelect: "none",
      }}
    >
      {/* Render cells */}
      {Array.from({ length: grid.height }, (_, row) =>
        Array.from({ length: grid.width }, (_, col) => {
          const inputColor = grid.colors[row][col];
          // In solution view mode, always show solution colors
          // In sketchpad mode, always show user colors (inputColor), even if null
          const displayColor = showSolutionColors
            ? solution!.assignedColors[row][col]
            : inputColor;
          const isBlank = inputColor === null && !showSolutionColors;
          const isHatch = displayColor === HATCH_COLOR;
          const isRoot = isRootCell(row, col);
          
          // Determine background
          let bgColor: string;
          let bgPattern: string;
          if (isBlank) {
            bgColor = BLANK_COLOR;
            bgPattern = BLANK_PATTERN;
          } else if (isHatch) {
            bgColor = HATCH_BG_COLOR;
            bgPattern = HATCH_PATTERN;
          } else {
            bgColor = COLORS[(displayColor ?? 0) % COLORS.length];
            bgPattern = bgColor;
          }

          // Check walls on each side
          const wallRight = col < grid.width - 1 && hasWall(row, col, row, col + 1);
          const wallBottom = row < grid.height - 1 && hasWall(row, col, row + 1, col);
          
          // Get distance level if available
          const reachLevel = getDistanceLevel(row, col);
          // Get min distance constraint if available
          const minDistConstraint = getMinDistanceConstraint(row, col);

          return (
            <div
              key={`${row}-${col}`}
              onMouseDown={() => handleMouseDown(row, col)}
              onMouseEnter={() => handleMouseEnter(row, col)}
              style={{
                position: "absolute",
                left: col * cellSize,
                top: row * cellSize,
                width: cellSize,
                height: cellSize,
                backgroundColor: bgColor,
                background: bgPattern,
                cursor: viewMode === "solution" ? "default" : "pointer",
                boxSizing: "border-box",
                // Right wall
                borderRight: wallRight
                  ? `${wallThickness}px solid ${WALL_COLOR}`
                  : "none",
                // Bottom wall
                borderBottom: wallBottom
                  ? `${wallThickness}px solid ${WALL_COLOR}`
                  : "none",
                // Center content for reachability level or root indicator
                display: (reachLevel !== null || isRoot || minDistConstraint !== null) ? "flex" : undefined,
                alignItems: (reachLevel !== null || isRoot || minDistConstraint !== null) ? "center" : undefined,
                justifyContent: (reachLevel !== null || isRoot || minDistConstraint !== null) ? "center" : undefined,
              }}
            >
              {reachLevel !== null && (
                <span style={{
                  color: "#fff",
                  fontWeight: "bold",
                  fontSize: cellSize > 30 ? "14px" : "10px",
                  textShadow: "1px 1px 2px rgba(0,0,0,0.5)",
                }}>
                  {reachLevel === -1 ? "∞" : reachLevel}
                </span>
              )}
              {/* Show root indicator only when not displaying reachability levels.
                  When levels are shown, the root is implicitly at level 0, so the "R"
                  marker would be redundant. */}
              {isRoot && reachLevel === null && (
                <div style={{
                  width: cellSize * 0.5,
                  height: cellSize * 0.5,
                  borderRadius: "50%",
                  backgroundColor: "white",
                  border: "2px solid #2c3e50",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: cellSize > 30 ? "12px" : "8px",
                  fontWeight: "bold",
                  color: "#2c3e50",
                }}>
                  R
                </div>
              )}
              {/* Show min distance constraint marker when not showing reach level or root */}
              {minDistConstraint !== null && reachLevel === null && !isRoot && (
                <div style={{
                  minWidth: cellSize * 0.5,
                  height: cellSize * 0.4,
                  padding: "2px 4px",
                  borderRadius: "4px",
                  backgroundColor: "rgba(231, 76, 60, 0.85)",
                  border: "2px solid white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "11px",
                  fontWeight: "bold",
                  color: "white",
                }}>
                  ≥{minDistConstraint}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

interface ColorPaletteProps {
  selectedColor: number | null; // null means blank/eraser
  onColorSelect: (color: number | null) => void;
  numColors?: number;
}

export const ColorPalette: React.FC<ColorPaletteProps> = ({
  selectedColor,
  onColorSelect,
  numColors = 6,
}) => {
  return (
    <div
      style={{
        display: "flex",
        gap: "8px",
        flexWrap: "wrap",
        marginBottom: "16px",
      }}
    >
      {/* Blank/eraser option */}
      <button
        onClick={() => onColorSelect(null)}
        style={{
          width: "36px",
          height: "36px",
          background: BLANK_PATTERN,
          border:
            selectedColor === null
              ? "3px solid #2c3e50"
              : "2px solid #bdc3c7",
          borderRadius: "4px",
          cursor: "pointer",
          outline: "none",
          boxShadow:
            selectedColor === null
              ? "0 0 0 2px #3498db"
              : "none",
        }}
        title="Blank (eraser)"
      />
      {/* Color options */}
      {Array.from({ length: numColors }, (_, i) => (
        <button
          key={i}
          onClick={() => onColorSelect(i)}
          style={{
            width: "36px",
            height: "36px",
            backgroundColor: COLORS[i % COLORS.length],
            border:
              selectedColor === i
                ? "3px solid #2c3e50"
                : "2px solid #bdc3c7",
            borderRadius: "4px",
            cursor: "pointer",
            outline: "none",
            boxShadow:
              selectedColor === i
                ? "0 0 0 2px #3498db"
                : "none",
          }}
          title={`Color ${i + 1}`}
        />
      ))}
      {/* Hatch color option - doesn't need to be connected */}
      <button
        onClick={() => onColorSelect(HATCH_COLOR)}
        style={{
          width: "36px",
          height: "36px",
          background: HATCH_PATTERN,
          border:
            selectedColor === HATCH_COLOR
              ? "3px solid #2c3e50"
              : "2px solid #bdc3c7",
          borderRadius: "4px",
          cursor: "pointer",
          outline: "none",
          boxShadow:
            selectedColor === HATCH_COLOR
              ? "0 0 0 2px #3498db"
              : "none",
        }}
        title="Hatch (doesn't need to be connected)"
      />
    </div>
  );
};

interface ControlsProps {
  gridWidth: number;
  gridHeight: number;
  onWidthChange: (width: number) => void;
  onHeightChange: (height: number) => void;
  onSolve: () => void;
  onClear: () => void;
  onMazeSetup: () => void;
  onCancel?: () => void;
  solving: boolean;
  solutionStatus: "none" | "found" | "unsatisfiable" | "error";
  errorMessage?: string | null;
  solverType?: "minisat" | "cadical" | "dpll";
  onSolverTypeChange?: (solverType: "minisat" | "cadical" | "dpll") => void;
  solveTime?: number | null;
  solution?: GridSolution | null;
  gridType?: GridType;
  onGridTypeChange?: (gridType: GridType) => void;
  onDownloadColors?: () => void;
  onUploadColors?: (file: File) => void;
  grid?: { colors: (number | null)[][] };
  pathlengthConstraints?: PathlengthConstraint[];
  onPathlengthConstraintsChange?: (constraints: PathlengthConstraint[]) => void;
  selectedConstraintId?: string | null;
  onSelectedConstraintIdChange?: (id: string | null) => void;
}

export const Controls: React.FC<ControlsProps> = ({
  gridWidth,
  gridHeight,
  onWidthChange,
  onHeightChange,
  onSolve,
  onClear,
  onMazeSetup,
  onCancel,
  solving,
  solutionStatus,
  errorMessage,
  solverType = "cadical",
  onSolverTypeChange,
  solveTime,
  solution: _solution,
  gridType = "square",
  onGridTypeChange,
  onDownloadColors,
  onUploadColors,
  grid,
  // Unused props (will be used later for pathlength constraints UI)
  pathlengthConstraints: _pathlengthConstraints,
  onPathlengthConstraintsChange: _onPathlengthConstraintsChange,
  selectedConstraintId: _selectedConstraintId,
  onSelectedConstraintIdChange: _onSelectedConstraintIdChange,
}) => {
  // Note: Pathlength constraint props are passed through but not used in Controls.
  // The pathlength constraint management UI is in App.tsx using PathlengthConstraintEditor.
  // These props are kept for API consistency.
  void _solution;
  void _pathlengthConstraints;
  void _onPathlengthConstraintsChange;
  void _selectedConstraintId;
  void _onSelectedConstraintIdChange;
  
  // File input ref for upload
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && onUploadColors) {
      onUploadColors(file);
    }
    // Reset input so same file can be uploaded again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, [onUploadColors]);

  return (
    <div style={{ marginBottom: "16px" }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <label style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ minWidth: "50px" }}>Width:</span>
          <input
            type="range"
            min="2"
            max="20"
            value={gridWidth}
            onChange={(e) => onWidthChange(parseInt(e.target.value))}
            style={{ flex: 1, cursor: "pointer" }}
          />
          <span style={{ minWidth: "24px", textAlign: "right" }}>{gridWidth}</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{ minWidth: "50px" }}>Height:</span>
          <input
            type="range"
            min="2"
            max="20"
            value={gridHeight}
            onChange={(e) => onHeightChange(parseInt(e.target.value))}
            style={{ flex: 1, cursor: "pointer" }}
          />
          <span style={{ minWidth: "24px", textAlign: "right" }}>{gridHeight}</span>
        </label>
        {onSolverTypeChange && (
          <label style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ minWidth: "50px" }}>Solver:</span>
            <select
              value={solverType}
              onChange={(e) => onSolverTypeChange(e.target.value as "minisat" | "cadical" | "dpll")}
              style={{
                padding: "4px 8px",
                borderRadius: "4px",
                border: "1px solid #bdc3c7",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              <option value="cadical">CaDiCaL (2019)</option>
              <option value="minisat">MiniSat (2005)</option>
              <option value="dpll">DPLL (1962)</option>
            </select>
          </label>
        )}
        {onGridTypeChange && (
          <label style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ minWidth: "50px" }}>Grid:</span>
            <select
              value={gridType}
              onChange={(e) => onGridTypeChange(e.target.value as GridType)}
              style={{
                padding: "4px 8px",
                borderRadius: "4px",
                border: "1px solid #bdc3c7",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              <option value="square">Square</option>
              <option value="hex">Hex</option>
              <option value="octagon">Octagon</option>
              <option value="cairo">Cairo</option>
              <option value="cairobridge">Cairo Bridge</option>
            </select>
          </label>
        )}
      </div>
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button
          onClick={onSolve}
          disabled={solving}
          style={{
            padding: "8px 16px",
            backgroundColor: "#2ecc71",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: solving ? "not-allowed" : "pointer",
            fontWeight: "bold",
          }}
        >
          {solving ? "Solving..." : "Solve"}
        </button>
        {solving && onCancel && (
          <button
            onClick={onCancel}
            style={{
              padding: "8px 16px",
              backgroundColor: "#e67e22",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            Cancel
          </button>
        )}
        <button
          onClick={onClear}
          style={{
            padding: "8px 16px",
            backgroundColor: "#e74c3c",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Clear
        </button>
        <button
          onClick={onMazeSetup}
          style={{
            padding: "8px 16px",
            backgroundColor: "#3498db",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Maze Setup
        </button>
      </div>

      {/* Color CSV Download/Upload */}
      <div style={{ marginTop: "12px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {onDownloadColors && grid && (
          <button
            onClick={onDownloadColors}
            style={{
              padding: "6px 12px",
              backgroundColor: "#8e44ad",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            Download Colors (CSV)
          </button>
        )}
        {onUploadColors && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              style={{ display: "none" }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                padding: "6px 12px",
                backgroundColor: "#2980b9",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
                fontSize: "13px",
              }}
            >
              Upload Colors (CSV)
            </button>
          </>
        )}
      </div>

      {solutionStatus !== "none" && (
        <div
          style={{
            marginTop: "12px",
            padding: "8px 12px",
            borderRadius: "4px",
            backgroundColor:
              solutionStatus === "found"
                ? "#d5f5e3"
                : solutionStatus === "error"
                  ? "#fdebd0"
                  : "#fadbd8",
            color:
              solutionStatus === "found"
                ? "#1e8449"
                : solutionStatus === "error"
                  ? "#9c640c"
                  : "#922b21",
          }}
        >
          {solutionStatus === "found"
            ? `Solution found! Each color region is now connected.${solveTime !== undefined && solveTime !== null ? ` (${solveTime.toFixed(0)}ms with ${solverType === "cadical" ? "CaDiCaL" : solverType === "dpll" ? "DPLL" : "MiniSat"})` : ""}${_solution ? ` Walls: ${Math.round(_solution.wallEdges.length / (_solution.wallEdges.length + _solution.keptEdges.length) * 100)}%` : ""}`
            : solutionStatus === "error"
              ? errorMessage || "Unknown error occurred."
              : `No solution exists - some color regions cannot be connected.${solveTime !== undefined && solveTime !== null ? ` (${solveTime.toFixed(0)}ms with ${solverType === "cadical" ? "CaDiCaL" : solverType === "dpll" ? "DPLL" : "MiniSat"})` : ""}`}
        </div>
      )}
    </div>
  );
};
