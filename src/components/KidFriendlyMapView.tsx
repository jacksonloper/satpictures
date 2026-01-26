/**
 * Kid-Friendly Map View Component
 * 
 * Renders the maze graph as a rasterized image with thick "road" lines:
 * 1. Renders edges to binary canvas images
 * 2. Applies morphological dilation to create thick roads
 * 3. Fills with light gray road color with white border
 * 4. Makes background transparent
 * 
 * For oct and cairobridge grids: handles under/over edge layering
 */

import React, { useRef, useEffect, useMemo } from "react";
import type { ColorGrid, GridSolution, GridType } from "../problem";
import {
  getHexDimensions,
  getHexCenter,
  getCairoTile,
  createCairoTransformer,
  polyCentroid,
  calculateGridDimensions,
  DEFAULT_WALL_THICKNESS,
  COLORS,
} from "./gridConstants";

interface KidFriendlyMapViewProps {
  grid: ColorGrid;
  solution: GridSolution;
  cellSize?: number;
  gridType?: GridType;
}

// Colors for the kid-friendly map
const ROAD_COLOR = "#c0c0c0"; // Light gray road
const ROAD_BORDER_COLOR = "#ffffff"; // White border
const SVG_BACKGROUND_COLOR = "#f5f5f5"; // Match SVG background
const COLOR_TINT_STRENGTH = 0.15; // How much to tint roads with their color (0-1)

// Dilation parameters - control the "road" thickness
const DILATION_RADIUS = 6; // Pixels to dilate in each direction
const BORDER_THICKNESS = 3; // White border thickness

// Line width and node size ratios (as fraction of cellSize)
const EDGE_LINE_WIDTH_RATIO = 0.06;
const NODE_RADIUS_RATIO = 0.06;

