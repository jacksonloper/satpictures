/**
 * Lifted graph renderer.
 * Positions each lifted node using: voltage × orbifold node coordinates.
 * Colors each node using the ExtraData color from the orbifold node.
 * Highlights nodes whose orbifold node matches the inspected node.
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
import { type ColorData, type EdgeStyleData } from "../createOrbifolds";

// Constants
const LIFTED_CELL_SIZE = 16;
const GRID_PADDING = 20;

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
  fundamentalDomainSize,
  selectedVoltageKey,
  onNodeClick,
  showDomains = true,
  showDashedLines = true,
}: {
  liftedGraph: LiftedGraph<ColorData, EdgeStyleData>;
  orbifoldGrid: OrbifoldGrid<ColorData, EdgeStyleData>;
  highlightOrbifoldNodeId?: OrbifoldNodeId | null;
  useAxialTransform?: boolean;
  fundamentalDomainSize: number;
  selectedVoltageKey: string | null;
  onNodeClick: (liftedNodeId: string, voltageKey: string) => void;
  showDomains?: boolean;
  showDashedLines?: boolean;
}) {
  const cellSize = LIFTED_CELL_SIZE;
  
  // Compute positions, bounds, and collect unique voltages
  const { nodePositions, uniqueVoltages } = useMemo(() => {
    const positions = new Map<string, { 
      x: number; 
      y: number; 
      color: "black" | "white"; 
      orbifoldNodeId: OrbifoldNodeId;
      voltageKey: string;
    }>();
    const voltages = new Map<string, Matrix3x3>();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    
    for (const [id, node] of liftedGraph.nodes) {
      const orbNode = orbifoldGrid.nodes.get(node.orbifoldNode);
      if (!orbNode) continue;
      
      // Track unique voltages
      const voltageKey = voltageToKey(node.voltage);
      if (!voltages.has(voltageKey)) {
        voltages.set(voltageKey, node.voltage);
      }
      
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
    
    return { 
      nodePositions: { positions, minX, maxX, minY, maxY },
      uniqueVoltages: voltages,
    };
  }, [liftedGraph, orbifoldGrid, useAxialTransform]);

  const { positions, minX, maxX, minY, maxY } = nodePositions;
  
  // Compute transformed fundamental domains for each unique voltage
  const transformedDomains = useMemo(() => {
    const domains: Array<{
      key: string;
      corners: Array<{ x: number; y: number }>;
      color: string;
    }> = [];
    
    // The fundamental domain corners: (0, 0), (2n, 0), (2n, 2n), (0, 2n)
    const domainSize = fundamentalDomainSize * 2; // 2n
    const originalCorners = [
      { x: 0, y: 0 },
      { x: domainSize, y: 0 },
      { x: domainSize, y: domainSize },
      { x: 0, y: domainSize },
    ];
    
    for (const [key, voltage] of uniqueVoltages) {
      const transformedCorners = originalCorners.map(corner => {
        let pos = applyMatrix(voltage, corner.x, corner.y);
        if (useAxialTransform) {
          pos = axialToCartesian(pos.x, pos.y);
        }
        return pos;
      });
      
      domains.push({
        key,
        corners: transformedCorners,
        color: colorFromVoltageKey(key),
      });
    }
    
    return domains;
  }, [uniqueVoltages, fundamentalDomainSize, useAxialTransform]);
  
  // Compute SVG dimensions with padding - include domain corners in bounds
  const allBounds = useMemo(() => {
    let bMinX = minX, bMaxX = maxX, bMinY = minY, bMaxY = maxY;
    for (const domain of transformedDomains) {
      for (const corner of domain.corners) {
        bMinX = Math.min(bMinX, corner.x);
        bMaxX = Math.max(bMaxX, corner.x);
        bMinY = Math.min(bMinY, corner.y);
        bMaxY = Math.max(bMaxY, corner.y);
      }
    }
    return { minX: bMinX, maxX: bMaxX, minY: bMinY, maxY: bMaxY };
  }, [minX, maxX, minY, maxY, transformedDomains]);
  
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
      width={Math.max(width, 200)}
      height={Math.max(height, 200)}
      style={{ border: "1px solid #ccc", borderRadius: "4px", backgroundColor: "#f8f9fa" }}
    >
      {/* Transformed fundamental domains (drawn first, behind everything) */}
      {showDomains && transformedDomains.map((domain) => {
        const isSelected = domain.key === selectedVoltageKey;
        const points = domain.corners
          .map(c => `${toSvgX(c.x)},${toSvgY(c.y)}`)
          .join(' ');
        
        return (
          <polygon
            key={`domain-${domain.key}`}
            points={points}
            fill={isSelected ? colorFromVoltageKey(domain.key, 0.4) : domain.color}
            stroke={isSelected ? colorFromVoltageKey(domain.key, 1.0) : colorFromVoltageKey(domain.key, 0.5)}
            strokeWidth={isSelected ? 3 : 1}
          />
        );
      })}
      
      {/* Edges */}
      {Array.from(liftedGraph.edges.values()).map((edge) => {
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
        const isSolid = linestyle === "solid";
        
        return (
          <line
            key={edge.id}
            x1={toSvgX(posA.x)}
            y1={toSvgY(posA.y)}
            x2={toSvgX(posB.x)}
            y2={toSvgY(posB.y)}
            stroke={isSolid ? "#000000" : "#bdc3c7"}
            strokeWidth={isSolid ? 3 : 1}
            strokeDasharray={isSolid ? undefined : "4,3"}
            strokeLinecap={isSolid ? "round" : undefined}
          />
        );
      })}
      
      {/* Nodes */}
      {Array.from(positions.entries()).map(([id, pos]) => {
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
