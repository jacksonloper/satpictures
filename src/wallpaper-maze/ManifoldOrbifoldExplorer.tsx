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
  IDENTITY_3X3,
  type ManifoldType,
} from "./ManifoldOrbifold";

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

export function ManifoldOrbifoldExplorer() {
  // State
  const [manifoldType, setManifoldType] = useState<ManifoldType>("P1");
  const [size, setSize] = useState(3);
  const [selectedNode, setSelectedNode] = useState<number | null>(null);
  const [multiplier, setMultiplier] = useState(2);
  const [showOrbifold, setShowOrbifold] = useState(false);
  
  // Build manifold and orbifold
  const manifold = useMemo(() => buildManifold(manifoldType, size), [manifoldType, size]);
  const orbifold = useMemo(() => buildOrbifold(manifoldType, size), [manifoldType, size]);
  
  // Expand copies using BFS
  const copies = useMemo(() => {
    if (!showOrbifold) return [];
    return expandCopies(orbifold, multiplier);
  }, [orbifold, multiplier, showOrbifold]);
  
  // Handle node click
  const handleNodeClick = useCallback((nodeIndex: number) => {
    setSelectedNode(prev => prev === nodeIndex ? null : nodeIndex);
  }, []);
  
  // Get edges for selected node
  const selectedEdges = useMemo(() => {
    if (selectedNode === null) return [];
    return getNodeEdges(manifold, selectedNode);
  }, [manifold, selectedNode]);
  
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
    
    // Draw edges for selected node
    const edgeElements: ReactNode[] = [];
    if (selectedNode !== null) {
      const thisNode = manifold.nodes[selectedNode];
      const cx = PADDING + thisNode.col * CELL_SIZE + CELL_SIZE / 2;
      const cy = PADDING + thisNode.row * CELL_SIZE + CELL_SIZE / 2;
      
      for (let i = 0; i < selectedEdges.length; i++) {
        const edge = selectedEdges[i];
        const otherIdx = getOtherNode(edge, selectedNode);
        const otherNode = manifold.nodes[otherIdx];
        
        const ox = PADDING + otherNode.col * CELL_SIZE + CELL_SIZE / 2;
        const oy = PADDING + otherNode.row * CELL_SIZE + CELL_SIZE / 2;
        
        // Check if this is a "stub" edge (wrapped, goes far)
        const isStub = isStubEdge(manifold, edge, selectedNode);
        
        if (isStub) {
          // Draw as a stub (short line pointing in direction)
          const dx = otherNode.col - thisNode.col;
          const dy = otherNode.row - thisNode.row;
          const len = Math.sqrt(dx*dx + dy*dy);
          const normDx = dx / len;
          const normDy = dy / len;
          
          // Draw stub as dashed line
          edgeElements.push(
            <line
              key={`edge-${i}`}
              x1={cx}
              y1={cy}
              x2={cx + normDx * NODE_RADIUS * 2}
              y2={cy + normDy * NODE_RADIUS * 2}
              stroke="#ff6b6b"
              strokeWidth={3}
              strokeDasharray="5,3"
              markerEnd="url(#arrowhead)"
            />
          );
        } else {
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
    }
    
    // Draw nodes
    const nodeElements: ReactNode[] = [];
    for (const node of manifold.nodes) {
      const cx = PADDING + node.col * CELL_SIZE + CELL_SIZE / 2;
      const cy = PADDING + node.row * CELL_SIZE + CELL_SIZE / 2;
      const isSelected = node.index === selectedNode;
      
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
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#ff6b6b" />
          </marker>
        </defs>
        {gridLines}
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
        const pos = applyMatrix3x3(copy.matrix, node.col + 0.5, node.row + 0.5);
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
    
    // Draw copy outlines and nodes
    for (let copyIdx = 0; copyIdx < copies.length; copyIdx++) {
      const copy = copies[copyIdx];
      const color = getCopyColor(copyIdx);
      const isIdentity = matrixKey(copy.matrix) === matrixKey(IDENTITY_3X3);
      
      // Draw nodes in this copy
      for (const node of orbifold.nodes) {
        const pos = applyMatrix3x3(copy.matrix, node.col + 0.5, node.row + 0.5);
        const sx = pos.x * scale + offsetX;
        const sy = pos.y * scale + offsetY;
        
        const isSelectedInThisCopy = selectedNode === node.index && isIdentity;
        
        elements.push(
          <circle
            key={`copy-${copyIdx}-node-${node.index}`}
            cx={sx}
            cy={sy}
            r={NODE_RADIUS * 0.8}
            fill={color}
            stroke={isSelectedInThisCopy ? "#e17055" : "#2d3436"}
            strokeWidth={isSelectedInThisCopy ? 3 : 1}
            opacity={isIdentity ? 1 : 0.7}
          />
        );
        
        // Label only identity copy
        if (isIdentity) {
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
    }
    
    // Draw edges between copies (voltage edges)
    if (selectedNode !== null) {
      const identityCopy = copies.find(c => matrixKey(c.matrix) === matrixKey(IDENTITY_3X3));
      if (identityCopy) {
        // Find orbifold edges from the selected node
        const orbifoldEdges = orbifold.edges.filter(e => e.from === selectedNode || e.to === selectedNode);
        
        for (let edgeIdx = 0; edgeIdx < orbifoldEdges.length; edgeIdx++) {
          const edge = orbifoldEdges[edgeIdx];
          const otherNode = edge.from === selectedNode ? edge.to : edge.from;
          
          // Source position (in identity copy)
          const fromNode = orbifold.nodes[selectedNode];
          const fromPos = applyMatrix3x3(IDENTITY_3X3, fromNode.col + 0.5, fromNode.row + 0.5);
          const fromX = fromPos.x * scale + offsetX;
          const fromY = fromPos.y * scale + offsetY;
          
          // Target position (in target copy determined by voltage)
          const toNode = orbifold.nodes[otherNode];
          const toMatrix = edge.voltage;
          const toPos = applyMatrix3x3(toMatrix, toNode.col + 0.5, toNode.row + 0.5);
          const toX = toPos.x * scale + offsetX;
          const toY = toPos.y * scale + offsetY;
          
          elements.push(
            <line
              key={`voltage-edge-${edgeIdx}`}
              x1={fromX}
              y1={fromY}
              x2={toX}
              y2={toY}
              stroke="#ff6b6b"
              strokeWidth={2}
              strokeDasharray="4,2"
              markerEnd="url(#arrowhead-orbifold)"
            />
          );
        }
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
              setSelectedNode(null);
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
              setSelectedNode(null);
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
      </div>
      
      {/* Info Panel */}
      <div style={{ 
        marginBottom: "20px", 
        padding: "15px", 
        backgroundColor: "#e8f4f8", 
        borderRadius: "8px",
        fontSize: "14px"
      }}>
        <strong>Manifold:</strong> {manifold.type} with {manifold.nodes.length} nodes and {manifold.edges.length} edges
        {selectedNode !== null && (
          <span style={{ marginLeft: "20px" }}>
            <strong>Selected node:</strong> ({manifold.nodes[selectedNode].row}, {manifold.nodes[selectedNode].col}) 
            with {selectedEdges.length} edges
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
            Click a node to see its edges. Dashed lines are "stubs" (wrapped edges).
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
              Each color is a different copy. Dashed lines show voltage edges.
            </p>
          </div>
        )}
      </div>
      
      {/* Edge List */}
      {selectedNode !== null && (
        <div style={{ 
          marginTop: "20px", 
          padding: "15px", 
          backgroundColor: "#f8f9fa", 
          borderRadius: "8px" 
        }}>
          <h4 style={{ marginTop: 0 }}>Edges from node ({manifold.nodes[selectedNode].row}, {manifold.nodes[selectedNode].col}):</h4>
          <ul style={{ margin: 0, paddingLeft: "20px" }}>
            {selectedEdges.map((edge, i) => {
              const otherIdx = getOtherNode(edge, selectedNode);
              const otherNode = manifold.nodes[otherIdx];
              const isStub = isStubEdge(manifold, edge, selectedNode);
              return (
                <li key={i}>
                  → ({otherNode.row}, {otherNode.col})
                  {isStub && <span style={{ color: "#ff6b6b", marginLeft: "8px" }}>(wrapped/stub)</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

export default ManifoldOrbifoldExplorer;