// Helper to blend two colors
function blendColors(baseColor: string, tintColor: string, tintStrength: number): string {
  // Parse base color
  const baseR = parseInt(baseColor.slice(1, 3), 16);
  const baseG = parseInt(baseColor.slice(3, 5), 16);
  const baseB = parseInt(baseColor.slice(5, 7), 16);
  
  // Parse tint color
  const tintR = parseInt(tintColor.slice(1, 3), 16);
  const tintG = parseInt(tintColor.slice(3, 5), 16);
  const tintB = parseInt(tintColor.slice(5, 7), 16);
  
  // Blend
  const r = Math.round(baseR * (1 - tintStrength) + tintR * tintStrength);
  const g = Math.round(baseG * (1 - tintStrength) + tintG * tintStrength);
  const b = Math.round(baseB * (1 - tintStrength) + tintB * tintStrength);
  
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export const KidFriendlyMapView: React.FC<KidFriendlyMapViewProps> = ({
  grid,
  solution,
  cellSize = 40,
  gridType = "square",
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Calculate grid dimensions
  const wallThickness = DEFAULT_WALL_THICKNESS;
  const { totalWidth, totalHeight } = calculateGridDimensions(
    grid.width,
    grid.height,
    cellSize,
    gridType,
    wallThickness
  );

  // Hex grid calculations
  const { hexSize, hexWidth, hexHorizSpacing, hexVertSpacing } = getHexDimensions(cellSize);
  
  // Cairo transformer
  const padding = wallThickness;
  const availableWidth = totalWidth - 2 * padding;
  const availableHeight = totalHeight - 2 * padding;

  // Compute node positions based on grid type
  interface NodeData {
    row: number;
    col: number;
    cx: number;
    cy: number;
  }

  const nodes = useMemo(() => {
    const nodeList: NodeData[] = [];
    
    if (gridType === "square") {
      for (let row = 0; row < grid.height; row++) {
        for (let col = 0; col < grid.width; col++) {
          const cx = col * cellSize + cellSize / 2;
          const cy = row * cellSize + cellSize / 2;
          nodeList.push({ row, col, cx, cy });
        }
      }
    } else if (gridType === "hex") {
      for (let row = 0; row < grid.height; row++) {
        for (let col = 0; col < grid.width; col++) {
          const { cx, cy } = getHexCenter(row, col, hexWidth, hexSize, hexHorizSpacing, hexVertSpacing, padding);
          nodeList.push({ row, col, cx, cy });
        }
      }
    } else if (gridType === "octagon") {
      for (let row = 0; row < grid.height; row++) {
        for (let col = 0; col < grid.width; col++) {
          const cx = padding + cellSize / 2 + col * cellSize;
          const cy = padding + cellSize / 2 + row * cellSize;
          nodeList.push({ row, col, cx, cy });
        }
      }
    } else if (gridType === "cairo" || gridType === "cairobridge") {
      const toSvg = createCairoTransformer(grid.width, grid.height, availableWidth, availableHeight, padding);
      
      for (let row = 0; row < grid.height; row++) {
        for (let col = 0; col < grid.width; col++) {
          const tile = getCairoTile(row, col);
          const centroid = toSvg(polyCentroid(tile));
          nodeList.push({ row, col, cx: centroid[0], cy: centroid[1] });
        }
      }
    }
    
    return nodeList;
  }, [grid.width, grid.height, cellSize, gridType, hexWidth, hexSize, hexHorizSpacing, hexVertSpacing, padding, availableWidth, availableHeight]);

  // Create node lookup map
  const nodeMap = useMemo(() => {
    const map = new Map<string, NodeData>();
    for (const node of nodes) {
      map.set(`${node.row},${node.col}`, node);
    }
    return map;
  }, [nodes]);

  // Compute edge data
  interface EdgeData {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    isDiagonal: boolean;
    isDownSlant: boolean;
    color: number; // Color index of the edge (from node colors)
  }

  // Helper to check if two line segments intersect (excluding endpoints)
  const segmentsIntersect = (
    x1: number, y1: number, x2: number, y2: number,
    x3: number, y3: number, x4: number, y4: number
  ): boolean => {
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 0.0001) return false; // Parallel lines
    
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
    
    // Check if intersection is strictly between endpoints (not at endpoints)
    return t > 0.01 && t < 0.99 && u > 0.01 && u < 0.99;
  };

  const { nonCrossingEdges, crossingEdges } = useMemo(() => {
    const allEdges: EdgeData[] = [];
    
    const isDiagonalEdge = (e: { u: { row: number; col: number }; v: { row: number; col: number } }) => {
      return e.u.row !== e.v.row && e.u.col !== e.v.col;
    };
    
    const isDownSlantDiagonal = (e: { u: { row: number; col: number }; v: { row: number; col: number } }) => {
      const dRow = e.v.row - e.u.row;
      const dCol = e.v.col - e.u.col;
      return (dRow > 0 && dCol > 0) || (dRow < 0 && dCol < 0);
    };
    
    for (const edge of solution.keptEdges) {
      const node1 = nodeMap.get(`${edge.u.row},${edge.u.col}`);
      const node2 = nodeMap.get(`${edge.v.row},${edge.v.col}`);
      
      if (node1 && node2) {
        const diagonal = isDiagonalEdge(edge);
        const downSlant = diagonal ? isDownSlantDiagonal(edge) : false;
        // Get color from the assigned colors (use node1's color)
        const edgeColor = solution.assignedColors[node1.row]?.[node1.col] ?? 0;
        
        allEdges.push({
          x1: node1.cx,
          y1: node1.cy,
          x2: node2.cx,
          y2: node2.cy,
          isDiagonal: diagonal,
          isDownSlant: downSlant,
          color: edgeColor,
        });
      }
    }
    
    // For grids with potential crossings (octagon, cairobridge), find actual crossing pairs
    if (gridType === "octagon" || gridType === "cairobridge") {
      // Find all pairs of edges that actually cross
      const crossingPairs: [number, number][] = [];
      
      for (let i = 0; i < allEdges.length; i++) {
        for (let j = i + 1; j < allEdges.length; j++) {
          const e1 = allEdges[i];
          const e2 = allEdges[j];
          
          if (segmentsIntersect(e1.x1, e1.y1, e1.x2, e1.y2, e2.x1, e2.y1, e2.x2, e2.y2)) {
            crossingPairs.push([i, j]);
          }
        }
      }
      
      // For each crossing pair, put one edge in the "under" bucket (crossing edges)
      // and leave the other in the non-crossing set
      const crossingEdgeIndices = new Set<number>();
      
      for (const [i, j] of crossingPairs) {
        // Put the down-slant edge in the crossing bucket (rendered as rectangle underneath)
        // If both are same slant, just pick one
        const e1 = allEdges[i];
        const e2 = allEdges[j];
        
        if (e1.isDownSlant && !e2.isDownSlant) {
          crossingEdgeIndices.add(i);
        } else if (!e1.isDownSlant && e2.isDownSlant) {
          crossingEdgeIndices.add(j);
        } else {
          // Both same slant - pick the first one
          crossingEdgeIndices.add(i);
        }
      }
      
      const nonCrossing: EdgeData[] = [];
      const crossing: EdgeData[] = [];
      
      for (let i = 0; i < allEdges.length; i++) {
        if (crossingEdgeIndices.has(i)) {
          crossing.push(allEdges[i]);
        } else {
          nonCrossing.push(allEdges[i]);
        }
      }
      
      return { nonCrossingEdges: nonCrossing, crossingEdges: crossing };
    } else {
      // For simple grids, all edges are non-crossing
      return { nonCrossingEdges: allEdges, crossingEdges: [] };
    }
  }, [solution.keptEdges, solution.assignedColors, nodeMap, gridType]);

  // Render the kid-friendly map
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const width = Math.ceil(totalWidth);
    const height = Math.ceil(totalHeight);
    canvas.width = width;
    canvas.height = height;

    // Clear canvas with transparent background
    ctx.clearRect(0, 0, width, height);

    // Edge line width for initial drawing (before dilation)
    const baseLineWidth = cellSize * EDGE_LINE_WIDTH_RATIO;

    // Function to draw edges on a canvas context
    const drawEdges = (targetCtx: CanvasRenderingContext2D, edges: EdgeData[], color: string) => {
      targetCtx.strokeStyle = color;
      targetCtx.lineWidth = baseLineWidth;
      targetCtx.lineCap = "round";
      
      for (const edge of edges) {
        targetCtx.beginPath();
        targetCtx.moveTo(edge.x1, edge.y1);
        targetCtx.lineTo(edge.x2, edge.y2);
        targetCtx.stroke();
      }
    };

    // Function to apply morphological dilation to image data
    const dilate = (imageData: ImageData, radius: number): ImageData => {
      const { width: w, height: h, data } = imageData;
      const output = new Uint8ClampedArray(data.length);
      
      // Create a circular structuring element
      const radiusSq = radius * radius;
      
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const outIdx = (y * w + x) * 4;
          let maxAlpha = 0;
          
          // Check all pixels in the structuring element
          for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
              // Circular check
              if (dx * dx + dy * dy > radiusSq) continue;
              
              const nx = x + dx;
              const ny = y + dy;
              
              if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                const inIdx = (ny * w + nx) * 4;
                maxAlpha = Math.max(maxAlpha, data[inIdx + 3]);
              }
            }
          }
          
          // Set output pixel
          if (maxAlpha > 0) {
            output[outIdx] = 255;
            output[outIdx + 1] = 255;
            output[outIdx + 2] = 255;
            output[outIdx + 3] = maxAlpha;
          }
        }
      }
      
      return new ImageData(output, w, h);
    };

    // Function to create a road image from edges
    const createRoadLayer = (edges: EdgeData[]): ImageData | null => {
      if (edges.length === 0) return null;
      
      // Create temporary canvas for the edges
      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = width;
      tempCanvas.height = height;
      const tempCtx = tempCanvas.getContext("2d");
      if (!tempCtx) return null;
      
      // Clear and draw edges in white
      tempCtx.clearRect(0, 0, width, height);
      drawEdges(tempCtx, edges, "#ffffff");
      
      // Get image data and dilate
      const imageData = tempCtx.getImageData(0, 0, width, height);
      const dilatedData = dilate(imageData, DILATION_RADIUS);
      
      return dilatedData;
    };

    // Function to render a road layer with border - now with color tinting
    const renderRoadLayer = (
      targetCtx: CanvasRenderingContext2D,
      edges: EdgeData[],
      applyBorder: boolean = true
    ) => {
      if (edges.length === 0) return;
      
      // Create dilated road image
      const roadData = createRoadLayer(edges);
      if (!roadData) return;
      
      // Create a canvas for the border (larger dilation)
      if (applyBorder) {
        const borderEdges = [...edges];
        const borderCanvas = document.createElement("canvas");
        borderCanvas.width = width;
        borderCanvas.height = height;
        const borderCtx = borderCanvas.getContext("2d");
        if (!borderCtx) return;
        
        // Clear and draw edges
        borderCtx.clearRect(0, 0, width, height);
        drawEdges(borderCtx, borderEdges, "#ffffff");
        
        // Dilate more for the border
        const borderImageData = borderCtx.getImageData(0, 0, width, height);
        const dilatedBorder = dilate(borderImageData, DILATION_RADIUS + BORDER_THICKNESS);
        
        // Draw the white border layer
        const borderDataCanvas = document.createElement("canvas");
        borderDataCanvas.width = width;
        borderDataCanvas.height = height;
        const borderDataCtx = borderDataCanvas.getContext("2d");
        if (!borderDataCtx) return;
        
        borderDataCtx.putImageData(dilatedBorder, 0, 0);
        
        // Composite: use the dilated border as an alpha mask for white color
        targetCtx.globalCompositeOperation = "source-over";
        targetCtx.fillStyle = ROAD_BORDER_COLOR;
        
        // Create a temporary canvas for the white border fill
        const whiteFillCanvas = document.createElement("canvas");
        whiteFillCanvas.width = width;
        whiteFillCanvas.height = height;
        const whiteFillCtx = whiteFillCanvas.getContext("2d");
        if (!whiteFillCtx) return;
        
        // Fill with white where the border mask is
        whiteFillCtx.putImageData(dilatedBorder, 0, 0);
        whiteFillCtx.globalCompositeOperation = "source-in";
        whiteFillCtx.fillStyle = ROAD_BORDER_COLOR;
        whiteFillCtx.fillRect(0, 0, width, height);
        
        targetCtx.drawImage(whiteFillCanvas, 0, 0);
      }
      
      // Create a canvas for the gray road with color tinting
      const roadCanvas = document.createElement("canvas");
      roadCanvas.width = width;
      roadCanvas.height = height;
      const roadCtx = roadCanvas.getContext("2d");
      if (!roadCtx) return;
      
      // First, draw the base gray road
      roadCtx.putImageData(roadData, 0, 0);
      roadCtx.globalCompositeOperation = "source-in";
      roadCtx.fillStyle = ROAD_COLOR;
      roadCtx.fillRect(0, 0, width, height);
      
      targetCtx.drawImage(roadCanvas, 0, 0);
      
      // Now draw tinted roads on top for each edge color
      // Group edges by color
      const edgesByColor = new Map<number, EdgeData[]>();
      for (const edge of edges) {
        const colorEdges = edgesByColor.get(edge.color) ?? [];
        colorEdges.push(edge);
        edgesByColor.set(edge.color, colorEdges);
      }
      
      // Draw each color group with its tint
      for (const [colorIndex, colorEdges] of edgesByColor) {
        const edgeColor = COLORS[colorIndex % COLORS.length];
        const tintedRoadColor = blendColors(ROAD_COLOR, edgeColor, COLOR_TINT_STRENGTH);
        
        // Create dilated image for just these edges
        const colorRoadData = createRoadLayer(colorEdges);
        if (!colorRoadData) continue;
        
        const colorRoadCanvas = document.createElement("canvas");
        colorRoadCanvas.width = width;
        colorRoadCanvas.height = height;
        const colorRoadCtx = colorRoadCanvas.getContext("2d");
        if (!colorRoadCtx) continue;
        
        colorRoadCtx.putImageData(colorRoadData, 0, 0);
        colorRoadCtx.globalCompositeOperation = "source-in";
        colorRoadCtx.fillStyle = tintedRoadColor;
        colorRoadCtx.fillRect(0, 0, width, height);
        
        targetCtx.drawImage(colorRoadCanvas, 0, 0);
      }
    };

    // Function to draw a bridge (crossing edge) with white lines on sides only
    const drawBridge = (
      targetCtx: CanvasRenderingContext2D,
      edge: EdgeData
    ) => {
      const dx = edge.x2 - edge.x1;
      const dy = edge.y2 - edge.y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      
      if (len < 0.001) return;
      
      // Get tinted color for this edge
      const edgeColor = COLORS[edge.color % COLORS.length];
      const tintedRoadColor = blendColors(ROAD_COLOR, edgeColor, COLOR_TINT_STRENGTH);
      
      // Bridge dimensions
      const bridgeWidth = DILATION_RADIUS * 2; // Inner road width
      const borderWidth = BORDER_THICKNESS; // White border on each side
      const totalWidth = bridgeWidth + borderWidth * 2;
      
      targetCtx.save();
      targetCtx.translate((edge.x1 + edge.x2) / 2, (edge.y1 + edge.y2) / 2);
      targetCtx.rotate(Math.atan2(dy, dx));
      
      // Draw white border lines on sides only (top and bottom, not start/end)
      targetCtx.fillStyle = ROAD_BORDER_COLOR;
      // Top border line
      targetCtx.fillRect(-len / 2, -totalWidth / 2, len, borderWidth);
      // Bottom border line
      targetCtx.fillRect(-len / 2, totalWidth / 2 - borderWidth, len, borderWidth);
      
      // Draw gray (tinted) road in the middle
      targetCtx.fillStyle = tintedRoadColor;
      targetCtx.fillRect(-len / 2, -bridgeWidth / 2, len, bridgeWidth);
      
      targetCtx.restore();
    };

    // Render based on whether we have crossing edges
    if (crossingEdges.length > 0) {
      // Page A: Draw non-crossing edges with dilation, white border, transparent background
      const pageACanvas = document.createElement("canvas");
      pageACanvas.width = width;
      pageACanvas.height = height;
      const pageACtx = pageACanvas.getContext("2d");
      
      if (pageACtx) {
        pageACtx.clearRect(0, 0, width, height);
        renderRoadLayer(pageACtx, nonCrossingEdges, true);
        
        // Render Page A to main canvas first
        ctx.drawImage(pageACanvas, 0, 0);
      }
      
      // Draw bridges ON TOP of Page A
      for (const edge of crossingEdges) {
        drawBridge(ctx, edge);
      }
    } else {
      // No crossing edges - render all edges normally
      renderRoadLayer(ctx, nonCrossingEdges, true);
    }

    // Draw small dots at nodes (optional, for visual clarity)
    const nodeRadius = cellSize * NODE_RADIUS_RATIO;
    ctx.fillStyle = ROAD_COLOR;
    for (const node of nodes) {
      ctx.beginPath();
      ctx.arc(node.cx, node.cy, nodeRadius, 0, Math.PI * 2);
      ctx.fill();
    }

  }, [totalWidth, totalHeight, cellSize, gridType, nodes, nonCrossingEdges, crossingEdges]);

  return (
    <div
      className="kid-friendly-map-container"
      style={{
        position: "relative",
        userSelect: "none",
        backgroundColor: SVG_BACKGROUND_COLOR,
        borderRadius: "4px",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
        }}
      />
    </div>
  );
};
