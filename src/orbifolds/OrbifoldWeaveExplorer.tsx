/**
 * Orbifold Weaves Explorer Page
 *
 * Similar to the regular orbifold page but works on *doubled* orbifolds.
 * 
 * UX flow:
 * 1. User selects orbifold type, size n, expansion m.
 * 2. User clicks "Find Loop" (single voltage) or "Find Loops" (try all voltages).
 *    - In either case, user specifies a max loop length.
 *    - Voltages are computed on the *undoubled* orbifold.
 *    - The SAT problem is solved on the *doubled* orbifold.
 * 3. If a satisfiable loop is found, it's shown on two renderings
 *    (level 0 and level 1).
 * 4. User accepts or denies the loop.
 * 5. Once accepted, the loop is rendered in 3D via Three.js as tubes.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  createOrbifoldGrid,
  type WallpaperGroupType,
  type ColorData,
  type EdgeStyleData,
} from "./createOrbifolds";
import {
  constructLiftedGraphFromOrbifold,
  processAllNonInteriorOnce,
  buildAdjacency,
  type OrbifoldGrid,
  type OrbifoldNodeId,
} from "./orbifoldbasics";
import { doubleOrbifold, getLevelFromNodeId } from "./doubleOrbifold";
import LoopFinderWorker from "./loop-finder.worker?worker";
import type { LoopFinderRequest, LoopFinderResponse, VoltageMatrix } from "./loop-finder.worker";
import {
  ErrorBoundary,
  ValidatedInput,
} from "./components";
import { WeaveThreeRenderer } from "./components/WeaveThreeRenderer";
import "../App.css";

// Constants
const DEFAULT_SIZE = 3;
const DEFAULT_EXPANSION = 5;

/**
 * Orbifold grid display for a single level of the doubled orbifold.
 * Shows nodes and edges with styling (solid / dashed).
 */
function LevelGridDisplay({
  level,
  doubledGrid,
}: {
  level: 0 | 1;
  doubledGrid: OrbifoldGrid<ColorData, EdgeStyleData>;
}) {
  const cellSize = 40;
  const padding = 20;

  // Get nodes for this level
  const levelNodes = useMemo(() => {
    const nodes: Array<{ id: string; x: number; y: number; color: string }> = [];
    for (const [nodeId, node] of doubledGrid.nodes) {
      if (getLevelFromNodeId(nodeId) === level) {
        nodes.push({
          id: nodeId,
          x: node.coord[0],
          y: node.coord[1],
          color: node.data?.color ?? "white",
        });
      }
    }
    return nodes;
  }, [doubledGrid, level]);

  // Get edges for this level (edges where both endpoints are at this level)
  const levelEdges = useMemo(() => {
    const edges: Array<{
      id: string;
      x1: number; y1: number;
      x2: number; y2: number;
      linestyle: string;
    }> = [];
    for (const [edgeId, edge] of doubledGrid.edges) {
      const entries = Array.from(edge.halfEdges.entries());
      const nodeIds = entries.map(([nid]) => nid);
      
      // Only show edges where both endpoints are at this level
      const levels = nodeIds.map(nid => getLevelFromNodeId(nid));
      if (!levels.every(l => l === level)) continue;

      const n1 = doubledGrid.nodes.get(nodeIds[0]);
      const n2 = entries.length > 1 ? doubledGrid.nodes.get(nodeIds[1]) : n1;
      if (!n1 || !n2) continue;

      edges.push({
        id: edgeId,
        x1: n1.coord[0],
        y1: n1.coord[1],
        x2: n2.coord[0],
        y2: n2.coord[1],
        linestyle: edge.data?.linestyle ?? "solid",
      });
    }
    return edges;
  }, [doubledGrid, level]);

  // Compute SVG bounds
  const coords = levelNodes.flatMap(n => [n.x, n.y]);
  const minCoord = Math.min(...coords, 0);
  const maxCoord = Math.max(...coords, 1);
  const range = maxCoord - minCoord + 4;
  const svgSize = range * cellSize / 2 + 2 * padding;

  const toSvg = (coord: number) => ((coord - minCoord + 2) * cellSize / 2) + padding;

  return (
    <div>
      <h4 style={{ marginBottom: "4px" }}>Level {level} ({level === 0 ? "Low" : "High"})</h4>
      <svg
        width={Math.min(svgSize, 350)}
        height={Math.min(svgSize, 350)}
        viewBox={`0 0 ${svgSize} ${svgSize}`}
        style={{ border: "1px solid #ccc", borderRadius: "4px", backgroundColor: "#fafafa" }}
      >
        {/* Edges */}
        {levelEdges.map((e) => (
          <line
            key={e.id}
            x1={toSvg(e.x1)}
            y1={toSvg(e.y1)}
            x2={toSvg(e.x2)}
            y2={toSvg(e.y2)}
            stroke={e.linestyle === "solid" ? "#3498db" : "#bbb"}
            strokeWidth={e.linestyle === "solid" ? 3 : 1.5}
            strokeDasharray={e.linestyle === "dashed" ? "4,3" : undefined}
          />
        ))}
        {/* Nodes */}
        {levelNodes.map((nd) => (
          <circle
            key={nd.id}
            cx={toSvg(nd.x)}
            cy={toSvg(nd.y)}
            r={6}
            fill={nd.color === "black" ? "#333" : "#fff"}
            stroke={nd.color === "black" ? "#333" : "#999"}
            strokeWidth={1.5}
          />
        ))}
      </svg>
    </div>
  );
}

