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

// Dilation parameters - control the "road" thickness
const DILATION_RADIUS = 6; // Pixels to dilate in each direction
const BORDER_THICKNESS = 3; // White border thickness

// Line width and node size ratios (as fraction of cellSize)
const EDGE_LINE_WIDTH_RATIO = 0.06;
const NODE_RADIUS_RATIO = 0.06;
const BRIDGE_GAP_WIDTH_MULTIPLIER = 2.5;
const BRIDGE_GAP_LENGTH_RATIO = 0.3;

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
  }

  const { regularEdges, downSlantEdges, upSlantEdges } = useMemo(() => {
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
        
        allEdges.push({
          x1: node1.cx,
          y1: node1.cy,
          x2: node2.cx,
          y2: node2.cy,
          isDiagonal: diagonal,
          isDownSlant: downSlant,
        });
      }
    }
    
    // Separate edges based on grid type
    const regular: EdgeData[] = [];
    const downSlant: EdgeData[] = [];
    const upSlant: EdgeData[] = [];
    
    if (gridType === "octagon" || gridType === "cairobridge") {
      for (const edge of allEdges) {
        if (edge.isDiagonal) {
          if (edge.isDownSlant) {
            downSlant.push(edge);
          } else {
            upSlant.push(edge);
          }
        } else {
          regular.push(edge);
        }
      }
    } else {
      regular.push(...allEdges);
    }
    
    return { regularEdges: regular, downSlantEdges: downSlant, upSlantEdges: upSlant };
  }, [solution.keptEdges, nodeMap, gridType]);

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

    // Function to render a road layer with border
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
      
      // Create a canvas for the gray road
      const roadCanvas = document.createElement("canvas");
      roadCanvas.width = width;
      roadCanvas.height = height;
      const roadCtx = roadCanvas.getContext("2d");
      if (!roadCtx) return;
      
      roadCtx.putImageData(roadData, 0, 0);
      roadCtx.globalCompositeOperation = "source-in";
      roadCtx.fillStyle = ROAD_COLOR;
      roadCtx.fillRect(0, 0, width, height);
      
      targetCtx.drawImage(roadCanvas, 0, 0);
    };

    // For grids with crossing edges (octagon, cairobridge), render in layers
    const hasCrossingEdges = gridType === "octagon" || gridType === "cairobridge";
    
    if (hasCrossingEdges && (downSlantEdges.length > 0 || upSlantEdges.length > 0)) {
      // Layer 1: Regular (non-diagonal) edges
      renderRoadLayer(ctx, regularEdges, true);
      
      // Layer 2: Down-slant edges (go "under")
      renderRoadLayer(ctx, downSlantEdges, true);
      
      // Layer 3: "Bridge" gap - we need to create white gaps where up-slant crosses down-slant
      // Create white rectangles at crossing points
      if (upSlantEdges.length > 0 && downSlantEdges.length > 0) {
        const bridgeGapCanvas = document.createElement("canvas");
        bridgeGapCanvas.width = width;
        bridgeGapCanvas.height = height;
        const bridgeGapCtx = bridgeGapCanvas.getContext("2d");
        if (bridgeGapCtx) {
          bridgeGapCtx.clearRect(0, 0, width, height);
          
          // Create bridge gaps at midpoints of up-slant edges
          const bridgeWidth = (DILATION_RADIUS + BORDER_THICKNESS) * BRIDGE_GAP_WIDTH_MULTIPLIER;
          const bridgeLength = cellSize * BRIDGE_GAP_LENGTH_RATIO;
          
          for (const upEdge of upSlantEdges) {
            const midX = (upEdge.x1 + upEdge.x2) / 2;
            const midY = (upEdge.y1 + upEdge.y2) / 2;
            
            // Direction of edge (used for rotation)
            const dx = upEdge.x2 - upEdge.x1;
            const dy = upEdge.y2 - upEdge.y1;
            const len = Math.sqrt(dx * dx + dy * dy);
            
            if (len < 0.001) continue;
            
            // Draw background rectangle at crossing
            bridgeGapCtx.save();
            bridgeGapCtx.translate(midX, midY);
            bridgeGapCtx.rotate(Math.atan2(dy, dx));
            bridgeGapCtx.fillStyle = SVG_BACKGROUND_COLOR;
            bridgeGapCtx.fillRect(-bridgeLength / 2, -bridgeWidth / 2, bridgeLength, bridgeWidth);
            bridgeGapCtx.restore();
          }
          
          ctx.drawImage(bridgeGapCanvas, 0, 0);
        }
      }
      
      // Layer 4: Up-slant edges (go "over") 
      renderRoadLayer(ctx, upSlantEdges, true);
    } else {
      // For simple grids, render all edges in one layer
      const allEdges = [...regularEdges, ...downSlantEdges, ...upSlantEdges];
      renderRoadLayer(ctx, allEdges, true);
    }

    // Draw small dots at nodes (optional, for visual clarity)
    const nodeRadius = cellSize * NODE_RADIUS_RATIO;
    ctx.fillStyle = ROAD_COLOR;
    for (const node of nodes) {
      ctx.beginPath();
      ctx.arc(node.cx, node.cy, nodeRadius, 0, Math.PI * 2);
      ctx.fill();
    }

  }, [totalWidth, totalHeight, cellSize, gridType, nodes, regularEdges, downSlantEdges, upSlantEdges]);

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
