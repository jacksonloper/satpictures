import { useState, useCallback, useRef, useEffect } from "react";
import type { ColorData, EdgeStyleData } from "../createOrbifolds";
import type { OrbifoldGrid, OrbifoldNodeId } from "../orbifoldbasics";
import LoopFinderWorker from "../loop-finder.worker?worker";
import type { LoopFinderRequest, LoopFinderResponse, VoltageMatrix } from "../loop-finder.worker";

export interface LoopResult {
  pathNodeIds: string[];
  loopEdgeIds: string[];
  pathEdgeIds?: string[];
}

export interface SolveAllResult {
  key: string;
  matrix: VoltageMatrix;
  pathNodeIds: string[];
  loopEdgeIds: string[];
  pathEdgeIds?: string[];
}

interface UseLoopFinderProps {
  orbifoldGrid: OrbifoldGrid<ColorData, EdgeStyleData>;
  rootNodeId: OrbifoldNodeId | null;
  onError: (message: string) => void;
}

function buildWorkerEdgeData(grid: OrbifoldGrid<ColorData, EdgeStyleData>) {
  const edgesData: Array<{
    edgeId: string;
    endpoints: [string, string];
    halfEdgeVoltages: Record<string, readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]]>;
  }> = [];
  for (const [edgeId, edge] of grid.edges) {
    const endpoints = Array.from(edge.halfEdges.keys());
    const halfEdgeVoltages: Record<string, readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]]> = {};
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
}

function buildAdjacencyRecord(grid: OrbifoldGrid<ColorData, EdgeStyleData>, nodeIds: string[]) {
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
}

function resolveEffectiveRoot(
  grid: OrbifoldGrid<ColorData, EdgeStyleData>,
  rootNodeId: OrbifoldNodeId,
  nodeIds: string[],
  blackNodeIds: string[]
): string | null {
  const blackSet = new Set(blackNodeIds);
  let effectiveRootNodeId: string = rootNodeId;
  
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
      newRoot = nodeIds.find(id => !blackSet.has(id)) ?? null;
    }
    if (!newRoot) return null;
    effectiveRootNodeId = newRoot;
  }
  return effectiveRootNodeId;
}

function getBlackNodeIds(grid: OrbifoldGrid<ColorData, EdgeStyleData>): string[] {
  const blackNodeIds: string[] = [];
  for (const [, node] of grid.nodes) {
    if (node.data?.color === "black") {
      blackNodeIds.push(node.id);
    }
  }
  return blackNodeIds;
}

