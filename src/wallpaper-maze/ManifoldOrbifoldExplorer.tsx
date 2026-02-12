/**
 * ManifoldOrbifoldExplorer.tsx
 * 
 * A new UI component for exploring Manifolds and Orbifolds.
 * 
 * Features:
 * - Pick a manifold type (P1, P2) and size n
 * - Click on nodes to see edges on that manifold
 * - Pick multiplier and compatible orbifold
 * - View copies of the manifold with voltage-based correspondence
 */

import { useState, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import {
  buildManifold,
  buildOrbifold,
  expandCopies,
  getNodeEdges,
  getOtherNode,
  isStubEdge,
  applyMatrix3x3,
  matrixKey,
  matmul3x3,
  IDENTITY_3X3,
  generateRandomSpanningTree,
  type ManifoldType,
  type Matrix3x3,
  type OrbifoldEdge,
} from "./ManifoldOrbifold";

/** Selection state: a node in a specific copy */
interface NodeSelection {
  nodeIndex: number;
  copyMatrix: Matrix3x3;  // The copy's transform matrix
  copyKey: string;        // For comparison
}

/** An edge from the perspective of a selected node, with properly oriented voltage */
interface OrientedEdge {
  targetNodeIndex: number;
  voltage: Matrix3x3;     // Voltage going FROM selected node TO target
  isReversed: boolean;    // Was the original edge reversed?
  originalEdge: OrbifoldEdge;
  direction: string;      // N, S, E, W for P2 edges
}

// Constants
const CELL_SIZE = 50;
const NODE_RADIUS = 15;
const PADDING = 40;
/** Offset to center position within a cell (0.5 = center of 0-1 range) */
const NODE_CENTER_OFFSET = 0.5;

// Golden ratio for spreading colors
const GOLDEN_RATIO = 0.618033988749895;

function getCopyColor(index: number): string {
  const hue = ((index * GOLDEN_RATIO) % 1) * 360;
  return `hsl(${hue}, 70%, 60%)`;
}

export function ManifoldOrbifoldExplorer() {
  // State
  const [manifoldType, setManifoldType] = useState<ManifoldType>("P1");
  const [size, setSize] = useState(3);
  const [selection, setSelection] = useState<NodeSelection | null>(null);
  const [multiplier, setMultiplier] = useState(2);
  const [showOrbifold, setShowOrbifold] = useState(false);
  const [showEdgeDetails, setShowEdgeDetails] = useState(false);
  const [spanningTree, setSpanningTree] = useState<Set<number> | null>(null);
  
  // Build manifold and orbifold
  const manifold = useMemo(() => buildManifold(manifoldType, size), [manifoldType, size]);
  const orbifold = useMemo(() => buildOrbifold(manifoldType, size), [manifoldType, size]);
  
  // Clear spanning tree when manifold changes
  useMemo(() => {
    setSpanningTree(null);
  }, [manifoldType, size]);
  
  // Expand copies using BFS
  const copies = useMemo(() => {
    if (!showOrbifold) return [];
    return expandCopies(orbifold, multiplier);
  }, [orbifold, multiplier, showOrbifold]);
  
  // Generate random spanning tree
  const handleGenerateSpanningTree = useCallback(() => {
    setSpanningTree(generateRandomSpanningTree(manifold));
  }, [manifold]);
  
  // Clear spanning tree
  const handleClearSpanningTree = useCallback(() => {
    setSpanningTree(null);
  }, []);
  
  // Handle node click in fundamental domain (identity copy)
  const handleNodeClick = useCallback((nodeIndex: number) => {
    setSelection(prev => {
      if (prev && prev.nodeIndex === nodeIndex && matrixKey(prev.copyMatrix) === matrixKey(IDENTITY_3X3)) {
        return null;
      }
      return { nodeIndex, copyMatrix: IDENTITY_3X3, copyKey: matrixKey(IDENTITY_3X3) };
    });
  }, []);
  
  // Handle node click in a copy (orbifold view)
  const handleCopyNodeClick = useCallback((nodeIndex: number, copyMatrix: Matrix3x3) => {
    const copyKey = matrixKey(copyMatrix);
    setSelection(prev => {
      if (prev && prev.nodeIndex === nodeIndex && prev.copyKey === copyKey) {
        return null;
      }
      return { nodeIndex, copyMatrix, copyKey };
    });
  }, []);
  
  // Get edges for selected node in the manifold (fundamental domain)
  const selectedEdges = useMemo(() => {
    if (!selection) return [];
    return getNodeEdges(manifold, selection.nodeIndex);
  }, [manifold, selection]);
  
  // Count how many edges are "wrapped" (stubs)
  const wrappedEdgeCount = useMemo(() => {
    if (!selection) return 0;
    return selectedEdges.filter(e => isStubEdge(manifold, e, selection.nodeIndex)).length;
  }, [manifold, selectedEdges, selection]);
  
  // Get oriented edges from orbifold - only OUTGOING edges from the selected node
  // Each node has exactly 4 outgoing edges (N, S, E, W) in the orbifold
  // Note: The orbifold builder (buildP2Orbifold) adds edges in N, S, E, W order per node
  const orientedEdges = useMemo((): OrientedEdge[] => {
    if (!selection) return [];
    const nodeIndex = selection.nodeIndex;
    
    // Only show outgoing edges from this node
    // The orbifold encodes each direction as an outgoing edge
    const result: OrientedEdge[] = [];
    // Edge order matches buildP2Orbifold/buildP1Orbifold: N, S, E, W (or E, S for P1)
    const directions = orbifold.type === "P1" ? ["E", "S", "E", "S"] : ["N", "S", "E", "W"];
    let dirIndex = 0;
    
    for (const edge of orbifold.edges) {
      if (edge.from === nodeIndex) {
        // Edge goes FROM selected node - use voltage as-is
        result.push({
          targetNodeIndex: edge.to,
          voltage: edge.voltage,
          isReversed: false,
          originalEdge: edge,
          direction: directions[dirIndex % directions.length],
        });
        dirIndex++;
      }
    }
    return result;
  }, [orbifold, selection]);
  
  // Render the manifold view (single fundamental domain)
  const renderManifold = () => {
    const width = size * CELL_SIZE + PADDING * 2;
    const height = size * CELL_SIZE + PADDING * 2;
    
    // Draw grid lines
    const gridLines: ReactNode[] = [];
    for (let i = 0; i <= size; i++) {
      gridLines.push(
        <line
          key={`h-${i}`}
          x1={PADDING}
          y1={PADDING + i * CELL_SIZE}
          x2={PADDING + size * CELL_SIZE}
          y2={PADDING + i * CELL_SIZE}
          stroke="#ddd"
          strokeWidth={1}
        />
      );
      gridLines.push(
        <line
          key={`v-${i}`}
          x1={PADDING + i * CELL_SIZE}
          y1={PADDING}
          x2={PADDING + i * CELL_SIZE}
          y2={PADDING + size * CELL_SIZE}
          stroke="#ddd"
          strokeWidth={1}
        />
      );
    }
    
    // Draw spanning tree edges (if present)
    const treeEdgeElements: ReactNode[] = [];
    if (spanningTree) {
      for (const edgeIdx of spanningTree) {
        const edge = manifold.edges[edgeIdx];
        const fromNode = manifold.nodes[edge.from];
        const toNode = manifold.nodes[edge.to];
        
        // Skip wrapped edges visually (they would go across the whole grid)
        const rowDiff = Math.abs(fromNode.row - toNode.row);
        const colDiff = Math.abs(fromNode.col - toNode.col);
        if (rowDiff > 1 || colDiff > 1) continue;
        
        const x1 = PADDING + fromNode.col * CELL_SIZE + CELL_SIZE / 2;
        const y1 = PADDING + fromNode.row * CELL_SIZE + CELL_SIZE / 2;
        const x2 = PADDING + toNode.col * CELL_SIZE + CELL_SIZE / 2;
        const y2 = PADDING + toNode.row * CELL_SIZE + CELL_SIZE / 2;
        
        treeEdgeElements.push(
          <line
            key={`tree-${edgeIdx}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="#27ae60"
            strokeWidth={4}
            opacity={0.7}
          />
        );
      }
    }
    
    // Draw edges for selected node (only non-wrapped edges)
    const edgeElements: ReactNode[] = [];
    const isInFundamentalDomain = selection && matrixKey(selection.copyMatrix) === matrixKey(IDENTITY_3X3);
    if (selection && isInFundamentalDomain) {
      const thisNode = manifold.nodes[selection.nodeIndex];
      const cx = PADDING + thisNode.col * CELL_SIZE + CELL_SIZE / 2;
      const cy = PADDING + thisNode.row * CELL_SIZE + CELL_SIZE / 2;
      
      for (let i = 0; i < selectedEdges.length; i++) {
        const edge = selectedEdges[i];
        const otherIdx = getOtherNode(edge, selection.nodeIndex);
        const otherNode = manifold.nodes[otherIdx];
        
        // Skip stub edges (wrapped edges) - they're not shown visually
        if (isStubEdge(manifold, edge, selection.nodeIndex)) {
          continue;
        }
        
        const ox = PADDING + otherNode.col * CELL_SIZE + CELL_SIZE / 2;
        const oy = PADDING + otherNode.row * CELL_SIZE + CELL_SIZE / 2;
        
        // Draw as full line to neighbor
        edgeElements.push(
          <line
            key={`edge-${i}`}
            x1={cx}
            y1={cy}
            x2={ox}
            y2={oy}
            stroke="#4ecdc4"
            strokeWidth={3}
          />
        );
      }
    }
    
    // Draw nodes
    const nodeElements: ReactNode[] = [];
    for (const node of manifold.nodes) {
      const cx = PADDING + node.col * CELL_SIZE + CELL_SIZE / 2;
      const cy = PADDING + node.row * CELL_SIZE + CELL_SIZE / 2;
      const isSelected = selection && isInFundamentalDomain && node.index === selection.nodeIndex;
      
      nodeElements.push(
        <g key={`node-${node.index}`}>
          <circle
            cx={cx}
            cy={cy}
            r={NODE_RADIUS}
            fill={isSelected ? "#ffd93d" : "#6c5ce7"}
            stroke={isSelected ? "#e17055" : "#2d3436"}
            strokeWidth={isSelected ? 3 : 2}
            style={{ cursor: "pointer" }}
            onClick={() => handleNodeClick(node.index)}
          />
          <text
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={10}
            fill="#fff"
            style={{ pointerEvents: "none" }}
          >
            {node.row},{node.col}
          </text>
        </g>
      );
    }
    
    return (
      <svg width={width} height={height}>
        {gridLines}
        {treeEdgeElements}
        {edgeElements}
        {nodeElements}
      </svg>
    );
  };
  
  // Render the orbifold viewer (multiple copies)
  const renderOrbifoldViewer = () => {
    if (!showOrbifold || copies.length === 0) return null;
    
    // Find bounds
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    for (const copy of copies) {
      for (const node of orbifold.nodes) {
        const pos = applyMatrix3x3(copy.matrix, node.col + NODE_CENTER_OFFSET, node.row + NODE_CENTER_OFFSET);
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
        maxX = Math.max(maxX, pos.x);
        maxY = Math.max(maxY, pos.y);
      }
    }
    
    const scale = CELL_SIZE;
    const offsetX = -minX * scale + PADDING;
    const offsetY = -minY * scale + PADDING;
    const width = (maxX - minX) * scale + PADDING * 2;
    const height = (maxY - minY) * scale + PADDING * 2;
    
    // Create a map from copy key to index for coloring
    const copyIndexMap = new Map<string, number>();
    copies.forEach((copy, i) => copyIndexMap.set(copy.key, i));
    
    const elements: ReactNode[] = [];
    
    // Draw spanning tree edges in lifted graph (if present)
    if (spanningTree) {
      for (let copyIdx = 0; copyIdx < copies.length; copyIdx++) {
        const copy = copies[copyIdx];
        const copyKey = matrixKey(copy.matrix);
        
        // For each tree edge in the manifold, draw it in this copy
        for (const edgeIdx of spanningTree) {
          // Get the corresponding orbifold edge
          const orbEdge = orbifold.edges[edgeIdx];
          
          // Source position in this copy
          const fromNode = orbifold.nodes[orbEdge.from];
          const fromPos = applyMatrix3x3(copy.matrix, fromNode.col + NODE_CENTER_OFFSET, fromNode.row + NODE_CENTER_OFFSET);
          const fromX = fromPos.x * scale + offsetX;
          const fromY = fromPos.y * scale + offsetY;
          
          // Target position: use the voltage to determine the target copy
          const targetCopyMatrix = matmul3x3(copy.matrix, orbEdge.voltage);
          const toNode = orbifold.nodes[orbEdge.to];
          const toPos = applyMatrix3x3(targetCopyMatrix, toNode.col + NODE_CENTER_OFFSET, toNode.row + NODE_CENTER_OFFSET);
          const toX = toPos.x * scale + offsetX;
          const toY = toPos.y * scale + offsetY;
          
          elements.push(
            <line
              key={`tree-${copyKey}-${edgeIdx}`}
              x1={fromX}
              y1={fromY}
              x2={toX}
              y2={toY}
              stroke="#27ae60"
              strokeWidth={3}
              opacity={0.6}
            />
          );
        }
      }
    }
    
    // Draw copy outlines and nodes
    for (let copyIdx = 0; copyIdx < copies.length; copyIdx++) {
      const copy = copies[copyIdx];
      const color = getCopyColor(copyIdx);
      const copyKey = matrixKey(copy.matrix);
      const isIdentity = copyKey === matrixKey(IDENTITY_3X3);
      
      // Draw nodes in this copy
      for (const node of orbifold.nodes) {
        const pos = applyMatrix3x3(copy.matrix, node.col + NODE_CENTER_OFFSET, node.row + NODE_CENTER_OFFSET);
        const sx = pos.x * scale + offsetX;
        const sy = pos.y * scale + offsetY;
        
        // Check if this specific node in this specific copy is selected
        const isSelectedHere = selection && selection.nodeIndex === node.index && selection.copyKey === copyKey;
        
        elements.push(
          <circle
            key={`copy-${copyIdx}-node-${node.index}`}
            cx={sx}
            cy={sy}
            r={NODE_RADIUS * 0.8}
            fill={isSelectedHere ? "#ffd93d" : color}
            stroke={isSelectedHere ? "#e17055" : "#2d3436"}
            strokeWidth={isSelectedHere ? 3 : 1}
            opacity={isIdentity ? 1 : 0.7}
            style={{ cursor: "pointer" }}
            onClick={() => handleCopyNodeClick(node.index, copy.matrix)}
          />
        );
        
        // Label all copies with node coords
        elements.push(
          <text
            key={`copy-${copyIdx}-label-${node.index}`}
            x={sx}
            y={sy}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={8}
            fill="#fff"
            style={{ pointerEvents: "none" }}
          >
            {node.row},{node.col}
          </text>
        );
      }
    }
    
    // Draw edges for selected node with proper voltage handling
    if (selection) {
      const selectedNodeIndex = selection.nodeIndex;
      const selectedCopyMatrix = selection.copyMatrix;
      
      // For each oriented edge, draw a line from selected node to target
      for (let edgeIdx = 0; edgeIdx < orientedEdges.length; edgeIdx++) {
        const orientedEdge = orientedEdges[edgeIdx];
        
        // Source position: selected node in its copy
        const fromNode = orbifold.nodes[selectedNodeIndex];
        const fromPos = applyMatrix3x3(selectedCopyMatrix, fromNode.col + NODE_CENTER_OFFSET, fromNode.row + NODE_CENTER_OFFSET);
        const fromX = fromPos.x * scale + offsetX;
        const fromY = fromPos.y * scale + offsetY;
        
        // Target position: target node in target copy
        // The target copy = selectedCopyMatrix * voltage
        const targetCopyMatrix = matmul3x3(selectedCopyMatrix, orientedEdge.voltage);
        const toNode = orbifold.nodes[orientedEdge.targetNodeIndex];
        const toPos = applyMatrix3x3(targetCopyMatrix, toNode.col + NODE_CENTER_OFFSET, toNode.row + NODE_CENTER_OFFSET);
        const toX = toPos.x * scale + offsetX;
        const toY = toPos.y * scale + offsetY;
        
        elements.push(
          <line
            key={`voltage-edge-${edgeIdx}`}
            x1={fromX}
            y1={fromY}
            x2={toX}
            y2={toY}
            stroke={orientedEdge.isReversed ? "#ff9f43" : "#ff6b6b"}
            strokeWidth={2}
            strokeDasharray="4,2"
            markerEnd="url(#arrowhead-orbifold)"
          />
        );
      }
    }
    
    return (
      <svg width={Math.max(400, width)} height={Math.max(400, height)}>
        <defs>
          <marker
            id="arrowhead-orbifold"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#ff6b6b" />
          </marker>
        </defs>
        {elements}
      </svg>
    );
  };
  
  return (
    <div style={{ padding: "20px", fontFamily: "system-ui, sans-serif" }}>
      <h1>🧩 Manifold & Orbifold Explorer</h1>
      
      <div style={{ marginBottom: "20px" }}>
        <p style={{ color: "#666" }}>
          Explore manifolds (graphs with nodes and edges) and their corresponding orbifolds 
          (directed graphs with voltage labels from wallpaper groups).
        </p>
      </div>
      
      {/* Controls */}
      <div style={{ 
        display: "flex", 
        gap: "20px", 
        marginBottom: "20px",
        flexWrap: "wrap",
        alignItems: "flex-start"
      }}>
        {/* Manifold Type */}
        <div style={{ 
          padding: "15px", 
          backgroundColor: "#f8f9fa", 
          borderRadius: "8px",
          minWidth: "150px"
        }}>
          <label style={{ fontWeight: "bold", display: "block", marginBottom: "8px" }}>
            Manifold Type:
          </label>
          <select 
            value={manifoldType} 
            onChange={(e) => {
              setManifoldType(e.target.value as ManifoldType);
              setSelection(null);
            }}
            style={{ padding: "8px", fontSize: "14px", width: "100%" }}
          >
            <option value="P1">P1 (Torus)</option>
            <option value="P2">P2 (180° rotation)</option>
          </select>
        </div>
        
        {/* Size */}
        <div style={{ 
          padding: "15px", 
          backgroundColor: "#f8f9fa", 
          borderRadius: "8px",
          minWidth: "150px"
        }}>
          <label style={{ fontWeight: "bold", display: "block", marginBottom: "8px" }}>
            Size (n):
          </label>
          <input
            type="number"
            min={2}
            max={8}
            value={size}
            onChange={(e) => {
              setSize(Math.max(2, Math.min(8, parseInt(e.target.value) || 2)));
              setSelection(null);
            }}
            style={{ padding: "8px", fontSize: "14px", width: "100%" }}
          />
        </div>
        
        {/* Multiplier */}
        <div style={{ 
          padding: "15px", 
          backgroundColor: "#f8f9fa", 
          borderRadius: "8px",
          minWidth: "150px"
        }}>
          <label style={{ fontWeight: "bold", display: "block", marginBottom: "8px" }}>
            Multiplier:
          </label>
          <input
            type="number"
            min={1}
            max={5}
            value={multiplier}
            onChange={(e) => setMultiplier(Math.max(1, Math.min(5, parseInt(e.target.value) || 1)))}
            style={{ padding: "8px", fontSize: "14px", width: "100%" }}
          />
        </div>
        
        {/* Orbifold Toggle */}
        <div style={{ 
          padding: "15px", 
          backgroundColor: "#f8f9fa", 
          borderRadius: "8px",
          minWidth: "150px"
        }}>
          <label style={{ fontWeight: "bold", display: "block", marginBottom: "8px" }}>
            Show Orbifold:
          </label>
          <button
            onClick={() => setShowOrbifold(!showOrbifold)}
            style={{ 
              padding: "8px 16px", 
              fontSize: "14px",
              backgroundColor: showOrbifold ? "#4ecdc4" : "#ddd",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer"
            }}
          >
            {showOrbifold ? "Hide Copies" : "Show Copies"}
          </button>
        </div>
        
        {/* Spanning Tree Controls */}
        <div style={{ 
          padding: "15px", 
          backgroundColor: "#f8f9fa", 
          borderRadius: "8px",
          minWidth: "200px"
        }}>
          <label style={{ fontWeight: "bold", display: "block", marginBottom: "8px" }}>
            Spanning Tree:
          </label>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              onClick={handleGenerateSpanningTree}
              style={{ 
                padding: "8px 16px", 
                fontSize: "14px",
                backgroundColor: "#27ae60",
                color: "white",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer"
              }}
            >
              🌲 Generate
            </button>
            {spanningTree && (
              <button
                onClick={handleClearSpanningTree}
                style={{ 
                  padding: "8px 16px", 
                  fontSize: "14px",
                  backgroundColor: "#e74c3c",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer"
                }}
              >
                Clear
              </button>
            )}
          </div>
          {spanningTree && (
            <div style={{ marginTop: "8px", fontSize: "12px", color: "#555" }}>
              {spanningTree.size} edges in tree
            </div>
          )}
        </div>
      </div>
      <div style={{ 
        marginBottom: "20px", 
        padding: "15px", 
        backgroundColor: "#e8f4f8", 
        borderRadius: "8px",
        fontSize: "14px"
      }}>
        <strong>Manifold:</strong> {manifold.type} with {manifold.nodes.length} nodes and {manifold.edges.length} edges
        {selection && (
          <span style={{ marginLeft: "20px" }}>
            <strong>Selected node:</strong> ({manifold.nodes[selection.nodeIndex].row}, {manifold.nodes[selection.nodeIndex].col}) 
            with {selectedEdges.length} edges
            {wrappedEdgeCount > 0 && (
              <span style={{ color: "#888" }}> ({wrappedEdgeCount} wrapped, not shown in fundamental domain)</span>
            )}
          </span>
        )}
        {showOrbifold && (
          <span style={{ marginLeft: "20px" }}>
            <strong>Copies:</strong> {copies.length}
          </span>
        )}
      </div>
      
      {/* Visualization */}
      <div style={{ display: "flex", gap: "40px", flexWrap: "wrap" }}>
        {/* Manifold View */}
        <div>
          <h3 style={{ marginBottom: "10px" }}>Fundamental Domain</h3>
          <div style={{ 
            border: "1px solid #ddd", 
            borderRadius: "8px",
            backgroundColor: "#fff",
            display: "inline-block"
          }}>
            {renderManifold()}
          </div>
          <p style={{ fontSize: "12px", color: "#666", marginTop: "8px" }}>
            Click a node to see its edges.
          </p>
        </div>
        
        {/* Orbifold View */}
        {showOrbifold && (
          <div>
            <h3 style={{ marginBottom: "10px" }}>Orbifold Copies</h3>
            <div style={{ 
              border: "1px solid #ddd", 
              borderRadius: "8px",
              backgroundColor: "#fff",
              display: "inline-block"
            }}>
              {renderOrbifoldViewer()}
            </div>
            <p style={{ fontSize: "12px", color: "#666", marginTop: "8px" }}>
              Click any node in any copy to see edges. Dashed lines show voltage edges.
            </p>
          </div>
        )}
      </div>
      
      {/* Edge Details - Expandable */}
      {selection && (
        <div style={{ 
          marginTop: "20px", 
          padding: "15px", 
          backgroundColor: "#f8f9fa", 
          borderRadius: "8px" 
        }}>
          <div 
            style={{ 
              display: "flex", 
              alignItems: "center", 
              cursor: "pointer",
              userSelect: "none"
            }}
            onClick={() => setShowEdgeDetails(!showEdgeDetails)}
          >
            <span style={{ marginRight: "8px", fontSize: "12px" }}>
              {showEdgeDetails ? "▼" : "▶"}
            </span>
            <h4 style={{ margin: 0 }}>
              Edges from node ({manifold.nodes[selection.nodeIndex].row}, {manifold.nodes[selection.nodeIndex].col})
              {" "}— {orientedEdges.length} edges
            </h4>
          </div>
          
          {showEdgeDetails && (() => {
            const selectedNode = manifold.nodes[selection.nodeIndex];
            const liftedPos = applyMatrix3x3(selection.copyMatrix, selectedNode.col + NODE_CENTER_OFFSET, selectedNode.row + NODE_CENTER_OFFSET);
            const isNonIdentityCopy = matrixKey(selection.copyMatrix) !== matrixKey(IDENTITY_3X3);
            
            return (
              <div style={{ marginTop: "15px" }}>
                {/* Copy and position info */}
                <div style={{ 
                  marginBottom: "15px", 
                  padding: "10px", 
                  backgroundColor: "#e8f4f8",
                  borderRadius: "4px",
                  fontSize: "13px"
                }}>
                  <div style={{ marginBottom: "8px" }}>
                    <strong>Copy Matrix (Group Element):</strong>
                    <span style={{ fontFamily: "monospace", marginLeft: "10px" }}>
                      [{selection.copyMatrix.slice(0, 3).join(", ")}]
                      [{selection.copyMatrix.slice(3, 6).join(", ")}]
                      [{selection.copyMatrix.slice(6, 9).join(", ")}]
                    </span>
                    {!isNonIdentityCopy && <span style={{ color: "#666" }}> (identity)</span>}
                  </div>
                  <div>
                    <strong>Absolute Position (Lifted Graph):</strong>
                    <span style={{ fontFamily: "monospace", marginLeft: "10px" }}>
                      ({liftedPos.x.toFixed(2)}, {liftedPos.y.toFixed(2)})
                    </span>
                  </div>
                </div>
                
                {/* Edge table */}
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #ddd" }}>
                      <th style={{ textAlign: "left", padding: "8px" }}>Dir</th>
                      <th style={{ textAlign: "left", padding: "8px" }}>Target Node</th>
                      <th style={{ textAlign: "left", padding: "8px" }}>Abs. Target</th>
                      <th style={{ textAlign: "left", padding: "8px" }}>Voltage Matrix</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orientedEdges.map((orientedEdge, i) => {
                      const targetNode = orbifold.nodes[orientedEdge.targetNodeIndex];
                      // Compute absolute target position: 
                      // targetCopyMatrix = currentCopyMatrix * voltage
                      // then apply to target node
                      const targetCopyMatrix = matmul3x3(selection.copyMatrix, orientedEdge.voltage);
                      const absTargetPos = applyMatrix3x3(targetCopyMatrix, targetNode.col + NODE_CENTER_OFFSET, targetNode.row + NODE_CENTER_OFFSET);
                      
                      return (
                        <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                          <td style={{ padding: "8px", fontWeight: "bold" }}>
                            {orientedEdge.direction}
                          </td>
                          <td style={{ padding: "8px" }}>
                            ({targetNode.row}, {targetNode.col})
                          </td>
                          <td style={{ padding: "8px", fontFamily: "monospace" }}>
                            ({absTargetPos.x.toFixed(2)}, {absTargetPos.y.toFixed(2)})
                          </td>
                          <td style={{ padding: "8px", fontFamily: "monospace", fontSize: "11px" }}>
                            [{orientedEdge.voltage.slice(0, 3).join(", ")}]<br/>
                            [{orientedEdge.voltage.slice(3, 6).join(", ")}]<br/>
                            [{orientedEdge.voltage.slice(6, 9).join(", ")}]
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

export default ManifoldOrbifoldExplorer;
