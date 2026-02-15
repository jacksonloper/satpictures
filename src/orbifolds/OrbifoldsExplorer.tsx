/**
 * Orbifolds Explorer Page
 * 
 * Allows a user to:
 * - Select a wallpaper group (P1, P2, P3, P4, P4g, or pgg)
 * - Set a size n (creating an n×n coloring grid)
 * - Set an expansion count m (how many times to expand the lifted graph)
 * - Color in the grid cells (black/white) using "color" tool
 * - Inspect nodes to see coordinates, edges, and voltages using "inspect" tool
 * - Set a root node using the "root" tool
 * - Find non-self-intersecting loops of a given length via SAT solving
 * - See the generated lifted graph with highlighting for inspected nodes
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  createOrbifoldGrid,
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
  type OrbifoldNodeId,
} from "./orbifoldbasics";
import { applyRandomSpanningTreeToWhiteNodes } from "./spanningTree";
import LoopFinderWorker from "./loop-finder.worker?worker";
import type { LoopFinderRequest, LoopFinderResponse } from "./loop-finder.worker";
import {
  ErrorBoundary,
  ValidatedInput,
  LiftedGraphRenderer,
  OrbifoldGridTools,
  LoopResultRenderer,
  type ToolType,
  type InspectionInfo,
} from "./components";
import "../App.css";

// Constants
const DEFAULT_SIZE = 3;
const DEFAULT_EXPANSION = 2;

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
  const [rootNodeId, setRootNodeId] = useState<OrbifoldNodeId | null>(null);
  const [loopLengthInput, setLoopLengthInput] = useState("");
  const [showLoopFinder, setShowLoopFinder] = useState(false);
  const [solvingLoop, setSolvingLoop] = useState(false);
  const [loopSatStats, setLoopSatStats] = useState<{ numVars: number; numClauses: number } | null>(null);
  const [pendingLoopResult, setPendingLoopResult] = useState<{
    pathNodeIds: string[];
    loopEdgeIds: string[];
  } | null>(null);
  const loopWorkerRef = useRef<Worker | null>(null);
  const minSize = wallpaperGroup === "P4g" ? 4 : 2;
  
  // Ref for SVG export
  const liftedGraphSvgRef = useRef<SVGSVGElement>(null);
  
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
    // Set default root to first node
    const firstNodeId = grid.nodes.keys().next().value as OrbifoldNodeId;
    setRootNodeId(firstNodeId ?? null);
    setShowLoopFinder(false);
    setSolvingLoop(false);
    setLoopSatStats(null);
    setPendingLoopResult(null);
  }, [wallpaperGroup, size]);

  // Handle cell color toggle (by node ID)
  const handleColorToggle = useCallback((nodeId: OrbifoldNodeId) => {
    setOrbifoldGrid((prev) => {
      const newGrid: OrbifoldGrid<ColorData, EdgeStyleData> = {
        nodes: new Map(prev.nodes),
        edges: prev.edges,
        adjacency: prev.adjacency,
      };
      
      const node = newGrid.nodes.get(nodeId);
      if (node) {
        const currentColor = node.data?.color ?? "white";
        const newColor = currentColor === "black" ? "white" : "black";
        node.data = { color: newColor };
      }
      
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

  // Handle root node setting
  const handleSetRoot = useCallback((nodeId: OrbifoldNodeId) => {
    setRootNodeId(nodeId);
  }, []);

  // Handle loop finder toggle
  const handleToggleLoopFinder = useCallback(() => {
    setShowLoopFinder(prev => !prev);
    setErrorMessage(null);
  }, []);

  // Handle loop finder cancel
  const handleCancelLoopFind = useCallback(() => {
    if (loopWorkerRef.current) {
      loopWorkerRef.current.terminate();
      loopWorkerRef.current = null;
      setSolvingLoop(false);
      setErrorMessage("Loop search cancelled");
    }
  }, []);

  // Handle loop finder solve
  const handleSolveLoop = useCallback(() => {
    const loopLength = parseInt(loopLengthInput, 10);
    if (!Number.isFinite(loopLength) || loopLength < 2) {
      setErrorMessage("Loop length must be a positive integer ≥ 2");
      return;
    }
    if (!rootNodeId) {
      setErrorMessage("Please set a root node first (use the 📌 Root tool)");
      return;
    }

    setErrorMessage(null);
    setSolvingLoop(true);
    setLoopSatStats(null);
    setPendingLoopResult(null);

    // Build adjacency data for the worker
    const grid = orbifoldGrid;
    const nodeIds = Array.from(grid.nodes.keys());

    // Collect black-colored node IDs
    const blackNodeIds: string[] = [];
    for (const [nodeId, node] of grid.nodes) {
      if (node.data?.color === "black") {
        blackNodeIds.push(nodeId);
      }
    }

    // Validate: there must be at least one non-black node
    const blackSet = new Set(blackNodeIds);
    if (blackNodeIds.length === nodeIds.length) {
      setErrorMessage("No non-black nodes available for the loop");
      setSolvingLoop(false);
      return;
    }

    // If root is black, hop to a non-black neighbor
    let effectiveRootNodeId = rootNodeId;
    if (blackSet.has(effectiveRootNodeId)) {
      const rootEdgeIds = grid.adjacency?.get(effectiveRootNodeId) ?? [];
      let newRoot: string | null = null;
      for (const edgeId of rootEdgeIds) {
        const edge = grid.edges.get(edgeId);
        if (!edge) continue;
        const halfEdge = edge.halfEdges.get(effectiveRootNodeId);
        if (!halfEdge) continue;
        if (!blackSet.has(halfEdge.to)) {
          newRoot = halfEdge.to;
          break;
        }
      }
      if (!newRoot) {
        // Try any non-black node as root
        newRoot = nodeIds.find(id => !blackSet.has(id)) ?? null;
      }
      if (!newRoot) {
        setErrorMessage("No non-black nodes available for the loop");
        setSolvingLoop(false);
        return;
      }
      effectiveRootNodeId = newRoot;
    }

    const adj: Record<string, string[]> = {};
    for (const nodeId of nodeIds) {
      const edgeIds = grid.adjacency?.get(nodeId) ?? [];
      const neighbors: string[] = [];
      for (const edgeId of edgeIds) {
        const edge = grid.edges.get(edgeId);
        if (!edge) continue;
        const halfEdge = edge.halfEdges.get(nodeId);
        if (!halfEdge) continue;
        if (!neighbors.includes(halfEdge.to)) {
          neighbors.push(halfEdge.to);
        }
      }
      adj[nodeId] = neighbors;
    }

    // Build edges data for the worker.
    // In orbifold half-edge representation, a self-edge (node connects to itself
    // with a non-trivial voltage) has only 1 key in halfEdges, while a normal
    // edge has 2 keys (one per endpoint).
    const edgesData: Array<{ edgeId: string; endpoints: [string, string] }> = [];
    for (const [edgeId, edge] of grid.edges) {
      const endpoints = Array.from(edge.halfEdges.keys());
      if (endpoints.length === 1) {
        edgesData.push({ edgeId, endpoints: [endpoints[0], endpoints[0]] });
      } else {
        edgesData.push({ edgeId, endpoints: [endpoints[0], endpoints[1]] });
      }
    }

    const request: LoopFinderRequest = {
      loopLength,
      rootNodeId: effectiveRootNodeId,
      nodeIds,
      adjacency: adj,
      edges: edgesData,
      blackNodeIds,
    };

    const worker = new LoopFinderWorker();
    loopWorkerRef.current = worker;

    worker.onmessage = (event: MessageEvent<LoopFinderResponse>) => {
      const response = event.data;

      if (response.messageType === "progress") {
        if (response.stats) {
          setLoopSatStats(response.stats);
        }
        return;
      }

      if (response.success && response.loopEdgeIds && response.pathNodeIds) {
        // Store the result for user to accept/reject
        setPendingLoopResult({
          pathNodeIds: response.pathNodeIds,
          loopEdgeIds: response.loopEdgeIds,
        });
        setErrorMessage(null);
      } else {
        setErrorMessage(response.error || "Loop search failed");
      }

      setSolvingLoop(false);
      loopWorkerRef.current = null;
    };

    worker.onerror = (error) => {
      setErrorMessage(`Worker error: ${error.message}`);
      setSolvingLoop(false);
      loopWorkerRef.current = null;
    };

    worker.postMessage(request);
  }, [loopLengthInput, rootNodeId, orbifoldGrid]);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (loopWorkerRef.current) {
        loopWorkerRef.current.terminate();
        loopWorkerRef.current = null;
      }
    };
  }, []);

  // Handle accepting the loop result: set selected loop edges as solid, others as dashed.
  // `selectedEdgeIds` is the per-step edge selection made by the user in the LoopResultRenderer.
  const handleAcceptLoop = useCallback((selectedEdgeIds: string[]) => {
    if (!pendingLoopResult) return;

    const chosenEdges = new Set(selectedEdgeIds);

    setOrbifoldGrid((prev) => {
      // Set chosen edges to solid, all others to dashed
      const newEdges = new Map(prev.edges);
      for (const [edgeId, edge] of newEdges) {
        const linestyle = chosenEdges.has(edgeId) ? "solid" : "dashed";
        newEdges.set(edgeId, { ...edge, data: { linestyle } });
      }
      return { nodes: prev.nodes, edges: newEdges, adjacency: prev.adjacency };
    });

    setInspectionInfo(null);
    setPendingLoopResult(null);
  }, [pendingLoopResult]);

  // Handle rejecting the loop result: keep original edge styles
  const handleRejectLoop = useCallback(() => {
    setPendingLoopResult(null);
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
              onClick={() => setTool("root")}
              style={{
                padding: "6px 12px",
                borderRadius: "4px",
                border: tool === "root" ? "2px solid #e67e22" : "1px solid #ccc",
                backgroundColor: tool === "root" ? "#fef5e7" : "white",
                cursor: "pointer",
                fontWeight: tool === "root" ? "bold" : "normal",
              }}
              title="Click a node to set it as the root for loop finding"
            >
              📌 Root
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
            <button
              onClick={handleToggleLoopFinder}
              style={{
                padding: "6px 12px",
                borderRadius: "4px",
                border: showLoopFinder ? "2px solid #8e44ad" : "1px solid #8e44ad",
                backgroundColor: showLoopFinder ? "#f4ecf7" : "#faf5ff",
                cursor: "pointer",
                fontWeight: showLoopFinder ? "bold" : "normal",
              }}
              title="Find a non-self-intersecting loop of given length via SAT solver"
            >
              🔄 Find Loop
            </button>
          </div>
          
          <p style={{ fontSize: "12px", color: "#666", marginBottom: "10px" }}>
            {tool === "color" 
              ? "Click cells to toggle black/white" 
              : tool === "root"
              ? "Click a node to set it as root"
              : "Click cells to inspect node info and voltages"}
          </p>
          
          {/* Loop Finder Panel */}
          {showLoopFinder && (
            <div style={{
              marginBottom: "10px",
              padding: "10px",
              backgroundColor: "#f4ecf7",
              borderRadius: "8px",
              border: "1px solid #8e44ad",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <label style={{ fontSize: "13px" }}>Nodes in loop:</label>
                <input
                  type="text"
                  value={loopLengthInput}
                  onChange={(e) => setLoopLengthInput(e.target.value)}
                  disabled={solvingLoop}
                  style={{
                    width: "60px",
                    padding: "4px 8px",
                    borderRadius: "4px",
                    border: "1px solid #ccc",
                    fontSize: "13px",
                  }}
                  placeholder="e.g. 5"
                />
                <button
                  onClick={handleSolveLoop}
                  disabled={solvingLoop}
                  style={{
                    padding: "4px 12px",
                    borderRadius: "4px",
                    border: "1px solid #8e44ad",
                    backgroundColor: solvingLoop ? "#d5d8dc" : "#e8daef",
                    cursor: solvingLoop ? "not-allowed" : "pointer",
                    fontSize: "13px",
                  }}
                >
                  {solvingLoop ? "Solving…" : "Solve"}
                </button>
                <button
                  onClick={handleCancelLoopFind}
                  style={{
                    padding: "4px 12px",
                    borderRadius: "4px",
                    border: "1px solid #e74c3c",
                    backgroundColor: "#fadbd8",
                    cursor: "pointer",
                    fontSize: "13px",
                  }}
                >
                  Cancel
                </button>
              </div>
              {loopSatStats && (
                <p style={{ fontSize: "11px", color: "#666", marginTop: "6px" }}>
                  SAT: {loopSatStats.numVars} vars, {loopSatStats.numClauses} clauses
                </p>
              )}
              {rootNodeId && (
                <p style={{ fontSize: "11px", color: "#666", marginTop: "4px" }}>
                  Root: <code style={{ backgroundColor: "#fff", padding: "1px 4px" }}>{rootNodeId}</code>
                </p>
              )}
              {!rootNodeId && (
                <p style={{ fontSize: "11px", color: "#e74c3c", marginTop: "4px" }}>
                  ⚠️ Set a root node first (use 📌 Root tool)
                </p>
              )}
            </div>
          )}
          
          {/* Loop Result Preview (Accept/Reject) */}
          {pendingLoopResult && rootNodeId && (
            <LoopResultRenderer
              n={size}
              grid={orbifoldGrid}
              pathNodeIds={pendingLoopResult.pathNodeIds}
              rootNodeId={rootNodeId}
              onAccept={handleAcceptLoop}
              onReject={handleRejectLoop}
              wallpaperGroup={wallpaperGroup}
            />
          )}
          
          <OrbifoldGridTools
            n={size}
            grid={orbifoldGrid}
            tool={tool}
            onColorToggle={handleColorToggle}
            onInspect={handleInspect}
            onSetRoot={handleSetRoot}
            inspectedNodeId={inspectionInfo?.nodeId ?? null}
            rootNodeId={rootNodeId}
            wallpaperGroup={wallpaperGroup}
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
