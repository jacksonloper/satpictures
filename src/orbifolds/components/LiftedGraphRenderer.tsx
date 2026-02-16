/**
 * Lifted graph renderer.
 * Positions each lifted node using: voltage × orbifold node coordinates.
 * Colors each node using the ExtraData color from the orbifold node.
 * Highlights nodes whose orbifold node matches the inspected node.
 * 
 * Domains and node coloring are rendered using each orbifold node's polygon
 * geometry, transformed by the voltage matrix.
 * 
 * For P3 (axial coordinates), an optional transform can be applied to convert
 * axial coordinates to Cartesian for better visualization.
 */
import { useMemo } from "react";
import {
  type LiftedGraph,
  type OrbifoldGrid,
  type OrbifoldNodeId,
  type Matrix3x3,
  applyMatrix,
  axialToCartesian,
} from "../orbifoldbasics";
import { getEdgeLinestyle, type ColorData, type EdgeStyleData } from "../createOrbifolds";

// Constants
const LIFTED_CELL_SIZE = 16;
const GRID_PADDING = 20;

// Edge widths (doubled from original 3/1 to 6/2)
const SOLID_EDGE_WIDTH = 6;
const DASHED_EDGE_WIDTH = 2;

/**
 * Serialize a voltage matrix to a string key for uniqueness comparison.
 */
function voltageToKey(v: Matrix3x3): string {
  return v.map(row => row.join(',')).join(';');
}

/**
 * Generate a color from a voltage key for domain visualization.
 */
function colorFromVoltageKey(key: string, alpha: number = 0.15): string {
  // Simple hash to generate a hue
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) - hash) + key.charCodeAt(i);
    hash = hash | 0; // Convert to 32bit integer (safe for overflow)
  }
  const hue = Math.abs(hash) % 360;
  return `hsla(${hue}, 70%, 50%, ${alpha})`;
}

