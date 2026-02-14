/**
 * Orbifolds Explorer Page
 * 
 * Allows a user to:
 * - Select a wallpaper group (P1, P2, P3, P4, P4g, or pgg)
 * - Set a size n (creating an n×n coloring grid)
 * - Set an expansion count m (how many times to expand the lifted graph)
 * - Color in the grid cells (black/white) using "color" tool
 * - Inspect nodes to see coordinates, edges, and voltages using "inspect" tool
 * - See the generated lifted graph with highlighting for inspected nodes
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  createOrbifoldGrid,
  setNodeColor,
  getNodeColor,
  type WallpaperGroupType,
  type ColorData,
  type EdgeStyleData,
  type EdgeLinestyle,
} from "./createOrbifolds";
import {
  constructLiftedGraphFromOrbifold,
  processAllNonInteriorOnce,
  buildAdjacency,
  formatVoltageRows,
  type OrbifoldGrid,
  type OrbifoldEdgeId,
  type LiftedNodeId,
} from "./orbifoldbasics";
import { applyRandomSpanningTreeToWhiteNodes } from "./spanningTree";
import {
  ErrorBoundary,
  ValidatedInput,
  LiftedGraphRenderer,
  OrbifoldGridTools,
  type ToolType,
  type InspectionInfo,
} from "./components";
import GraphLiftWorker from "./graph-lift.worker?worker";
import type { GraphLiftRequest, GraphLiftResponse } from "./graph-lift.worker";
import "../App.css";

// Constants
const DEFAULT_SIZE = 3;
const DEFAULT_EXPANSION = 2;

/** Result from the graph lift SAT solver */
interface GraphLiftResult {
  orbifoldParentEdge: Map<string, string>;
  liftedParent: Map<LiftedNodeId, LiftedNodeId | null>;
  liftedDepth: Map<LiftedNodeId, number>;
}

/**
 * Main Orbifolds Explorer component.
 */
