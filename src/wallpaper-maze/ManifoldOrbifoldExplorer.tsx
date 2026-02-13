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

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
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
  inverse3x3,
  IDENTITY_3X3,
  generateRandomSpanningTree,
  findOrbifoldEdge,
  type ManifoldType,
  type Manifold,
  type Orbifold,
  type Matrix3x3,
} from "./ManifoldOrbifold";

/** Selection state: a node in a specific copy */
interface NodeSelection {
  nodeIndex: number;
  copyMatrix: Matrix3x3;  // The copy's transform matrix
  copyKey: string;        // For comparison
}

/** An edge from the perspective of a selected node, with properly oriented voltage */
interface OrientedEdge {
  manifoldEdgeIndex: number;  // Index in manifold.edges (for spanning tree lookup)
  targetNodeIndex: number;
  voltage: Matrix3x3;     // Voltage going FROM selected node TO target
  isReversed: boolean;    // Was the edge direction reversed to make it outgoing from selected node?
}

// Constants
const CELL_SIZE = 50;
const NODE_RADIUS = 15;
const PADDING = 40;

// Golden ratio for spreading colors
const GOLDEN_RATIO = 0.618033988749895;

function getCopyColor(index: number): string {
  const hue = ((index * GOLDEN_RATIO) % 1) * 360;
  return `hsl(${hue}, 70%, 60%)`;
}

/**
 * Get oriented edges from a node's perspective using manifold edges and orbifold voltages.
 * Each manifold edge has one corresponding orbifold edge (with a voltage).
 * We orient the edge to go FROM the selected node, inverting the voltage if needed.
 */
function getOrientedEdgesForNode(
  manifold: Manifold,
  orbifold: Orbifold,
  nodeIndex: number,
): OrientedEdge[] {
  const result: OrientedEdge[] = [];
  const nodeEdges = getNodeEdges(manifold, nodeIndex);
  
  for (let edgeIndex = 0; edgeIndex < nodeEdges.length; edgeIndex++) {
    const manifoldEdge = nodeEdges[edgeIndex];
    const manifoldEdgeIndex = manifold.edges.indexOf(manifoldEdge);
    const targetNodeIndex = getOtherNode(manifoldEdge, nodeIndex);
    
    // The manifold edge is undirected. The orbifold has the same edges but directed.
    // Find the corresponding orbifold edge (try both directions)
    let voltage: Matrix3x3;
    let isReversed: boolean;
    
    // Try from -> to direction first (where from = nodeIndex)
    const forwardEdge = findOrbifoldEdge(orbifold, manifoldEdge.from, manifoldEdge.to);
    if (forwardEdge) {
      // If nodeIndex is the "from" of the manifold edge, use voltage as-is
      // If nodeIndex is the "to" of the manifold edge, use inverse voltage
      if (nodeIndex === manifoldEdge.from) {
        voltage = forwardEdge.voltage;
        isReversed = false;
      } else {
        voltage = inverse3x3(forwardEdge.voltage);
        isReversed = true;
      }
    } else {
      // Try reverse direction
      const reverseEdge = findOrbifoldEdge(orbifold, manifoldEdge.to, manifoldEdge.from);
      if (reverseEdge) {
        if (nodeIndex === manifoldEdge.to) {
          voltage = reverseEdge.voltage;
          isReversed = false;
        } else {
          voltage = inverse3x3(reverseEdge.voltage);
          isReversed = true;
        }
      } else {
        // No matching orbifold edge found - this shouldn't happen
        console.warn(`No orbifold edge found for manifold edge ${manifoldEdgeIndex}`);
        voltage = IDENTITY_3X3;
        isReversed = false;
      }
    }
    
    result.push({
      manifoldEdgeIndex,
      targetNodeIndex,
      voltage,
      isReversed,
    });
  }
  
  return result;
}