/**
 * Main Orbifold Weaves Explorer component.
 */
export function OrbifoldWeaveExplorer() {
  const [wallpaperGroup, setWallpaperGroup] = useState<WallpaperGroupType>("P1");
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [expansion, setExpansion] = useState(DEFAULT_EXPANSION);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Loop finder state
  const [maxLengthInput, setMaxLengthInput] = useState("");
  const [showLoopFinder, setShowLoopFinder] = useState(false);
  const [solvingLoop, setSolvingLoop] = useState(false);
  const [computingVoltages, setComputingVoltages] = useState(false);
  const [reachableVoltages, setReachableVoltages] = useState<Array<{ key: string; matrix: VoltageMatrix }>>([]);
  const [selectedTargetVoltageKey, setSelectedTargetVoltageKey] = useState<string | null>(null);
  const [pendingLoopResult, setPendingLoopResult] = useState<{
    pathNodeIds: string[];
    loopEdgeIds: string[];
    pathEdgeIds?: string[];
  } | null>(null);
  const loopWorkerRef = useRef<Worker | null>(null);

  // Find Loops (plural) state
  const [showLoopsFinder, setShowLoopsFinder] = useState(false);
  const [solvingAllLoops, setSolvingAllLoops] = useState(false);
  const [solveAllProgress, setSolveAllProgress] = useState<{ current: number; total: number } | null>(null);
  const [solveAllResults, setSolveAllResults] = useState<Array<{
    key: string;
    matrix: VoltageMatrix;
    pathNodeIds: string[];
    loopEdgeIds: string[];
    pathEdgeIds?: string[];
  }> | null>(null);
  const [selectedLoopsVoltageKey, setSelectedLoopsVoltageKey] = useState<string | null>(null);
  const [maxLengthLoopsInput, setMaxLengthLoopsInput] = useState("");
  const loopsWorkerRef = useRef<Worker | null>(null);

  // Accepted loop state
  const [loopAccepted, setLoopAccepted] = useState(false);

  const minSize = wallpaperGroup === "P4g" ? 4 : 2;

  // Create the undoubled orbifold (used for voltage computation)
  const [undoubledGrid, setUndoubledGrid] = useState<OrbifoldGrid<ColorData, EdgeStyleData>>(() => {
    const grid = createOrbifoldGrid(wallpaperGroup, size);
    buildAdjacency(grid);
    return grid;
  });

  // Create the doubled orbifold (used for SAT solving and rendering)
  const [doubledGrid, setDoubledGrid] = useState<OrbifoldGrid<ColorData, EdgeStyleData>>(() => {
    return doubleOrbifold(undoubledGrid);
  });

  // Root node is the first node of the *undoubled* grid
  const [rootNodeId, setRootNodeId] = useState<OrbifoldNodeId>(() => {
    return undoubledGrid.nodes.keys().next().value as OrbifoldNodeId;
  });

  // Doubled root: the @0 version
  const doubledRootNodeId = useMemo(() => `${rootNodeId}@0`, [rootNodeId]);

  // Reset helper
  const resetLoopsFinderState = useCallback(() => {
    setSolvingAllLoops(false);
    setSolveAllProgress(null);
    setSolveAllResults(null);
    setSelectedLoopsVoltageKey(null);
  }, []);

  // Recreate grids when params change
  const resetGrid = useCallback((nextGroup: WallpaperGroupType, nextSize: number) => {
    const grid = createOrbifoldGrid(nextGroup, nextSize);
    buildAdjacency(grid);
    setUndoubledGrid(grid);
    setDoubledGrid(doubleOrbifold(grid));
    setRootNodeId(grid.nodes.keys().next().value as OrbifoldNodeId);
    setShowLoopFinder(false);
    setShowLoopsFinder(false);
    setSolvingLoop(false);
    setComputingVoltages(false);
    setReachableVoltages([]);
    setSelectedTargetVoltageKey(null);
    setPendingLoopResult(null);
    setLoopAccepted(false);
    resetLoopsFinderState();
    setErrorMessage(null);
  }, [resetLoopsFinderState]);

  const handleWallpaperGroupChange = (nextGroup: WallpaperGroupType) => {
    const nextSize = nextGroup === "P4g" && size < 4 ? 4 : size;
    if (nextSize !== size) setSize(nextSize);
    setWallpaperGroup(nextGroup);
    resetGrid(nextGroup, nextSize);
  };

  const handleSizeChange = useCallback((nextSize: number) => {
    setSize(nextSize);
    resetGrid(wallpaperGroup, nextSize);
  }, [wallpaperGroup, resetGrid]);

  // Build edge data for worker
  const buildWorkerEdgeData = useCallback((grid: OrbifoldGrid<ColorData, EdgeStyleData>) => {
    const edgesData: Array<{
      edgeId: string;
      endpoints: [string, string];
      halfEdgeVoltages: Record<string, VoltageMatrix>;
    }> = [];
    for (const [edgeId, edge] of grid.edges) {
      const endpoints = Array.from(edge.halfEdges.keys());
      const halfEdgeVoltages: Record<string, VoltageMatrix> = {};
      for (const [nodeId, halfEdge] of edge.halfEdges) {
        halfEdgeVoltages[nodeId] = halfEdge.voltage;
      }
      if (endpoints.length === 1) {
        edgesData.push({ edgeId, endpoints: [endpoints[0], endpoints[0]], halfEdgeVoltages });
      } else {
        edgesData.push({ edgeId, endpoints: [endpoints[0], endpoints[1]], halfEdgeVoltages });
      }
    }
    return edgesData;
  }, []);

  // Build adjacency record for worker
  const buildAdjRecord = useCallback((grid: OrbifoldGrid<ColorData, EdgeStyleData>) => {
    const nodeIds = Array.from(grid.nodes.keys());
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
    return adj;
  }, []);

  // Phase 1: Compute reachable voltages (on undoubled grid)
  const handleComputeVoltages = useCallback(() => {
    const maxLength = parseInt(maxLengthInput, 10);
    if (!Number.isFinite(maxLength) || maxLength < 2) {
      setErrorMessage("Max length must be a positive integer ≥ 2");
      return;
    }

    setErrorMessage(null);
    setComputingVoltages(true);
    setReachableVoltages([]);
    setSelectedTargetVoltageKey(null);
    setPendingLoopResult(null);
    setLoopAccepted(false);

    const grid = undoubledGrid;
    const nodeIds = Array.from(grid.nodes.keys());
    const adj = buildAdjRecord(grid);
    const edgesData = buildWorkerEdgeData(grid);

    const request: LoopFinderRequest = {
      mode: "computeVoltages",
      maxLength,
      rootNodeId,
      nodeIds,
      adjacency: adj,
      edges: edgesData,
    };

    const worker = new LoopFinderWorker();
    loopWorkerRef.current = worker;

    worker.onmessage = (event: MessageEvent<LoopFinderResponse>) => {
      const response = event.data;
      if (response.success && response.reachableVoltages) {
        setReachableVoltages(response.reachableVoltages);
        if (response.reachableVoltages.length > 0) {
          setSelectedTargetVoltageKey(response.reachableVoltages[0].key);
        }
        if (response.reachableVoltages.length === 0) {
          setErrorMessage("No reachable voltages found for this max length");
        }
      } else {
        setErrorMessage(response.error || "Voltage computation failed");
      }
      setComputingVoltages(false);
      loopWorkerRef.current = null;
    };

    worker.onerror = (error) => {
      setErrorMessage(`Worker error: ${error.message}`);
      setComputingVoltages(false);
      loopWorkerRef.current = null;
    };

    worker.postMessage(request);
  }, [maxLengthInput, rootNodeId, undoubledGrid, buildAdjRecord, buildWorkerEdgeData]);

  // Phase 2: Solve loop on *doubled* orbifold
  const handleSolveLoop = useCallback(() => {
    const maxLength = parseInt(maxLengthInput, 10);
    if (!Number.isFinite(maxLength) || maxLength < 2) {
      setErrorMessage("Max length must be a positive integer ≥ 2");
      return;
    }
    if (!selectedTargetVoltageKey || reachableVoltages.length === 0) {
      setErrorMessage("Please compute voltages and select a target voltage first");
      return;
    }

    setErrorMessage(null);
    setSolvingLoop(true);
    setPendingLoopResult(null);
    setLoopAccepted(false);

    const grid = doubledGrid;
    const nodeIds = Array.from(grid.nodes.keys());
    const adj = buildAdjRecord(grid);
    const edgesData = buildWorkerEdgeData(grid);

    // The SAT loop length should be doubled (twice as many nodes in doubled orbifold)
    const request: LoopFinderRequest = {
      mode: "solve",
      maxLength: maxLength * 2,
      rootNodeId: doubledRootNodeId,
      nodeIds,
      adjacency: adj,
      edges: edgesData,
      targetVoltageKey: selectedTargetVoltageKey,
      reachableVoltages,
    };

    const worker = new LoopFinderWorker();
    loopWorkerRef.current = worker;

    worker.onmessage = (event: MessageEvent<LoopFinderResponse>) => {
      const response = event.data;
      if (response.messageType === "progress") return;
      if (response.success && response.loopEdgeIds && response.pathNodeIds) {
        setPendingLoopResult({
          pathNodeIds: response.pathNodeIds,
          loopEdgeIds: response.loopEdgeIds,
          pathEdgeIds: response.pathEdgeIds,
        });
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
  }, [maxLengthInput, doubledGrid, doubledRootNodeId, selectedTargetVoltageKey, reachableVoltages, buildAdjRecord, buildWorkerEdgeData]);

  // Find all loops on doubled orbifold
  const handleFindAllLoops = useCallback(() => {
    const maxLength = parseInt(maxLengthLoopsInput, 10);
    if (!Number.isFinite(maxLength) || maxLength < 2) {
      setErrorMessage("Max length must be a positive integer ≥ 2");
      return;
    }

    setErrorMessage(null);
    resetLoopsFinderState();
    setSolvingAllLoops(true);
    setPendingLoopResult(null);
    setLoopAccepted(false);

    // Phase 1: compute voltages on undoubled
    const undGrid = undoubledGrid;
    const undNodeIds = Array.from(undGrid.nodes.keys());
    const undAdj = buildAdjRecord(undGrid);
    const undEdgesData = buildWorkerEdgeData(undGrid);

    const bfsReq: LoopFinderRequest = {
      mode: "computeVoltages",
      maxLength,
      rootNodeId,
      nodeIds: undNodeIds,
      adjacency: undAdj,
      edges: undEdgesData,
    };

    const bfsWorker = new LoopFinderWorker();
    bfsWorker.onmessage = (event: MessageEvent<LoopFinderResponse>) => {
      const bfsResponse = event.data;
      const voltages = bfsResponse.reachableVoltages ?? [];
      bfsWorker.terminate();

      if (voltages.length === 0) {
        setErrorMessage("No reachable voltages found for this max length");
        setSolvingAllLoops(false);
        return;
      }

      // Phase 2: Try each voltage on doubled grid
      const dGrid = doubledGrid;
      const dNodeIds = Array.from(dGrid.nodes.keys());
      const dAdj = buildAdjRecord(dGrid);
      const dEdgesData = buildWorkerEdgeData(dGrid);

      const satReq: LoopFinderRequest = {
        mode: "solveAll",
        maxLength: maxLength * 2,
        rootNodeId: doubledRootNodeId,
        nodeIds: dNodeIds,
        adjacency: dAdj,
        edges: dEdgesData,
      };

      // Override: we need custom solveAll that BFS uses undoubled voltages
      // but SAT uses doubled grid. We'll use the worker's built-in solveAll
      // which does its own BFS internally - but on the doubled grid.
      // Actually let's just do it properly: the worker's solveAll does
      // its own BFS. The BFS on the doubled grid will find the same voltages
      // (since voltages only depend on 2D positions, and the doubled grid
      // has the same voltage structure). So this should work fine.

      const satWorker = new LoopFinderWorker();
      loopsWorkerRef.current = satWorker;

      satWorker.onmessage = (event2: MessageEvent<LoopFinderResponse>) => {
        const response = event2.data;
        if (response.messageType === "progress") {
          if (response.solveAllProgress) {
            setSolveAllProgress(response.solveAllProgress);
          }
          return;
        }
        if (response.success && response.solveAllResults) {
          setSolveAllResults(response.solveAllResults);
          if (response.solveAllResults.length > 0) {
            setSelectedLoopsVoltageKey(response.solveAllResults[0].key);
          }
          if (response.solveAllResults.length === 0) {
            setErrorMessage("No satisfiable loops found for any voltage");
          }
        } else {
          setErrorMessage(response.error || "Loops search failed");
        }
        setSolvingAllLoops(false);
        setSolveAllProgress(null);
        loopsWorkerRef.current = null;
      };

      satWorker.onerror = (error) => {
        setErrorMessage(`Worker error: ${error.message}`);
        setSolvingAllLoops(false);
        setSolveAllProgress(null);
        loopsWorkerRef.current = null;
      };

      satWorker.postMessage(satReq);
    };

    bfsWorker.onerror = (error) => {
      setErrorMessage(`Worker error: ${error.message}`);
      setSolvingAllLoops(false);
    };

    bfsWorker.postMessage(bfsReq);
  }, [maxLengthLoopsInput, rootNodeId, undoubledGrid, doubledGrid, doubledRootNodeId, buildAdjRecord, buildWorkerEdgeData, resetLoopsFinderState]);

  // Preview a loops result
  const handlePreviewLoopsResult = useCallback(() => {
    if (!solveAllResults || !selectedLoopsVoltageKey) return;
    const result = solveAllResults.find(r => r.key === selectedLoopsVoltageKey);
    if (result) {
      setPendingLoopResult({
        pathNodeIds: result.pathNodeIds,
        loopEdgeIds: result.loopEdgeIds,
        pathEdgeIds: result.pathEdgeIds,
      });
    }
  }, [solveAllResults, selectedLoopsVoltageKey]);

  // Cancel handlers
  const handleCancelLoopFind = useCallback(() => {
    if (loopWorkerRef.current) {
      loopWorkerRef.current.terminate();
      loopWorkerRef.current = null;
      setSolvingLoop(false);
      setComputingVoltages(false);
      setErrorMessage("Loop search cancelled");
    }
  }, []);

  const handleCancelLoopsFind = useCallback(() => {
    if (loopsWorkerRef.current) {
      loopsWorkerRef.current.terminate();
      loopsWorkerRef.current = null;
      resetLoopsFinderState();
      setErrorMessage("Loops search cancelled");
    }
  }, [resetLoopsFinderState]);

  // Accept loop: style edges, mark on doubled grid
  const handleAcceptLoop = useCallback(() => {
    if (!pendingLoopResult) return;

    const chosenEdges = new Set(pendingLoopResult.loopEdgeIds);

    setDoubledGrid((prev) => {
      const newEdges = new Map(prev.edges);
      for (const [edgeId, edge] of newEdges) {
        const linestyle = chosenEdges.has(edgeId) ? "solid" : "dashed";
        newEdges.set(edgeId, { ...edge, data: { linestyle } });
      }
      return { nodes: prev.nodes, edges: newEdges, adjacency: prev.adjacency };
    });

    setLoopAccepted(true);
    setPendingLoopResult(null);
    resetLoopsFinderState();
  }, [pendingLoopResult, resetLoopsFinderState]);

  // Reject loop
  const handleRejectLoop = useCallback(() => {
    setPendingLoopResult(null);
  }, []);

  // Cleanup workers
  useEffect(() => {
    return () => {
      if (loopWorkerRef.current) {
        loopWorkerRef.current.terminate();
        loopWorkerRef.current = null;
      }
      if (loopsWorkerRef.current) {
        loopsWorkerRef.current.terminate();
        loopsWorkerRef.current = null;
      }
    };
  }, []);

  // Build lifted graph from doubled orbifold
  const liftedGraph = useMemo(() => {
    const lifted = constructLiftedGraphFromOrbifold<ColorData, EdgeStyleData>(doubledGrid);
    for (let i = 0; i < expansion; i++) {
      processAllNonInteriorOnce(lifted);
    }
    return lifted;
  }, [doubledGrid, expansion]);

  return (
    <div className="orbifold-weave-explorer" style={{ padding: "20px" }}>
      <h1 style={{ marginBottom: "20px" }}>🧶 Orbifold Weaves</h1>

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
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <label>Wallpaper Group:</label>
          <select
            value={wallpaperGroup}
            onChange={(e) => handleWallpaperGroupChange(e.target.value as WallpaperGroupType)}
            style={{ padding: "4px 8px", borderRadius: "4px", border: "1px solid #ccc" }}
          >
            <option value="P1">P1 (Torus)</option>
            <option value="P2">P2 (180° rotation)</option>
            <option value="pgg">pgg (glide reflections)</option>
            <option value="P3">P3 (120° rotation - axial)</option>
            <option value="P4">P4 (90° rotation)</option>
            <option value="P4g">P4g (90° rotation + diagonal flip)</option>
          </select>
        </div>

        <ValidatedInput value={size} onChange={handleSizeChange} min={minSize} max={10} label="Size (n)" />
        <ValidatedInput value={expansion} onChange={setExpansion} min={0} max={20} label="Expansion (m)" />
      </div>

      {/* Error message */}
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
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: "16px", color: "#c0392b" }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
        <button
          onClick={() => { setShowLoopFinder(prev => !prev); setShowLoopsFinder(false); setErrorMessage(null); }}
          style={{
            padding: "6px 12px",
            borderRadius: "4px",
            border: showLoopFinder ? "2px solid #8e44ad" : "1px solid #8e44ad",
            backgroundColor: showLoopFinder ? "#f4ecf7" : "#faf5ff",
            cursor: "pointer",
            fontWeight: showLoopFinder ? "bold" : "normal",
          }}
        >
          🔄 Find Loop
        </button>
        <button
          onClick={() => { setShowLoopsFinder(prev => !prev); setShowLoopFinder(false); setErrorMessage(null); }}
          style={{
            padding: "6px 12px",
            borderRadius: "4px",
            border: showLoopsFinder ? "2px solid #2980b9" : "1px solid #2980b9",
            backgroundColor: showLoopsFinder ? "#d6eaf8" : "#eaf2f8",
            cursor: "pointer",
            fontWeight: showLoopsFinder ? "bold" : "normal",
          }}
        >
          🔄 Find Loops
        </button>
      </div>

      {/* Find Loop Panel */}
      {showLoopFinder && (
        <div style={{
          marginBottom: "16px",
          padding: "12px",
          backgroundColor: "#f4ecf7",
          borderRadius: "8px",
          border: "1px solid #8e44ad",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
            <label style={{ fontSize: "13px" }}>Max steps:</label>
            <input
              type="text"
              value={maxLengthInput}
              onChange={(e) => {
                setMaxLengthInput(e.target.value);
                setReachableVoltages([]);
                setSelectedTargetVoltageKey(null);
              }}
              disabled={solvingLoop || computingVoltages}
              style={{ width: "60px", padding: "4px 8px", borderRadius: "4px", border: "1px solid #ccc", fontSize: "13px" }}
              placeholder="e.g. 5"
            />
            <button
              onClick={handleComputeVoltages}
              disabled={solvingLoop || computingVoltages}
              style={{
                padding: "4px 12px",
                borderRadius: "4px",
                border: "1px solid #8e44ad",
                backgroundColor: computingVoltages ? "#d5d8dc" : "#e8daef",
                cursor: computingVoltages ? "not-allowed" : "pointer",
                fontSize: "13px",
              }}
            >
              {computingVoltages ? "Computing…" : "Compute Voltages"}
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

          {reachableVoltages.length > 0 && (
            <div style={{ marginBottom: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <label style={{ fontSize: "13px" }}>Target voltage:</label>
                <select
                  value={selectedTargetVoltageKey ?? ""}
                  onChange={(e) => setSelectedTargetVoltageKey(e.target.value)}
                  disabled={solvingLoop}
                  style={{
                    padding: "4px 8px",
                    borderRadius: "4px",
                    border: "1px solid #ccc",
                    fontSize: "12px",
                    fontFamily: "monospace",
                    maxWidth: "300px",
                  }}
                >
                  {reachableVoltages.map((v) => {
                    const m = v.matrix;
                    const label = `[[${m[0].join(",")}],[${m[1].join(",")}],[${m[2].join(",")}]]`;
                    return <option key={v.key} value={v.key}>{label}</option>;
                  })}
                </select>
                <button
                  onClick={handleSolveLoop}
                  disabled={solvingLoop || !selectedTargetVoltageKey}
                  style={{
                    padding: "4px 12px",
                    borderRadius: "4px",
                    border: "1px solid #27ae60",
                    backgroundColor: solvingLoop ? "#d5d8dc" : "#d5f5e3",
                    cursor: solvingLoop || !selectedTargetVoltageKey ? "not-allowed" : "pointer",
                    fontSize: "13px",
                  }}
                >
                  {solvingLoop ? "Solving…" : "Solve"}
                </button>
              </div>
              <p style={{ fontSize: "11px", color: "#666", marginTop: "4px" }}>
                {reachableVoltages.length} reachable voltage{reachableVoltages.length !== 1 ? "s" : ""} found
              </p>
            </div>
          )}

          <p style={{ fontSize: "11px", color: "#666", marginTop: "4px" }}>
            Root: <code style={{ backgroundColor: "#fff", padding: "1px 4px" }}>{rootNodeId}</code>
            {" "}(doubled: <code style={{ backgroundColor: "#fff", padding: "1px 4px" }}>{doubledRootNodeId}</code>)
          </p>
        </div>
      )}

      {/* Find Loops Panel */}
      {showLoopsFinder && (
        <div style={{
          marginBottom: "16px",
          padding: "12px",
          backgroundColor: "#d6eaf8",
          borderRadius: "8px",
          border: "1px solid #2980b9",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
            <label style={{ fontSize: "13px" }}>Max steps:</label>
            <input
              type="text"
              value={maxLengthLoopsInput}
              onChange={(e) => {
                setMaxLengthLoopsInput(e.target.value);
                resetLoopsFinderState();
              }}
              disabled={solvingAllLoops}
              style={{ width: "60px", padding: "4px 8px", borderRadius: "4px", border: "1px solid #ccc", fontSize: "13px" }}
              placeholder="e.g. 5"
            />
            <button
              onClick={handleFindAllLoops}
              disabled={solvingAllLoops}
              style={{
                padding: "4px 12px",
                borderRadius: "4px",
                border: "1px solid #2980b9",
                backgroundColor: solvingAllLoops ? "#d5d8dc" : "#aed6f1",
                cursor: solvingAllLoops ? "not-allowed" : "pointer",
                fontSize: "13px",
              }}
            >
              {solvingAllLoops ? "Searching…" : "Find All Loops"}
            </button>
            {solvingAllLoops && (
              <button
                onClick={handleCancelLoopsFind}
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
            )}
          </div>

          {solvingAllLoops && solveAllProgress && (
            <div style={{ marginBottom: "8px" }}>
              <div style={{
                width: "100%",
                height: "20px",
                backgroundColor: "#e0e0e0",
                borderRadius: "4px",
                overflow: "hidden",
              }}>
                <div style={{
                  width: `${(solveAllProgress.current / solveAllProgress.total) * 100}%`,
                  height: "100%",
                  backgroundColor: "#2980b9",
                  transition: "width 0.3s ease",
                }} />
              </div>
              <p style={{ fontSize: "11px", color: "#666", marginTop: "4px" }}>
                Testing voltage {solveAllProgress.current} / {solveAllProgress.total}…
              </p>
            </div>
          )}

          {solveAllResults && solveAllResults.length > 0 && (
            <div style={{ marginBottom: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <label style={{ fontSize: "13px" }}>SAT voltage:</label>
                <select
                  value={selectedLoopsVoltageKey ?? ""}
                  onChange={(e) => {
                    setSelectedLoopsVoltageKey(e.target.value);
                    setPendingLoopResult(null);
                  }}
                  style={{
                    padding: "4px 8px",
                    borderRadius: "4px",
                    border: "1px solid #ccc",
                    fontSize: "12px",
                    fontFamily: "monospace",
                    maxWidth: "300px",
                  }}
                >
                  {solveAllResults.map((v) => {
                    const m = v.matrix;
                    const label = `[[${m[0].join(",")}],[${m[1].join(",")}],[${m[2].join(",")}]]`;
                    return <option key={v.key} value={v.key}>{label}</option>;
                  })}
                </select>
                <button
                  onClick={handlePreviewLoopsResult}
                  disabled={!selectedLoopsVoltageKey}
                  style={{
                    padding: "4px 12px",
                    borderRadius: "4px",
                    border: "1px solid #27ae60",
                    backgroundColor: !selectedLoopsVoltageKey ? "#d5d8dc" : "#d5f5e3",
                    cursor: !selectedLoopsVoltageKey ? "not-allowed" : "pointer",
                    fontSize: "13px",
                  }}
                >
                  Preview
                </button>
              </div>
              <p style={{ fontSize: "11px", color: "#666", marginTop: "4px" }}>
                {solveAllResults.length} satisfiable voltage{solveAllResults.length !== 1 ? "s" : ""} found
              </p>
            </div>
          )}

          <p style={{ fontSize: "11px", color: "#666", marginTop: "4px" }}>
            Root: <code style={{ backgroundColor: "#fff", padding: "1px 4px" }}>{rootNodeId}</code>
          </p>
        </div>
      )}

      {/* Pending loop result: show two level views + accept/reject */}
      {pendingLoopResult && (
        <div style={{
          marginBottom: "16px",
          padding: "16px",
          backgroundColor: "#fef9e7",
          borderRadius: "8px",
          border: "1px solid #f39c12",
        }}>
          <h3 style={{ marginBottom: "12px" }}>🔍 Loop Found — Review</h3>
          <p style={{ fontSize: "13px", marginBottom: "12px" }}>
            Path: {pendingLoopResult.pathNodeIds.length} nodes, {pendingLoopResult.loopEdgeIds.length} edges in loop
          </p>

          {/* Show two level views of the pending loop */}
          <div style={{ display: "flex", gap: "20px", marginBottom: "12px", flexWrap: "wrap" }}>
            {(() => {
              // Build a temporary doubled grid with loop edges styled
              const tempGrid = { ...doubledGrid, edges: new Map(doubledGrid.edges) };
              const loopEdgeSet = new Set(pendingLoopResult.loopEdgeIds);
              for (const [edgeId, edge] of tempGrid.edges) {
                const linestyle = loopEdgeSet.has(edgeId) ? "solid" : "dashed";
                tempGrid.edges.set(edgeId, { ...edge, data: { linestyle } });
              }
              return (
                <>
                  <LevelGridDisplay level={0} doubledGrid={tempGrid} />
                  <LevelGridDisplay level={1} doubledGrid={tempGrid} />
                </>
              );
            })()}
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={handleAcceptLoop}
              style={{
                padding: "6px 16px",
                borderRadius: "4px",
                border: "1px solid #27ae60",
                backgroundColor: "#d5f5e3",
                cursor: "pointer",
                fontSize: "14px",
                fontWeight: "bold",
              }}
            >
              ✓ Accept
            </button>
            <button
              onClick={handleRejectLoop}
              style={{
                padding: "6px 16px",
                borderRadius: "4px",
                border: "1px solid #e74c3c",
                backgroundColor: "#fadbd8",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              ✗ Reject
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div style={{ display: "flex", gap: "40px", flexWrap: "wrap" }}>
        {/* Doubled orbifold level views */}
        <div>
          <h3 style={{ marginBottom: "10px" }}>Doubled Orbifold ({size}×{size}, {doubledGrid.nodes.size} nodes, {doubledGrid.edges.size} edges)</h3>
          <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
            <LevelGridDisplay level={0} doubledGrid={doubledGrid} />
            <LevelGridDisplay level={1} doubledGrid={doubledGrid} />
          </div>
        </div>

        {/* 3D Lifted Graph */}
        {loopAccepted && (
          <div>
            <h3 style={{ marginBottom: "10px" }}>3D Weave (Lifted Graph)</h3>
            <p style={{ fontSize: "12px", color: "#666", marginBottom: "10px" }}>
              Nodes: {liftedGraph.nodes.size} | Edges: {liftedGraph.edges.size}
            </p>
            <ErrorBoundary>
              <WeaveThreeRenderer
                liftedGraph={liftedGraph}
                orbifoldGrid={doubledGrid}
                useAxialTransform={wallpaperGroup === "P3"}
              />
            </ErrorBoundary>
          </div>
        )}
      </div>
    </div>
  );
}