export function useLoopFinder({ orbifoldGrid, rootNodeId, onError }: UseLoopFinderProps) {
  // Single loop finder state
  const [showLoopFinder, setShowLoopFinder] = useState(false);
  const [maxLength, setMaxLength] = useState(10);
  const [minLength, setMinLength] = useState(0);
  const [solvingLoop, setSolvingLoop] = useState(false);
  const [computingVoltages, setComputingVoltages] = useState(false);
  const [loopSatStats, setLoopSatStats] = useState<{ numVars: number; numClauses: number } | null>(null);
  const [reachableVoltages, setReachableVoltages] = useState<Array<{ key: string; matrix: VoltageMatrix }>>([]);
  const [selectedTargetVoltageKey, setSelectedTargetVoltageKey] = useState<string | null>(null);
  const [pendingLoopResult, setPendingLoopResult] = useState<LoopResult | null>(null);
  const loopWorkerRef = useRef<Worker | null>(null);

  // Multiple loops finder state
  const [showLoopsFinder, setShowLoopsFinder] = useState(false);
  const [maxLengthLoops, setMaxLengthLoops] = useState(10);
  const [minLengthLoops, setMinLengthLoops] = useState(0);
  const [solvingAllLoops, setSolvingAllLoops] = useState(false);
  const [solveAllProgress, setSolveAllProgress] = useState<{ current: number; total: number } | null>(null);
  const [solveAllResults, setSolveAllResults] = useState<SolveAllResult[] | null>(null);
  const [selectedLoopsVoltageKey, setSelectedLoopsVoltageKey] = useState<string | null>(null);
  const loopsWorkerRef = useRef<Worker | null>(null);

  const resetLoopsFinderState = useCallback(() => {
    setSolvingAllLoops(false);
    setSolveAllProgress(null);
    setSolveAllResults(null);
    setSelectedLoopsVoltageKey(null);
  }, []);

  const resetSingleLoopFinderState = useCallback(() => {
    setSolvingLoop(false);
    setComputingVoltages(false);
    setLoopSatStats(null);
    setReachableVoltages([]);
    setSelectedTargetVoltageKey(null);
    setPendingLoopResult(null);
  }, []);

  const resetAllLoopState = useCallback(() => {
    setShowLoopFinder(false);
    resetSingleLoopFinderState();
    setShowLoopsFinder(false);
    resetLoopsFinderState();
  }, [resetSingleLoopFinderState, resetLoopsFinderState]);

  const handleToggleLoopFinder = useCallback(() => {
    setShowLoopFinder(prev => !prev);
  }, []);

  const handleToggleLoopsFinder = useCallback(() => {
    setShowLoopsFinder(prev => !prev);
  }, []);

  const handleCancelLoopFind = useCallback(() => {
    if (loopWorkerRef.current) {
      loopWorkerRef.current.terminate();
      loopWorkerRef.current = null;
      setSolvingLoop(false);
      setComputingVoltages(false);
      onError("Loop search cancelled");
    }
  }, [onError]);

  const handleCancelLoopsFind = useCallback(() => {
    if (loopsWorkerRef.current) {
      loopsWorkerRef.current.terminate();
      loopsWorkerRef.current = null;
      resetLoopsFinderState();
      onError("Loops search cancelled");
    }
  }, [onError, resetLoopsFinderState]);

  const handleComputeVoltages = useCallback(() => {
    if (!rootNodeId) {
      onError("Please set a root node first (use the 📌 Root tool)");
      return;
    }

    setComputingVoltages(true);
    setReachableVoltages([]);
    setSelectedTargetVoltageKey(null);
    setLoopSatStats(null);
    setPendingLoopResult(null);

    const grid = orbifoldGrid;
    const nodeIds = Array.from(grid.nodes.keys());
    const blackNodeIds = getBlackNodeIds(grid);

    if (blackNodeIds.length === nodeIds.length) {
      onError("No non-black nodes available for the loop");
      setComputingVoltages(false);
      return;
    }

    const effectiveRootNodeId = resolveEffectiveRoot(grid, rootNodeId, nodeIds, blackNodeIds);
    if (!effectiveRootNodeId) {
      onError("No non-black nodes available for the loop");
      setComputingVoltages(false);
      return;
    }

    const adj = buildAdjacencyRecord(grid, nodeIds);
    const edgesData = buildWorkerEdgeData(grid);

    const request: LoopFinderRequest = {
      mode: "computeVoltages",
      maxLength,
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

      if (response.success && response.reachableVoltages) {
        setReachableVoltages(response.reachableVoltages);
        if (response.reachableVoltages.length > 0) {
          setSelectedTargetVoltageKey(response.reachableVoltages[0].key);
        }
        if (response.reachableVoltages.length === 0) {
          onError("No reachable voltages found for this max length");
        }
      } else {
        onError(response.error || "Voltage computation failed");
      }

      setComputingVoltages(false);
      loopWorkerRef.current = null;
    };

    worker.onerror = (error) => {
      onError(`Worker error: ${error.message}`);
      setComputingVoltages(false);
      loopWorkerRef.current = null;
    };

    worker.postMessage(request);
  }, [maxLength, rootNodeId, orbifoldGrid, onError]);

  const handleSolveLoop = useCallback(() => {
    if (!rootNodeId) {
      onError("Please set a root node first (use the 📌 Root tool)");
      return;
    }
    if (!selectedTargetVoltageKey || reachableVoltages.length === 0) {
      onError("Please compute voltages and select a target voltage first");
      return;
    }

    setSolvingLoop(true);
    setLoopSatStats(null);
    setPendingLoopResult(null);

    const grid = orbifoldGrid;
    const nodeIds = Array.from(grid.nodes.keys());
    const blackNodeIds = getBlackNodeIds(grid);
    const blackSet = new Set(blackNodeIds);

    if (blackNodeIds.length === nodeIds.length) {
      onError("No non-black nodes available for the loop");
      setSolvingLoop(false);
      return;
    }

    const effectiveRootNodeId = resolveEffectiveRoot(grid, rootNodeId, nodeIds, blackNodeIds);
    if (!effectiveRootNodeId) {
      onError("No non-black nodes available for the loop");
      setSolvingLoop(false);
      return;
    }

    if (blackSet.has(effectiveRootNodeId)) {
      onError("Root node must not be black-colored");
      setSolvingLoop(false);
      return;
    }

    const adj = buildAdjacencyRecord(grid, nodeIds);
    const edgesData = buildWorkerEdgeData(grid);

    const request: LoopFinderRequest = {
      mode: "solve",
      maxLength,
      minLength,
      rootNodeId: effectiveRootNodeId,
      nodeIds,
      adjacency: adj,
      edges: edgesData,
      blackNodeIds,
      targetVoltageKey: selectedTargetVoltageKey,
      reachableVoltages,
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
        setPendingLoopResult({
          pathNodeIds: response.pathNodeIds,
          loopEdgeIds: response.loopEdgeIds,
          pathEdgeIds: response.pathEdgeIds,
        });
      } else {
        onError(response.error || "Loop search failed");
      }

      setSolvingLoop(false);
      loopWorkerRef.current = null;
    };

    worker.onerror = (error) => {
      onError(`Worker error: ${error.message}`);
      setSolvingLoop(false);
      loopWorkerRef.current = null;
    };

    worker.postMessage(request);
  }, [maxLength, minLength, rootNodeId, orbifoldGrid, selectedTargetVoltageKey, reachableVoltages, onError]);

  const handleFindAllLoops = useCallback(() => {
    if (!rootNodeId) {
      onError("Please set a root node first (use the 📌 Root tool)");
      return;
    }

    resetLoopsFinderState();
    setSolvingAllLoops(true);
    setPendingLoopResult(null);

    const grid = orbifoldGrid;
    const nodeIds = Array.from(grid.nodes.keys());
    const blackNodeIds = getBlackNodeIds(grid);

    if (blackNodeIds.length === nodeIds.length) {
      onError("No non-black nodes available for loops");
      setSolvingAllLoops(false);
      return;
    }

    const effectiveRootNodeId = resolveEffectiveRoot(grid, rootNodeId, nodeIds, blackNodeIds);
    if (!effectiveRootNodeId) {
      onError("No non-black nodes available for loops");
      setSolvingAllLoops(false);
      return;
    }

    const adj = buildAdjacencyRecord(grid, nodeIds);
    const edgesData = buildWorkerEdgeData(grid);

    const request: LoopFinderRequest = {
      mode: "solveAll",
      maxLength: maxLengthLoops,
      minLength: minLengthLoops,
      rootNodeId: effectiveRootNodeId,
      nodeIds,
      adjacency: adj,
      edges: edgesData,
      blackNodeIds,
    };

    const worker = new LoopFinderWorker();
    loopsWorkerRef.current = worker;

    worker.onmessage = (event: MessageEvent<LoopFinderResponse>) => {
      const response = event.data;

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
          onError("No satisfiable loops found for any voltage");
        }
      } else {
        onError(response.error || "Loops search failed");
      }

      setSolvingAllLoops(false);
      setSolveAllProgress(null);
      loopsWorkerRef.current = null;
    };

    worker.onerror = (error) => {
      onError(`Worker error: ${error.message}`);
      setSolvingAllLoops(false);
      setSolveAllProgress(null);
      loopsWorkerRef.current = null;
    };

    worker.postMessage(request);
  }, [maxLengthLoops, minLengthLoops, rootNodeId, orbifoldGrid, onError, resetLoopsFinderState]);

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

  const handleDismissLoops = useCallback(() => {
    resetLoopsFinderState();
    setPendingLoopResult(null);
  }, [resetLoopsFinderState]);

  const handleRejectLoop = useCallback(() => {
    setPendingLoopResult(null);
  }, []);

  // Cleanup workers on unmount
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

  return {
    // Single loop finder
    showLoopFinder,
    maxLength,
    setMaxLength,
    minLength,
    setMinLength,
    solvingLoop,
    computingVoltages,
    loopSatStats,
    reachableVoltages,
    setReachableVoltages,
    selectedTargetVoltageKey,
    setSelectedTargetVoltageKey,
    pendingLoopResult,
    setPendingLoopResult,
    handleToggleLoopFinder,
    handleCancelLoopFind,
    handleComputeVoltages,
    handleSolveLoop,

    // Multiple loops finder
    showLoopsFinder,
    maxLengthLoops,
    setMaxLengthLoops,
    minLengthLoops,
    setMinLengthLoops,
    solvingAllLoops,
    solveAllProgress,
    solveAllResults,
    selectedLoopsVoltageKey,
    setSelectedLoopsVoltageKey,
    handleToggleLoopsFinder,
    handleCancelLoopsFind,
    handleFindAllLoops,
    handlePreviewLoopsResult,
    handleDismissLoops,

    // Common
    handleRejectLoop,
    resetLoopsFinderState,
    resetAllLoopState,
  };
}