/** Custom hook for validated numeric input */
function useValidatedInput(initialValue: number, min: number, max: number, onChange: (v: number) => void) {
  const [inputValue, setInputValue] = useState(String(initialValue));
  const [isValid, setIsValid] = useState(true);
  const lastValidValue = useRef(initialValue);
  
  // Sync with external value changes
  useEffect(() => {
    setInputValue(String(initialValue));
    lastValidValue.current = initialValue;
    setIsValid(true);
  }, [initialValue]);
  
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    
    // Check validity
    const parsed = parseInt(newValue, 10);
    const valid = !isNaN(parsed) && parsed >= min && parsed <= max;
    setIsValid(valid);
    
    if (valid) {
      lastValidValue.current = parsed;
      onChange(parsed);
    }
  };
  
  const handleBlur = () => {
    if (!isValid) {
      // Reset to last valid value
      setInputValue(String(lastValidValue.current));
      setIsValid(true);
    }
  };
  
  return { inputValue, isValid, handleChange, handleBlur };
}

export function ManifoldOrbifoldExplorer() {
  // State
  const [manifoldType, setManifoldType] = useState<ManifoldType>("P1");
  const [size, setSize] = useState(3);
  const [selection, setSelection] = useState<NodeSelection | null>(null);
  const [multiplier, setMultiplier] = useState(2);
  const [showEdgeDetails, setShowEdgeDetails] = useState(false);
  const [spanningTree, setSpanningTree] = useState<Set<number> | null>(null);
  
  // Validated inputs
  const sizeInput = useValidatedInput(size, 2, 8, setSize);
  const multiplierInput = useValidatedInput(multiplier, 1, 5, setMultiplier);
  
  // Build manifold and orbifold
  const manifold = useMemo(() => buildManifold(manifoldType, size), [manifoldType, size]);
  const orbifold = useMemo(() => buildOrbifold(manifoldType, size), [manifoldType, size]);
  
  // Clear spanning tree and selection when manifold changes
  useEffect(() => {
    setSpanningTree(null);
    setSelection(null);
  }, [manifoldType, size]);
  
  // Always expand copies (no toggle)
  const copies = useMemo(() => {
    return expandCopies(orbifold, multiplier);
  }, [orbifold, multiplier]);
  
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
  
  // Get oriented edges using the new helper function
  const orientedEdges = useMemo((): OrientedEdge[] => {
    if (!selection) return [];
    return getOrientedEdgesForNode(manifold, orbifold, selection.nodeIndex);
  }, [manifold, orbifold, selection]);
  
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
    
    const isInFundamentalDomain = selection && matrixKey(selection.copyMatrix) === matrixKey(IDENTITY_3X3);
    // Also highlight if selected in a copy
    const highlightNodeInFundamental = selection ? selection.nodeIndex : null;
    
    // Draw edges for selected node (only non-wrapped edges, as dotted lines on top)
    const edgeElements: ReactNode[] = [];
    if (selection) {
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
        
        // Draw as dotted line (on top of tree edges)
        edgeElements.push(
          <line
            key={`edge-${i}`}
            x1={cx}
            y1={cy}
            x2={ox}
            y2={oy}
            stroke="#666"
            strokeWidth={2}
            strokeDasharray="4,3"
          />
        );
      }
    }
    
    // Draw nodes
    const nodeElements: ReactNode[] = [];
    for (const node of manifold.nodes) {
      const cx = PADDING + node.col * CELL_SIZE + CELL_SIZE / 2;
      const cy = PADDING + node.row * CELL_SIZE + CELL_SIZE / 2;
      const isSelected = isInFundamentalDomain && node.index === selection?.nodeIndex;
      const isHighlighted = highlightNodeInFundamental === node.index;
      
      // Yellow highlight circle for selected node (including when selected from a copy)
      if (isHighlighted) {
        nodeElements.push(
          <circle
            key={`highlight-${node.index}`}
            cx={cx}
            cy={cy}
            r={NODE_RADIUS + 4}
            fill="none"
            stroke="#ffd93d"
            strokeWidth={3}
          />
        );
      }
      
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
    if (copies.length === 0) return null;
    
    // Find bounds - use integer coordinates (no offset)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    for (const copy of copies) {
      for (const node of orbifold.nodes) {
        const pos = applyMatrix3x3(copy.matrix, node.col, node.row);
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
        maxX = Math.max(maxX, pos.x);
        maxY = Math.max(maxY, pos.y);
      }
    }
    
    const scale = CELL_SIZE;
    const offsetX = -minX * scale + PADDING + CELL_SIZE / 2;
    const offsetY = -minY * scale + PADDING + CELL_SIZE / 2;
    const width = (maxX - minX) * scale + PADDING * 2 + CELL_SIZE;
    const height = (maxY - minY) * scale + PADDING * 2 + CELL_SIZE;
    
    const elements: ReactNode[] = [];
    
    // Draw spanning tree edges in lifted graph (if present)
    if (spanningTree) {
      for (let copyIdx = 0; copyIdx < copies.length; copyIdx++) {
        const copy = copies[copyIdx];
        const copyKey = matrixKey(copy.matrix);
        
        // For each tree edge in the manifold, draw it in this copy
        for (const manifoldEdgeIdx of spanningTree) {
          const manifoldEdge = manifold.edges[manifoldEdgeIdx];
          
          // Find the orbifold edge to get the voltage
          const orbEdge = findOrbifoldEdge(orbifold, manifoldEdge.from, manifoldEdge.to);
          let voltage: Matrix3x3;
          let fromNodeIdx: number;
          let toNodeIdx: number;
          
          if (orbEdge) {
            voltage = orbEdge.voltage;
            fromNodeIdx = manifoldEdge.from;
            toNodeIdx = manifoldEdge.to;
          } else {
            const reverseOrbEdge = findOrbifoldEdge(orbifold, manifoldEdge.to, manifoldEdge.from);
            if (reverseOrbEdge) {
              voltage = inverse3x3(reverseOrbEdge.voltage);
              fromNodeIdx = manifoldEdge.from;
              toNodeIdx = manifoldEdge.to;
            } else {
              continue;
            }
          }
          
          // Source position in this copy
          const fromNode = orbifold.nodes[fromNodeIdx];
          const fromPos = applyMatrix3x3(copy.matrix, fromNode.col, fromNode.row);
          const fromX = fromPos.x * scale + offsetX;
          const fromY = fromPos.y * scale + offsetY;
          
          // Target position: use the voltage to determine the target copy
          const targetCopyMatrix = matmul3x3(copy.matrix, voltage);
          const toNode = orbifold.nodes[toNodeIdx];
          const toPos = applyMatrix3x3(targetCopyMatrix, toNode.col, toNode.row);
          const toX = toPos.x * scale + offsetX;
          const toY = toPos.y * scale + offsetY;
          
          elements.push(
            <line
              key={`tree-${copyKey}-${manifoldEdgeIdx}`}
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
        const pos = applyMatrix3x3(copy.matrix, node.col, node.row);
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
        
        // Label with original manifold node coordinates (row, col)
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
        const fromPos = applyMatrix3x3(selectedCopyMatrix, fromNode.col, fromNode.row);
        const fromX = fromPos.x * scale + offsetX;
        const fromY = fromPos.y * scale + offsetY;
        
        // Target position: target node in target copy
        // The target copy = selectedCopyMatrix * voltage
        const targetCopyMatrix = matmul3x3(selectedCopyMatrix, orientedEdge.voltage);
        const toNode = orbifold.nodes[orientedEdge.targetNodeIndex];
        const toPos = applyMatrix3x3(targetCopyMatrix, toNode.col, toNode.row);
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
            Size (n): <span style={{ fontSize: "11px", color: "#888" }}>(2-8)</span>
          </label>
          <input
            type="text"
            value={sizeInput.inputValue}
            onChange={sizeInput.handleChange}
            onBlur={sizeInput.handleBlur}
            style={{ 
              padding: "8px", 
              fontSize: "14px", 
              width: "100%",
              borderColor: sizeInput.isValid ? "#ccc" : "#e74c3c",
              borderWidth: "2px",
              borderStyle: "solid",
              borderRadius: "4px",
              outline: "none"
            }}
          />
          {!sizeInput.isValid && (
            <div style={{ color: "#e74c3c", fontSize: "11px", marginTop: "4px" }}>
              Enter 2-8
            </div>
          )}
        </div>
        
        {/* Multiplier */}
        <div style={{ 
          padding: "15px", 
          backgroundColor: "#f8f9fa", 
          borderRadius: "8px",
          minWidth: "150px"
        }}>
          <label style={{ fontWeight: "bold", display: "block", marginBottom: "8px" }}>
            Multiplier: <span style={{ fontSize: "11px", color: "#888" }}>(1-5)</span>
          </label>
          <input
            type="text"
            value={multiplierInput.inputValue}
            onChange={multiplierInput.handleChange}
            onBlur={multiplierInput.handleBlur}
            style={{ 
              padding: "8px", 
              fontSize: "14px", 
              width: "100%",
              borderColor: multiplierInput.isValid ? "#ccc" : "#e74c3c",
              borderWidth: "2px",
              borderStyle: "solid",
              borderRadius: "4px",
              outline: "none"
            }}
          />
          {!multiplierInput.isValid && (
            <div style={{ color: "#e74c3c", fontSize: "11px", marginTop: "4px" }}>
              Enter 1-5
            </div>
          )}
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
        <span style={{ marginLeft: "20px" }}>
          <strong>Copies:</strong> {copies.length}
        </span>
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
        
        {/* Orbifold View - always shown */}
        <div>
          <h3 style={{ marginBottom: "10px" }}>Lifted Graph (Orbifold Copies)</h3>
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
            // Use integer coordinates (no offset)
            const liftedPos = applyMatrix3x3(selection.copyMatrix, selectedNode.col, selectedNode.row);
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
                    <strong>Node in Manifold:</strong>
                    <span style={{ fontFamily: "monospace", marginLeft: "10px" }}>
                      ({selectedNode.row}, {selectedNode.col})
                    </span>
                  </div>
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
                      ({Math.round(liftedPos.x)}, {Math.round(liftedPos.y)})
                    </span>
                  </div>
                </div>
                
                {/* Edge table */}
                <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #ddd" }}>
                      <th style={{ textAlign: "left", padding: "8px" }}>#</th>
                      <th style={{ textAlign: "left", padding: "8px" }}>In Tree</th>
                      <th style={{ textAlign: "left", padding: "8px" }}>Target Node</th>
                      <th style={{ textAlign: "left", padding: "8px" }}>Abs. Target</th>
                      <th style={{ textAlign: "left", padding: "8px" }}>Voltage Matrix</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orientedEdges.map((orientedEdge, i) => {
                      // Note: orbifold.nodes and manifold.nodes have the same structure
                      // The targetNodeIndex from the oriented edge maps to the same node in both
                      const targetManifoldNode = orbifold.nodes[orientedEdge.targetNodeIndex];
                      // Compute absolute target position: 
                      // targetCopyMatrix = currentCopyMatrix * voltage
                      // then apply to target node (integer coordinates)
                      const targetCopyMatrix = matmul3x3(selection.copyMatrix, orientedEdge.voltage);
                      const absTargetPos = applyMatrix3x3(targetCopyMatrix, targetManifoldNode.col, targetManifoldNode.row);
                      
                      // Check if this edge is in the spanning tree (use manifold edge index)
                      const isInTree = spanningTree?.has(orientedEdge.manifoldEdgeIndex) ?? false;
                      
                      return (
                        <tr key={i} style={{ 
                          borderBottom: "1px solid #eee",
                          backgroundColor: isInTree ? "rgba(40, 167, 69, 0.1)" : "transparent"
                        }}>
                          <td style={{ padding: "8px", color: "#999" }} title={`Manifold edge index: ${orientedEdge.manifoldEdgeIndex}`}>
                            {i + 1}
                          </td>
                          <td style={{ padding: "8px", fontWeight: "bold", color: isInTree ? "#28a745" : "#999" }}>
                            {isInTree ? "✓ Yes" : "No"}
                          </td>
                          <td style={{ padding: "8px" }}>
                            ({targetManifoldNode.row}, {targetManifoldNode.col})
                          </td>
                          <td style={{ padding: "8px", fontFamily: "monospace" }}>
                            ({Math.round(absTargetPos.x)}, {Math.round(absTargetPos.y)})
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