export function OrbifoldsExplorer() {
  const [wallpaperGroup, setWallpaperGroup] = useState<WallpaperGroupType>("P1");
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [expansion, setExpansion] = useState(DEFAULT_EXPANSION);
  const [tool, setTool] = useState<ToolType>("color");
  const [inspectionInfo, setInspectionInfo] = useState<InspectionInfo | null>(null);
  const [useAxialTransform, setUseAxialTransform] = useState(false);
  const [selectedVoltageKey, setSelectedVoltageKey] = useState<string | null>(null);
  const [showDomains, setShowDomains] = useState(true);
  const [showDashedLines, setShowDashedLines] = useState(true);
  const [showNodes, setShowNodes] = useState(false); // Nodes hidden by default
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const minSize = wallpaperGroup === "P4g" ? 4 : 2;
  
  // Ref for SVG export
  const liftedGraphSvgRef = useRef<SVGSVGElement>(null);

  // ── Graph Lift SAT solver state ──
  const [graphLiftRoot, setGraphLiftRoot] = useState<LiftedNodeId | null>(null);
  const [graphLiftTarget, setGraphLiftTarget] = useState<LiftedNodeId | null>(null);
  const [graphLiftDist, setGraphLiftDist] = useState(3);
  const [graphLiftSolving, setGraphLiftSolving] = useState(false);
  const [graphLiftStats, setGraphLiftStats] = useState<{ numVars: number; numClauses: number } | null>(null);
  const [graphLiftError, setGraphLiftError] = useState<string | null>(null);
  const [graphLiftResult, setGraphLiftResult] = useState<GraphLiftResult | null>(null);
  const graphLiftWorkerRef = useRef<Worker | null>(null);
  
  // Initialize orbifold grid with adjacency built
  const [orbifoldGrid, setOrbifoldGrid] = useState<OrbifoldGrid<ColorData, EdgeStyleData>>(() => {
    const grid = createOrbifoldGrid(wallpaperGroup, size);
    buildAdjacency(grid);
    return grid;
  });

  const handleWallpaperGroupChange = (nextGroup: WallpaperGroupType) => {
    if (nextGroup === "P4g" && size < 4) {
      setSize(4);
    }
    setWallpaperGroup(nextGroup);
  };

  // Recreate grid when wallpaper group or size changes
  useEffect(() => {
    const grid = createOrbifoldGrid(wallpaperGroup, size);
    buildAdjacency(grid);
    setOrbifoldGrid(grid);
    setInspectionInfo(null); // Clear inspection when grid changes
    setSelectedVoltageKey(null); // Clear voltage selection when grid changes
  }, [wallpaperGroup, size]);

  // Handle cell color toggle
  const handleColorToggle = useCallback((row: number, col: number) => {
    setOrbifoldGrid((prev) => {
      // Create a shallow copy of the grid
      const newGrid: OrbifoldGrid<ColorData, EdgeStyleData> = {
        nodes: new Map(prev.nodes),
        edges: prev.edges,
        adjacency: prev.adjacency,
      };
      
      // Toggle the color
      const currentColor = getNodeColor(prev, row, col);
      const newColor = currentColor === "black" ? "white" : "black";
      setNodeColor(newGrid, row, col, newColor);
      
      return newGrid;
    });
  }, []);

  // Handle edge linestyle toggle
  // Helper function to toggle linestyle
  const toggleLinestyle = (current: EdgeLinestyle): EdgeLinestyle => 
    current === "solid" ? "dashed" : "solid";

  const handleEdgeLinestyleToggle = useCallback((edgeId: OrbifoldEdgeId) => {
    setOrbifoldGrid((prev) => {
      // Create a shallow copy of the grid with edges also copied
      const newEdges = new Map(prev.edges);
      const edge = newEdges.get(edgeId);
      if (edge) {
        const currentLinestyle = edge.data?.linestyle ?? "solid";
        const newLinestyle = toggleLinestyle(currentLinestyle);
        newEdges.set(edgeId, { ...edge, data: { linestyle: newLinestyle } });
      }
      
      const newGrid: OrbifoldGrid<ColorData, EdgeStyleData> = {
        nodes: prev.nodes,
        edges: newEdges,
        adjacency: prev.adjacency,
      };
      
      return newGrid;
    });
    
    // Also update the inspection info to reflect the new linestyle
    setInspectionInfo((prevInfo) => {
      if (!prevInfo) return null;
      return {
        ...prevInfo,
        edges: prevInfo.edges.map((e) => {
          if (e.edgeId === edgeId) {
            return {
              ...e,
              linestyle: toggleLinestyle(e.linestyle),
            };
          }
          return e;
        }),
      };
    });
  }, []);

  // Handle inspection
  const handleInspect = useCallback((info: InspectionInfo | null) => {
    setInspectionInfo(info);
  }, []);

  // Handle random spanning tree button click
  const handleRandomSpanningTree = useCallback(() => {
    try {
      setErrorMessage(null); // Clear any previous error
      setOrbifoldGrid((prev) => {
        const newGrid = applyRandomSpanningTreeToWhiteNodes(prev);
        return newGrid;
      });
      // Clear inspection info since edge linestyles have changed
      setInspectionInfo(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An unexpected error occurred";
      setErrorMessage(`Random tree generation failed: ${message}`);
      console.error("Random spanning tree error:", error);
    }
  }, []);

  // Handle SVG export
  const handleExportSvg = useCallback(() => {
    const svgElement = liftedGraphSvgRef.current;
    if (!svgElement) return;
    
    // Clone the SVG to avoid modifying the original
    const svgClone = svgElement.cloneNode(true) as SVGSVGElement;
    
    // Add xmlns attribute for standalone SVG file
    svgClone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    
    // Serialize to string
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgClone);
    
    // Create blob and download
    const blob = new Blob([svgString], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.href = url;
    // Sanitize filename components (wallpaperGroup is already constrained to P1/P2/P3/P4/pgg)
    const safeGroup = wallpaperGroup.toLowerCase();
    link.download = `lifted-graph-${safeGroup}-${size}x${size}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [wallpaperGroup, size]);

  // Handle lifted node click (for domain highlighting)
  // Note: liftedNodeId is available for future extension (e.g., showing node details)
  const handleLiftedNodeClick = useCallback((_liftedNodeId: string, voltageKey: string) => {
    // Toggle selection: if same voltage is clicked again, deselect
    setSelectedVoltageKey(prev => prev === voltageKey ? null : voltageKey);
  }, []);

  // Build the lifted graph
  const liftedGraph = useMemo(() => {
    const lifted = constructLiftedGraphFromOrbifold<ColorData, EdgeStyleData>(orbifoldGrid);
    
    // Expand the graph m times
    for (let i = 0; i < expansion; i++) {
      processAllNonInteriorOnce(lifted);
    }
    
    return lifted;
  }, [orbifoldGrid, expansion]);

  // Cleanup graph lift worker on unmount
  useEffect(() => {
    return () => {
      if (graphLiftWorkerRef.current) {
        graphLiftWorkerRef.current.terminate();
      }
    };
  }, []);

  // Build sorted list of interior lifted node IDs for the dropdowns
  const liftedNodeIds = useMemo(() => {
    const ids: LiftedNodeId[] = [];
    for (const [id, node] of liftedGraph.nodes) {
      if (node.interior) ids.push(id);
    }
    ids.sort();
    return ids;
  }, [liftedGraph]);

  // Handle graph lift solve
  const handleGraphLiftSolve = useCallback(() => {
    if (!graphLiftRoot || !graphLiftTarget) return;
    if (graphLiftWorkerRef.current) {
      graphLiftWorkerRef.current.terminate();
    }

    setGraphLiftSolving(true);
    setGraphLiftError(null);
    setGraphLiftStats(null);

    // Build request from current orbifold + lifted graph
    const orbifoldNodeIds = Array.from(orbifoldGrid.nodes.keys());
    const orbifoldEdges = Array.from(orbifoldGrid.edges.values()).map(e => ({
      edgeId: e.id,
      halfEdges: Array.from(e.halfEdges.entries()).map(([from, he]) => ({ from, to: he.to })),
    }));
    const orbifoldAdjacency = Array.from(orbifoldGrid.adjacency ?? new Map()).map(
      ([nid, eids]) => [nid, eids] as [string, string[]]
    );
    const liftedNodes = Array.from(liftedGraph.nodes.values())
      .filter(n => n.interior)
      .map(n => ({ id: n.id, orbifoldNode: n.orbifoldNode }));
    const interiorIds = new Set(liftedNodes.map(n => n.id));
    const liftedEdges = Array.from(liftedGraph.edges.values())
      .filter(e => interiorIds.has(e.a) && interiorIds.has(e.b) && e.orbifoldEdgeId !== undefined)
      .map(e => ({ a: e.a, b: e.b, orbifoldEdgeId: e.orbifoldEdgeId! }));

    const request: GraphLiftRequest = {
      orbifoldNodeIds,
      orbifoldEdges,
      orbifoldAdjacency,
      liftedNodes,
      liftedEdges,
      rootLiftedNodeId: graphLiftRoot,
      targetLiftedNodeId: graphLiftTarget,
      minDepth: graphLiftDist,
    };

    const worker = new GraphLiftWorker();
    graphLiftWorkerRef.current = worker;

    worker.onmessage = (event: MessageEvent<GraphLiftResponse>) => {
      const resp = event.data;
      if (resp.messageType === "progress") {
        if (resp.stats) setGraphLiftStats(resp.stats);
        return;
      }
      if (resp.success && resp.result) {
        setGraphLiftResult({
          orbifoldParentEdge: new Map(resp.result.orbifoldParentEdge),
          liftedParent: new Map(resp.result.liftedParent),
          liftedDepth: new Map(resp.result.liftedDepth),
        });
        setGraphLiftError(null);
      } else {
        setGraphLiftError(resp.error || "Solve failed");
      }
      setGraphLiftSolving(false);
      graphLiftWorkerRef.current = null;
    };

    worker.onerror = (err) => {
      setGraphLiftError(`Worker error: ${err.message}`);
      setGraphLiftSolving(false);
      graphLiftWorkerRef.current = null;
    };

    worker.postMessage(request);
  }, [graphLiftRoot, graphLiftTarget, graphLiftDist, orbifoldGrid, liftedGraph]);

  // Handle graph lift cancel
  const handleGraphLiftCancel = useCallback(() => {
    if (graphLiftWorkerRef.current) {
      graphLiftWorkerRef.current.terminate();
      graphLiftWorkerRef.current = null;
      setGraphLiftSolving(false);
      setGraphLiftError("Cancelled");
    }
  }, []);

  return (
    <div className="orbifolds-explorer" style={{ padding: "20px" }}>
      <h1 style={{ marginBottom: "20px" }}>🔮 Orbifolds Explorer</h1>
      
      {/* Controls */}
      <div style={{ 
        display: "flex", 
        flexWrap: "wrap",
        gap: "20px", 
        marginBottom: "20px",
        padding: "16px",
        backgroundColor: "#f8f9fa",
        borderRadius: "8px",
      }}>
        {/* Wallpaper Group Selector */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <label>Wallpaper Group:</label>
          <select
            value={wallpaperGroup}
            onChange={(e) => handleWallpaperGroupChange(e.target.value as WallpaperGroupType)}
            style={{
              padding: "4px 8px",
              borderRadius: "4px",
              border: "1px solid #ccc",
            }}
          >
            <option value="P1">P1 (Torus)</option>
            <option value="P2">P2 (180° rotation)</option>
            <option value="pgg">pgg (glide reflections)</option>
            <option value="P3">P3 (120° rotation - axial)</option>
            <option value="P4">P4 (90° rotation)</option>
            <option value="P4g">P4g (90° rotation + diagonal flip)</option>
          </select>
        </div>
        
        {/* Size Input */}
        <ValidatedInput
          value={size}
          onChange={setSize}
          min={minSize}
          max={10}
          label="Size (n)"
        />
        
        {/* Expansion Input */}
        <ValidatedInput
          value={expansion}
          onChange={setExpansion}
          min={0}
          max={20}
          label="Expansion (m)"
        />
        
        {/* Axial Transform Checkbox (only visible for P3) */}
        {wallpaperGroup === "P3" && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={useAxialTransform}
                onChange={(e) => setUseAxialTransform(e.target.checked)}
              />
              Show axial coordinates
            </label>
          </div>
        )}
      </div>
      
      {/* Error message display */}
      {errorMessage && (
        <div style={{
          padding: "12px 16px",
          marginBottom: "20px",
          backgroundColor: "#fee",
          border: "1px solid #e74c3c",
          borderRadius: "8px",
          color: "#c0392b",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span>⚠️ {errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "16px",
              color: "#c0392b",
            }}
          >
            ✕
          </button>
        </div>
      )}
      
      {/* Main content area */}
      <div style={{ display: "flex", gap: "40px", flexWrap: "wrap" }}>
        {/* Orbifold Grid Section */}
        <div>
          <h3 style={{ marginBottom: "10px" }}>Orbifold Grid ({size}×{size})</h3>
          
          {/* Tool selector */}
          <div style={{ 
            display: "flex", 
            gap: "8px", 
            marginBottom: "10px",
          }}>
            <button
              onClick={() => setTool("color")}
              style={{
                padding: "6px 12px",
                borderRadius: "4px",
                border: tool === "color" ? "2px solid #3498db" : "1px solid #ccc",
                backgroundColor: tool === "color" ? "#ebf5fb" : "white",
                cursor: "pointer",
                fontWeight: tool === "color" ? "bold" : "normal",
              }}
            >
              🎨 Color
            </button>
            <button
              onClick={() => setTool("inspect")}
              style={{
                padding: "6px 12px",
                borderRadius: "4px",
                border: tool === "inspect" ? "2px solid #3498db" : "1px solid #ccc",
                backgroundColor: tool === "inspect" ? "#ebf5fb" : "white",
                cursor: "pointer",
                fontWeight: tool === "inspect" ? "bold" : "normal",
              }}
            >
              🔍 Inspect
            </button>
            <button
              onClick={handleRandomSpanningTree}
              style={{
                padding: "6px 12px",
                borderRadius: "4px",
                border: "1px solid #27ae60",
                backgroundColor: "#e8f6ef",
                cursor: "pointer",
              }}
              title="Generate a random spanning tree of white nodes (solid = in tree, dashed = not in tree)"
            >
              🌲 Random Tree
            </button>
          </div>
          
          <p style={{ fontSize: "12px", color: "#666", marginBottom: "10px" }}>
            {tool === "color" 
              ? "Click cells to toggle black/white" 
              : "Click cells to inspect node info and voltages"}
          </p>
          
          <OrbifoldGridTools
            n={size}
            grid={orbifoldGrid}
            tool={tool}
            onColorToggle={handleColorToggle}
            onInspect={handleInspect}
            inspectedNodeId={inspectionInfo?.nodeId ?? null}
          />
          
          {/* Stats */}
          <div style={{ marginTop: "10px", fontSize: "12px", color: "#666" }}>
            <p>Orbifold nodes: {orbifoldGrid.nodes.size}</p>
            <p>Orbifold edges: {orbifoldGrid.edges.size}</p>
          </div>
          
          {/* Inspection Info Panel */}
          {inspectionInfo && (
            <div style={{ 
              marginTop: "16px", 
              padding: "12px", 
              backgroundColor: "#ebf5fb",
              borderRadius: "8px",
              border: "1px solid #3498db",
              maxWidth: "400px",
            }}>
              <h4 style={{ marginBottom: "8px", color: "#2980b9" }}>
                🔍 Node Inspection
              </h4>
              <p style={{ fontSize: "13px", marginBottom: "8px" }}>
                <strong>Node ID:</strong> <code style={{ backgroundColor: "#fff", padding: "2px 4px" }}>{inspectionInfo.nodeId}</code>
              </p>
              <p style={{ fontSize: "13px", marginBottom: "8px" }}>
                <strong>Coordinates:</strong> ({inspectionInfo.coord[0]}, {inspectionInfo.coord[1]})
              </p>
              <p style={{ fontSize: "13px", marginBottom: "4px" }}>
                <strong>Edges ({inspectionInfo.edges.length}):</strong>
              </p>
              <div style={{ 
                maxHeight: "200px", 
                overflowY: "auto",
                fontSize: "12px",
                fontFamily: "monospace",
              }}>
                {inspectionInfo.edges.map((edge, idx) => (
                  <div 
                    key={idx} 
                    style={{ 
                      marginBottom: "8px", 
                      padding: "6px",
                      backgroundColor: "white",
                      borderRadius: "4px",
                    }}
                  >
                    <div><strong>Edge ID:</strong> <code style={{ backgroundColor: "#f0f0f0", padding: "1px 3px", fontSize: "11px" }}>{edge.edgeId}</code></div>
                    <div><strong>→ Target:</strong> {edge.targetNodeId} ({edge.targetCoord[0]},{edge.targetCoord[1]})</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                      <strong>Linestyle:</strong>
                      <button
                        onClick={() => handleEdgeLinestyleToggle(edge.edgeId)}
                        style={{
                          padding: "2px 8px",
                          fontSize: "11px",
                          borderRadius: "4px",
                          border: "1px solid #3498db",
                          backgroundColor: edge.linestyle === "dashed" ? "#ebf5fb" : "white",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        <svg width="24" height="8" style={{ verticalAlign: "middle" }}>
                          <line
                            x1="2"
                            y1="4"
                            x2="22"
                            y2="4"
                            stroke="#3498db"
                            strokeWidth="2"
                            strokeDasharray={edge.linestyle === "dashed" ? "4,3" : undefined}
                          />
                        </svg>
                        {edge.linestyle}
                      </button>
                    </div>
                    <div><strong>Voltage:</strong></div>
                    {formatVoltageRows(edge.voltage).map((row, rowIdx) => (
                      <div key={rowIdx} style={{ marginLeft: "10px" }}>{row}</div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        
        {/* Lifted Graph */}
        <div>
          <h3 style={{ marginBottom: "10px" }}>Lifted Graph{wallpaperGroup === "P3" && useAxialTransform ? " (Axial → Cartesian)" : ""}</h3>
          <p style={{ fontSize: "12px", color: "#666", marginBottom: "10px" }}>
            Nodes: {liftedGraph.nodes.size} | Edges: {liftedGraph.edges.size}
            {inspectionInfo && (
              <span style={{ color: "#3498db", marginLeft: "8px" }}>
                (highlighted: {inspectionInfo.nodeId})
              </span>
            )}
          </p>
          
          {/* Display options */}
          <div style={{ 
            display: "flex", 
            flexWrap: "wrap",
            gap: "16px", 
            marginBottom: "10px",
            fontSize: "12px",
            alignItems: "center",
          }}>
            <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showDomains}
                onChange={(e) => setShowDomains(e.target.checked)}
              />
              Show domains
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showDashedLines}
                onChange={(e) => setShowDashedLines(e.target.checked)}
              />
              Show dashed lines
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={showNodes}
                onChange={(e) => setShowNodes(e.target.checked)}
              />
              Show nodes
            </label>
            <button
              onClick={handleExportSvg}
              style={{
                padding: "4px 10px",
                borderRadius: "4px",
                border: "1px solid #3498db",
                backgroundColor: "#ebf5fb",
                cursor: "pointer",
                fontSize: "12px",
              }}
              title="Download lifted graph as SVG file"
            >
              💾 Save SVG
            </button>
          </div>
          
          <LiftedGraphRenderer
            liftedGraph={liftedGraph}
            orbifoldGrid={orbifoldGrid}
            highlightOrbifoldNodeId={inspectionInfo?.nodeId}
            useAxialTransform={wallpaperGroup === "P3" && useAxialTransform}
            fundamentalDomainSize={size}
            selectedVoltageKey={selectedVoltageKey}
            onNodeClick={handleLiftedNodeClick}
            showDomains={showDomains}
            showDashedLines={showDashedLines}
            showNodes={showNodes}
            svgRef={liftedGraphSvgRef}
          />
          
          {/* Legend */}
          <div style={{ marginTop: "10px", fontSize: "12px", color: "#666" }}>
            <p>
              {showNodes && (
                <>
                  <span style={{ color: "#27ae60" }}>●</span> Interior nodes
                  <span style={{ marginLeft: "16px", color: "#e74c3c" }}>○</span> Exterior nodes
                  {inspectionInfo && (
                    <>
                      <span style={{ marginLeft: "16px", color: "#3498db" }}>◉</span> Highlighted
                    </>
                  )}
                </>
              )}
              {selectedVoltageKey && (
                <>
                  <span style={{ marginLeft: showNodes ? "16px" : "0" }}>▢</span> Selected domain (click node to highlight)
                </>
              )}
            </p>
            {showNodes && (
              <p style={{ marginTop: "4px" }}>
                Click on a lifted node to highlight its fundamental domain.
              </p>
            )}
          </div>
        </div>
      </div>
      
      {/* ── Graph Lift SAT Tool ── */}
      <div style={{
        marginTop: "30px",
        padding: "16px",
        backgroundColor: "#fef9e7",
        borderRadius: "8px",
        border: "1px solid #f39c12",
      }}>
        <h4 style={{ marginBottom: "12px" }}>🌳 Graph Lift Arborescence (SAT)</h4>
        <p style={{ fontSize: "13px", color: "#666", marginBottom: "12px" }}>
          Find an arborescence on the lifted graph: each orbifold node picks a parent edge,
          lifted nodes follow that choice.  The target node must be at least DST deep.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", alignItems: "flex-end", marginBottom: "12px" }}>
          {/* Root node */}
          <div>
            <label style={{ fontSize: "12px", display: "block", marginBottom: "4px" }}>Root (R)</label>
            <select
              value={graphLiftRoot ?? ""}
              onChange={e => setGraphLiftRoot(e.target.value || null)}
              style={{ padding: "4px", borderRadius: "4px", border: "1px solid #ccc", maxWidth: "220px" }}
            >
              <option value="">— select —</option>
              {liftedNodeIds.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>

          {/* Target node */}
          <div>
            <label style={{ fontSize: "12px", display: "block", marginBottom: "4px" }}>Target (N)</label>
            <select
              value={graphLiftTarget ?? ""}
              onChange={e => setGraphLiftTarget(e.target.value || null)}
              style={{ padding: "4px", borderRadius: "4px", border: "1px solid #ccc", maxWidth: "220px" }}
            >
              <option value="">— select —</option>
              {liftedNodeIds.map(id => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>

          {/* Distance */}
          <ValidatedInput
            value={graphLiftDist}
            onChange={setGraphLiftDist}
            min={1}
            max={999}
            label="Min depth (DST)"
          />

          {/* Solve / Cancel */}
          {!graphLiftSolving ? (
            <button
              onClick={handleGraphLiftSolve}
              disabled={!graphLiftRoot || !graphLiftTarget}
              style={{
                padding: "6px 16px",
                borderRadius: "4px",
                border: "1px solid #27ae60",
                backgroundColor: "#e8f6ef",
                cursor: graphLiftRoot && graphLiftTarget ? "pointer" : "not-allowed",
                opacity: graphLiftRoot && graphLiftTarget ? 1 : 0.5,
              }}
            >
              ▶ Solve
            </button>
          ) : (
            <button
              onClick={handleGraphLiftCancel}
              style={{
                padding: "6px 16px",
                borderRadius: "4px",
                border: "1px solid #e74c3c",
                backgroundColor: "#fdecea",
                cursor: "pointer",
              }}
            >
              ✕ Cancel
            </button>
          )}
        </div>

        {/* Stats */}
        {graphLiftStats && (
          <p style={{ fontSize: "12px", color: "#888", marginBottom: "8px" }}>
            SAT problem: {graphLiftStats.numVars} vars, {graphLiftStats.numClauses} clauses
            {graphLiftSolving && " — solving…"}
          </p>
        )}

        {/* Error */}
        {graphLiftError && (
          <p style={{ fontSize: "13px", color: "#c0392b", marginBottom: "8px" }}>⚠️ {graphLiftError}</p>
        )}

        {/* Result (totally disconnected from rest of page state) */}
        {graphLiftResult && (
          <div style={{
            marginTop: "12px",
            padding: "12px",
            backgroundColor: "#fff",
            borderRadius: "6px",
            border: "1px solid #d5dbdb",
            maxHeight: "400px",
            overflowY: "auto",
          }}>
            <h5 style={{ marginBottom: "8px" }}>Arborescence Result</h5>
            <table style={{ fontSize: "12px", borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "4px 8px" }}>Lifted Node</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "4px 8px" }}>Depth</th>
                  <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: "4px 8px" }}>Parent</th>
                </tr>
              </thead>
              <tbody>
                {Array.from(graphLiftResult.liftedDepth.entries())
                  .sort((a, b) => a[1] - b[1])
                  .map(([nodeId, depth]) => {
                    const parent = graphLiftResult.liftedParent.get(nodeId);
                    return (
                      <tr key={nodeId}>
                        <td style={{
                          padding: "3px 8px",
                          fontFamily: "monospace",
                          fontSize: "11px",
                          backgroundColor: nodeId === graphLiftRoot ? "#e8f6ef" : nodeId === graphLiftTarget ? "#fef9e7" : undefined,
                        }}>
                          {nodeId}
                          {nodeId === graphLiftRoot && " (root)"}
                          {nodeId === graphLiftTarget && " (target)"}
                        </td>
                        <td style={{ padding: "3px 8px" }}>{depth}</td>
                        <td style={{ padding: "3px 8px", fontFamily: "monospace", fontSize: "11px" }}>
                          {parent ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <p style={{ marginTop: "8px", fontSize: "12px", color: "#666" }}>
              Orbifold edge choices:{" "}
              {Array.from(graphLiftResult.orbifoldParentEdge.entries()).map(([n, e]) => `${n}→${e}`).join(", ")}
            </p>
          </div>
        )}
      </div>
      
      {/* Help text */}
      <div style={{ 
        marginTop: "30px", 
        padding: "16px", 
        backgroundColor: "#e8f4f8", 
        borderRadius: "8px",
        fontSize: "14px",
      }}>
        <h4 style={{ marginBottom: "8px" }}>About Orbifolds</h4>
        <p>
          An <strong>orbifold</strong> is a generalization of a surface that captures symmetry.
          The <strong>lifted graph</strong> shows how the fundamental domain tiles under the symmetry group.
        </p>
        <ul style={{ marginTop: "8px", paddingLeft: "20px" }}>
          <li><strong>P1:</strong> Simple torus wrapping (translations only)</li>
          <li><strong>P2:</strong> Includes 180° rotations at boundaries</li>
          <li><strong>pgg:</strong> Includes glide reflections at boundaries (no pure rotations)</li>
          <li><strong>P3:</strong> Includes 120° rotations at boundaries (3-fold symmetry, uses axial coordinates)</li>
          <li><strong>P4:</strong> Includes 90° rotations at boundaries (4-fold symmetry)</li>
          <li><strong>P4g:</strong> Like P4, but folded across the NW-SE diagonal (requires n &ge; 4)</li>
        </ul>
        <p style={{ marginTop: "8px" }}>
          Use <strong>🎨 Color</strong> tool to paint cells, or <strong>🔍 Inspect</strong> tool to see node coordinates, edges, and voltage matrices.
        </p>
        {wallpaperGroup === "P3" && (
          <p style={{ marginTop: "8px", color: "#666" }}>
            <strong>Note:</strong> P3 uses axial coordinates for 120° rotations. Neighbor distances in the lifted graph 
            may appear non-uniform in Cartesian display. Check "Show axial coordinates" for the transformed view.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Wrapped OrbifoldsExplorer with Error Boundary for graceful error handling.
 */
function OrbifoldsExplorerWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <OrbifoldsExplorer />
    </ErrorBoundary>
  );
}

export default OrbifoldsExplorerWithErrorBoundary;