export function LiftedGraphRenderer({
  liftedGraph,
  orbifoldGrid,
  highlightOrbifoldNodeId,
  useAxialTransform = false,
  selectedVoltageKey,
  onNodeClick,
  showDomains = true,
  showDashedLines = true,
  showNodes = false,
  showWalls = false,
  svgRef,
}: {
  liftedGraph: LiftedGraph<ColorData, EdgeStyleData>;
  orbifoldGrid: OrbifoldGrid<ColorData, EdgeStyleData>;
  highlightOrbifoldNodeId?: OrbifoldNodeId | null;
  useAxialTransform?: boolean;
  selectedVoltageKey: string | null;
  onNodeClick: (liftedNodeId: string, voltageKey: string) => void;
  showDomains?: boolean;
  showDashedLines?: boolean;
  showNodes?: boolean;
  showWalls?: boolean;
  svgRef?: React.RefObject<SVGSVGElement | null>;
}) {
  const cellSize = LIFTED_CELL_SIZE;
  
  // Compute positions and bounds
  const nodePositions = useMemo(() => {
    const positions = new Map<string, { 
      x: number; 
      y: number; 
      color: "black" | "white"; 
      orbifoldNodeId: OrbifoldNodeId;
      voltageKey: string;
    }>();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    
    for (const [id, node] of liftedGraph.nodes) {
      const orbNode = orbifoldGrid.nodes.get(node.orbifoldNode);
      if (!orbNode) continue;
      
      const voltageKey = voltageToKey(node.voltage);
      
      // Position = voltage × orbifold node coordinates
      const [ox, oy] = orbNode.coord;
      let pos = applyMatrix(node.voltage, ox, oy);
      
      // Optionally apply axial-to-Cartesian transform for P3
      if (useAxialTransform) {
        pos = axialToCartesian(pos.x, pos.y);
      }
      
      minX = Math.min(minX, pos.x);
      maxX = Math.max(maxX, pos.x);
      minY = Math.min(minY, pos.y);
      maxY = Math.max(maxY, pos.y);
      
      const color = orbNode.data?.color ?? "white";
      positions.set(id, { x: pos.x, y: pos.y, color, orbifoldNodeId: node.orbifoldNode, voltageKey });
    }
    
    return { positions, minX, maxX, minY, maxY };
  }, [liftedGraph, orbifoldGrid, useAxialTransform]);

  const { positions, minX, maxX, minY, maxY } = nodePositions;
  
  // Compute per-lifted-node polygon geometry by transforming each orbifold
  // node's polygon vertices through the voltage matrix.
  const liftedNodePolygons = useMemo(() => {
    const polys: Array<{
      id: string;
      corners: Array<{ x: number; y: number }>;
      color: "black" | "white";
      voltageKey: string;
    }> = [];
    
    for (const [id, node] of liftedGraph.nodes) {
      const orbNode = orbifoldGrid.nodes.get(node.orbifoldNode);
      if (!orbNode) continue;
      
      const transformedCorners = orbNode.polygon.map(([px, py]) => {
        let pos = applyMatrix(node.voltage, px, py);
        if (useAxialTransform) {
          pos = axialToCartesian(pos.x, pos.y);
        }
        return pos;
      });
      
      const voltageKey = voltageToKey(node.voltage);
      polys.push({
        id,
        corners: transformedCorners,
        color: orbNode.data?.color ?? "white",
        voltageKey,
      });
    }
    
    return polys;
  }, [liftedGraph, orbifoldGrid, useAxialTransform]);
  
  // Collect dashed-edge polygon sides from the orbifold grid (walls).
  // For each orbifold node, gather the set of polygon side indices that
  // correspond to "dashed" edges — same logic as OrbifoldGridTools.
  const dashedSidesPerOrbifoldNode = useMemo(() => {
    const dashedSides = new Map<OrbifoldNodeId, Set<number>>();
    for (const edge of orbifoldGrid.edges.values()) {
      const linestyle = getEdgeLinestyle(orbifoldGrid, edge.id);
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
    return dashedSides;
  }, [orbifoldGrid]);

  // Build wall segments for the lifted view: for each lifted node, find which
  // polygon sides are walls (dashed) and emit the transformed line segments.
  const liftedWallSegments = useMemo(() => {
    const segments: Array<{
      key: string;
      x1: number; y1: number;
      x2: number; y2: number;
    }> = [];
    
    for (const poly of liftedNodePolygons) {
      const liftedNode = liftedGraph.nodes.get(poly.id);
      if (!liftedNode) continue;
      const sides = dashedSidesPerOrbifoldNode.get(liftedNode.orbifoldNode);
      if (!sides) continue;
      
      for (const sideIdx of sides) {
        const p1 = poly.corners[sideIdx];
        const p2 = poly.corners[(sideIdx + 1) % poly.corners.length];
        segments.push({
          key: `wall-${poly.id}-${sideIdx}`,
          x1: p1.x, y1: p1.y,
          x2: p2.x, y2: p2.y,
        });
      }
    }
    
    return segments;
  }, [liftedNodePolygons, liftedGraph, dashedSidesPerOrbifoldNode]);

  // Compute SVG dimensions with padding - include polygon corners in bounds
  const allBounds = useMemo(() => {
    let bMinX = minX, bMaxX = maxX, bMinY = minY, bMaxY = maxY;
    for (const poly of liftedNodePolygons) {
      for (const corner of poly.corners) {
        bMinX = Math.min(bMinX, corner.x);
        bMaxX = Math.max(bMaxX, corner.x);
        bMinY = Math.min(bMinY, corner.y);
        bMaxY = Math.max(bMaxY, corner.y);
      }
    }
    return { minX: bMinX, maxX: bMaxX, minY: bMinY, maxY: bMaxY };
  }, [minX, maxX, minY, maxY, liftedNodePolygons]);
  
  const padding = GRID_PADDING * 2;
  const rangeX = allBounds.maxX - allBounds.minX || 1;
  const rangeY = allBounds.maxY - allBounds.minY || 1;
  const scale = cellSize;
  const width = rangeX * scale + 2 * padding;
  const height = rangeY * scale + 2 * padding;

  // Transform coordinates to SVG space
  const toSvgX = (x: number) => padding + (x - allBounds.minX) * scale;
  const toSvgY = (y: number) => padding + (y - allBounds.minY) * scale;

  return (
    <svg
      ref={svgRef}
      width={Math.max(width, 200)}
      height={Math.max(height, 200)}
      style={{ border: "1px solid #ccc", borderRadius: "4px", backgroundColor: "#f8f9fa" }}
    >
      {/* Node polygon domains (drawn first, behind everything) */}
      {showDomains && liftedNodePolygons.map((poly) => {
        const isSelected = poly.voltageKey === selectedVoltageKey;
        const points = poly.corners
          .map(c => `${toSvgX(c.x)},${toSvgY(c.y)}`)
          .join(' ');
        
        return (
          <polygon
            key={`domain-${poly.id}`}
            points={points}
            fill={isSelected ? colorFromVoltageKey(poly.voltageKey, 0.4) : colorFromVoltageKey(poly.voltageKey)}
            stroke={isSelected ? colorFromVoltageKey(poly.voltageKey, 1.0) : colorFromVoltageKey(poly.voltageKey, 0.5)}
            strokeWidth={isSelected ? 3 : 1}
          />
        );
      })}
      
      {/* Black node shadings (drawn after domains, before edges) */}
      {liftedNodePolygons
        .filter(poly => poly.color === "black")
        .map((poly) => {
          const points = poly.corners
            .map(c => `${toSvgX(c.x)},${toSvgY(c.y)}`)
            .join(' ');
          
          return (
            <polygon
              key={`shading-${poly.id}`}
              points={points}
              fill="rgba(0, 0, 0, 0.5)"
              stroke="none"
            />
          );
        })}
      
      {/* Edges (hidden when showWalls is active) */}
      {!showWalls && Array.from(liftedGraph.edges.values()).map((edge) => {
        const posA = positions.get(edge.a);
        const posB = positions.get(edge.b);
        if (!posA || !posB) return null;
        
        // Get linestyle from orbifold edge
        const orbifoldEdge = edge.orbifoldEdgeId ? orbifoldGrid.edges.get(edge.orbifoldEdgeId) : undefined;
        const linestyle = orbifoldEdge?.data?.linestyle ?? "solid";
        
        // Hide dashed lines if showDashedLines is false
        if (linestyle === "dashed" && !showDashedLines) {
          return null;
        }
        
        // Solid lines: thick black paths; Dashed lines: thin gray dashed
        // All edges use round endcaps
        const isSolid = linestyle === "solid";
        
        return (
          <line
            key={edge.id}
            x1={toSvgX(posA.x)}
            y1={toSvgY(posA.y)}
            x2={toSvgX(posB.x)}
            y2={toSvgY(posB.y)}
            stroke={isSolid ? "#000000" : "#bdc3c7"}
            strokeWidth={isSolid ? SOLID_EDGE_WIDTH : DASHED_EDGE_WIDTH}
            strokeDasharray={isSolid ? undefined : "4,3"}
            strokeLinecap="round"
          />
        );
      })}
      
      {/* Walls: thick black lines on polygon sides with dashed edges */}
      {showWalls && liftedWallSegments.map((seg) => (
        <line
          key={seg.key}
          x1={toSvgX(seg.x1)}
          y1={toSvgY(seg.y1)}
          x2={toSvgX(seg.x2)}
          y2={toSvgY(seg.y2)}
          stroke="black"
          strokeWidth={3}
          strokeLinecap="round"
        />
      ))}
      
      {/* Nodes (optional, off by default) */}
      {showNodes && Array.from(positions.entries()).map(([id, pos]) => {
        const node = liftedGraph.nodes.get(id);
        const isInterior = node?.interior ?? false;
        const isHighlighted = highlightOrbifoldNodeId && pos.orbifoldNodeId === highlightOrbifoldNodeId;
        const isVoltageSelected = pos.voltageKey === selectedVoltageKey;
        
        return (
          <circle
            key={id}
            cx={toSvgX(pos.x)}
            cy={toSvgY(pos.y)}
            r={isHighlighted || isVoltageSelected ? cellSize / 2 : cellSize / 3}
            fill={pos.color === "black" ? "#2c3e50" : "white"}
            stroke={
              isVoltageSelected ? colorFromVoltageKey(pos.voltageKey, 1.0) :
              isHighlighted ? "#3498db" : 
              (isInterior ? "#27ae60" : "#e74c3c")
            }
            strokeWidth={isHighlighted || isVoltageSelected ? 3 : (isInterior ? 1 : 2)}
            style={{ cursor: "pointer" }}
            onClick={() => onNodeClick(id, pos.voltageKey)}
          />
        );
      })}
    </svg>
  );
}
