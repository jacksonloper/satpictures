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
  type LoopStep,
} from "./createOrbifolds";
import {
  constructLiftedGraphFromOrbifold,
  processAllNonInteriorOnce,
  buildAdjacency,
  type OrbifoldGrid,
  type OrbifoldNodeId,
} from "./orbifoldbasics";
import { doubleOrbifold } from "./doubleOrbifold";
import LoopFinderWorker from "./loop-finder.worker?worker";
import type { LoopFinderRequest, LoopFinderResponse, VoltageMatrix } from "./loop-finder.worker";
import {
  WeaveControlsPanel,
  WeaveLoopFinderPanel,
  WeaveLoopsFinderPanel,
  PendingLoopPanel,
  AcceptedLoopPanel,
  type SolveAllResult,
  type PendingLoopResult,
} from "./components";
import "../App.css";

// Constants
const DEFAULT_SIZE = 3;
const DEFAULT_EXPANSION = 10;

/**
 * Main Orbifold Weaves Explorer component.
 */
export function OrbifoldWeaveExplorer() {
  const [wallpaperGroup, setWallpaperGroup] = useState<WallpaperGroupType>("P1");
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [expansion, setExpansion] = useState(DEFAULT_EXPANSION);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Loop finder state
  const [maxLength, setMaxLength] = useState(10);
  const [minLength, setMinLength] = useState(0);
  const [showLoopFinder, setShowLoopFinder] = useState(false);
  const [solvingLoop, setSolvingLoop] = useState(false);
  const [computingVoltages, setComputingVoltages] = useState(false);
  const [reachableVoltages, setReachableVoltages] = useState<Array<{ key: string; matrix: VoltageMatrix }>>([]);
  const [selectedTargetVoltageKey, setSelectedTargetVoltageKey] = useState<string | null>(null);
  const [pendingLoopResult, setPendingLoopResult] = useState<PendingLoopResult | null>(null);
  const loopWorkerRef = useRef<Worker | null>(null);

  // Find Loops (plural) state
  const [showLoopsFinder, setShowLoopsFinder] = useState(false);
  const [solvingAllLoops, setSolvingAllLoops] = useState(false);
  const [solveAllProgress, setSolveAllProgress] = useState<{ current: number; total: number } | null>(null);
  const [solveAllResults, setSolveAllResults] = useState<SolveAllResult[] | null>(null);
  const [selectedLoopsVoltageKey, setSelectedLoopsVoltageKey] = useState<string | null>(null);
  const [maxLengthLoops, setMaxLengthLoops] = useState(10);
  const [minLengthLoops, setMinLengthLoops] = useState(0);
  const loopsWorkerRef = useRef<Worker | null>(null);

  // Accepted loop state
  const [loopAccepted, setLoopAccepted] = useState(false);
  const [acceptedPathNodeIds, setAcceptedPathNodeIds] = useState<string[]>([]);

  // Highlight state: which orbifold node is highlighted (clicked in 2D view)
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null);

  // 3D rendering controls
  const [levelHeight, setLevelHeight] = useState(3);
  const [tubeRadius, setTubeRadius] = useState(0.25);
  const [beadSpeed, setBeadSpeed] = useState(1.0);
  const [useAxialTransform, setUseAxialTransform] = useState(false);

  const minSize = wallpaperGroup === "P4g" || wallpaperGroup === "P6" || wallpaperGroup === "cmm" ? 4 : 2;

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
    setAcceptedPathNodeIds([]);
    resetLoopsFinderState();
    setErrorMessage(null);
  }, [resetLoopsFinderState]);

  const handleWallpaperGroupChange = (nextGroup: WallpaperGroupType) => {
    const nextSize = (nextGroup === "P4g" || nextGroup === "P6" || nextGroup === "cmm") && size < 4 ? 4 : size;
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
    setErrorMessage(null);
    setComputingVoltages(true);
    setReachableVoltages([]);
    setSelectedTargetVoltageKey(null);
    setPendingLoopResult(null);
    setLoopAccepted(false);
    setAcceptedPathNodeIds([]);

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
  }, [maxLength, rootNodeId, undoubledGrid, buildAdjRecord, buildWorkerEdgeData]);

  // Phase 2: Solve loop on *doubled* orbifold
  const handleSolveLoop = useCallback(() => {
    if (!selectedTargetVoltageKey || reachableVoltages.length === 0) {
      setErrorMessage("Please compute voltages and select a target voltage first");
      return;
    }

    setErrorMessage(null);
    setSolvingLoop(true);
    setPendingLoopResult(null);
    setLoopAccepted(false);
    setAcceptedPathNodeIds([]);

    const grid = doubledGrid;
    const nodeIds = Array.from(grid.nodes.keys());
    const adj = buildAdjRecord(grid);
    const edgesData = buildWorkerEdgeData(grid);

    // Solve on doubled orbifold with user-specified max length
    const request: LoopFinderRequest = {
      mode: "solve",
      maxLength,
      minLength,
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
  }, [maxLength, minLength, doubledGrid, doubledRootNodeId, selectedTargetVoltageKey, reachableVoltages, buildAdjRecord, buildWorkerEdgeData]);

  // Find all loops on doubled orbifold
  const handleFindAllLoops = useCallback(() => {
    setErrorMessage(null);
    resetLoopsFinderState();
    setSolvingAllLoops(true);
    setPendingLoopResult(null);
    setLoopAccepted(false);
    setAcceptedPathNodeIds([]);

    // Phase 1: compute voltages on undoubled
    const undGrid = undoubledGrid;
    const undNodeIds = Array.from(undGrid.nodes.keys());
    const undAdj = buildAdjRecord(undGrid);
    const undEdgesData = buildWorkerEdgeData(undGrid);

    const bfsReq: LoopFinderRequest = {
      mode: "computeVoltages",
      maxLength: maxLengthLoops,
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
        maxLength: maxLengthLoops,
        minLength: minLengthLoops,
        rootNodeId: doubledRootNodeId,
        nodeIds: dNodeIds,
        adjacency: dAdj,
        edges: dEdgesData,
      };

      // The worker's solveAll does its own BFS internally on the doubled grid.
      // This finds the same voltages since voltages only act on 2D positions.

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
  }, [maxLengthLoops, minLengthLoops, rootNodeId, undoubledGrid, doubledGrid, doubledRootNodeId, buildAdjRecord, buildWorkerEdgeData, resetLoopsFinderState]);

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

  // Accept loop: style edges using pathEdgeIds, populate loopSteps
  const handleAcceptLoop = useCallback(() => {
    if (!pendingLoopResult) return;

    const pathNodeIds = pendingLoopResult.pathNodeIds;
    const pathEdgeIds = pendingLoopResult.pathEdgeIds ?? [];

    // Build loopSteps per edge: for each step t, pathEdgeIds[t] is the specific
    // orbifold edge used from pathNodeIds[t] to pathNodeIds[t+1]
    const edgeLoopSteps = new Map<string, LoopStep[]>();
    for (let t = 0; t < pathEdgeIds.length; t++) {
      const edgeId = pathEdgeIds[t];
      if (!edgeId) continue;
      if (!edgeLoopSteps.has(edgeId)) edgeLoopSteps.set(edgeId, []);
      edgeLoopSteps.get(edgeId)!.push({ startStep: t, startNode: pathNodeIds[t] });
    }

    // Build loopStep per node
    const nodeLoopStep = new Map<string, number>();
    for (let i = 0; i < pathNodeIds.length; i++) {
      if (!nodeLoopStep.has(pathNodeIds[i])) {
        nodeLoopStep.set(pathNodeIds[i], i);
      }
    }

    // Validate: each orbifold node should have exactly 2 solid edges
    {
      const solidDeg = new Map<string, number>();
      for (const [edgeId] of edgeLoopSteps) {
        const edge = doubledGrid.edges.get(edgeId);
        if (!edge) continue;
        for (const nodeId of edge.halfEdges.keys()) {
          solidDeg.set(nodeId, (solidDeg.get(nodeId) ?? 0) + 1);
        }
      }
      for (const [nodeId, deg] of solidDeg) {
        if (deg !== 2) {
          console.warn(`[Weave] Orbifold node ${nodeId} has ${deg} solid edges (expected 2). pathEdgeIds:`, pathEdgeIds);
        }
      }
    }

    setDoubledGrid((prev) => {
      const newEdges = new Map(prev.edges);
      for (const [edgeId, edge] of newEdges) {
        const steps = edgeLoopSteps.get(edgeId);
        const linestyle = steps && steps.length > 0 ? "solid" : "dashed";
        newEdges.set(edgeId, { ...edge, data: { linestyle, loopSteps: steps ?? [] } });
      }
      const newNodes = new Map(prev.nodes);
      for (const [nodeId, node] of newNodes) {
        const step = nodeLoopStep.get(nodeId);
        newNodes.set(nodeId, { ...node, data: { ...(node.data ?? { color: "white" as const }), loopStep: step ?? null } });
      }
      return { nodes: newNodes, edges: newEdges, adjacency: prev.adjacency };
    });

    setAcceptedPathNodeIds(pathNodeIds);
    setLoopAccepted(true);
    setPendingLoopResult(null);
    resetLoopsFinderState();
  }, [pendingLoopResult, doubledGrid, resetLoopsFinderState]);

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
      <WeaveControlsPanel
        wallpaperGroup={wallpaperGroup}
        size={size}
        expansion={expansion}
        minSize={minSize}
        useAxialTransform={useAxialTransform}
        onWallpaperGroupChange={handleWallpaperGroupChange}
        onSizeChange={handleSizeChange}
        onExpansionChange={setExpansion}
        onUseAxialTransformChange={setUseAxialTransform}
      />

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
        <WeaveLoopFinderPanel
          maxLength={maxLength}
          minLength={minLength}
          solvingLoop={solvingLoop}
          computingVoltages={computingVoltages}
          reachableVoltages={reachableVoltages}
          selectedTargetVoltageKey={selectedTargetVoltageKey}
          rootNodeId={rootNodeId}
          doubledRootNodeId={doubledRootNodeId}
          onMaxLengthChange={(v) => {
            setMaxLength(v);
            setReachableVoltages([]);
            setSelectedTargetVoltageKey(null);
            if (minLength > v) setMinLength(v);
          }}
          onMinLengthChange={setMinLength}
          onTargetVoltageChange={setSelectedTargetVoltageKey}
          onComputeVoltages={handleComputeVoltages}
          onSolveLoop={handleSolveLoop}
          onCancel={handleCancelLoopFind}
        />
      )}

      {/* Find Loops Panel */}
      {showLoopsFinder && (
        <WeaveLoopsFinderPanel
          maxLengthLoops={maxLengthLoops}
          minLengthLoops={minLengthLoops}
          solvingAllLoops={solvingAllLoops}
          solveAllProgress={solveAllProgress}
          solveAllResults={solveAllResults}
          selectedLoopsVoltageKey={selectedLoopsVoltageKey}
          rootNodeId={rootNodeId}
          onMaxLengthChange={(v) => {
            setMaxLengthLoops(v);
            resetLoopsFinderState();
            if (minLengthLoops > v) setMinLengthLoops(v);
          }}
          onMinLengthChange={(v) => {
            setMinLengthLoops(v);
            resetLoopsFinderState();
          }}
          onFindAllLoops={handleFindAllLoops}
          onCancel={handleCancelLoopsFind}
          onVoltageKeyChange={(key) => {
            setSelectedLoopsVoltageKey(key);
            setPendingLoopResult(null);
          }}
          onPreview={handlePreviewLoopsResult}
        />
      )}

      {/* Pending loop result: accept/reject with 2D loop display */}
      {pendingLoopResult && (
        <PendingLoopPanel
          pendingLoopResult={pendingLoopResult}
          doubledGrid={doubledGrid}
          onAccept={handleAcceptLoop}
          onReject={handleRejectLoop}
        />
      )}

      {/* Accepted loop: 2D cross-reference + 3D lifted graph */}
      {loopAccepted && (
        <AcceptedLoopPanel
          doubledGrid={doubledGrid}
          acceptedPathNodeIds={acceptedPathNodeIds}
          highlightedNodeId={highlightedNodeId}
          onNodeClick={(nodeId) => setHighlightedNodeId(prev => prev === nodeId ? null : nodeId)}
          liftedGraph={liftedGraph}
          useAxialTransform={useAxialTransform}
          levelHeight={levelHeight}
          tubeRadius={tubeRadius}
          beadSpeed={beadSpeed}
          onLevelHeightChange={setLevelHeight}
          onTubeRadiusChange={setTubeRadius}
          onBeadSpeedChange={setBeadSpeed}
        />
      )}
    </div>
  );
}
