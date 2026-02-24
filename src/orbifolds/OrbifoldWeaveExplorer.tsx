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
const DEFAULT_EXPANSION = 10;

/**
 * Render two 2D views (level 0 and level 1) of the doubled orbifold,
 * showing only nodes (no edges) with their step number in the loop path.
 * Nodes not in the loop are shown as small grey dots.
 */
function DoubledOrbifoldLoopDisplay({
  doubledGrid,
  pathNodeIds,
  onNodeClick,
  highlightedNodeId,
}: {
  doubledGrid: OrbifoldGrid<ColorData, EdgeStyleData>;
  pathNodeIds: string[];
  onNodeClick?: (nodeId: string) => void;
  highlightedNodeId?: string | null;
}) {
  // Build a map from nodeId → step number (1-based)
  const nodeStep = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < pathNodeIds.length; i++) {
      // If a node appears more than once (start == end), keep the first
      if (!map.has(pathNodeIds[i])) {
        map.set(pathNodeIds[i], i + 1);
      }
    }
    return map;
  }, [pathNodeIds]);

  // Collect nodes per level
  const levelNodes = useMemo(() => {
    const byLevel: [typeof nodes0, typeof nodes1] = [[], []];
    type NodeInfo = { id: string; x: number; y: number; step: number | null };
    const nodes0: NodeInfo[] = [];
    const nodes1: NodeInfo[] = [];
    byLevel[0] = nodes0;
    byLevel[1] = nodes1;
    for (const [nodeId, node] of doubledGrid.nodes) {
      const level = getLevelFromNodeId(nodeId);
      if (level === undefined) continue;
      const step = nodeStep.get(nodeId) ?? null;
      const entry = { id: nodeId, x: node.coord[0], y: node.coord[1], step };
      byLevel[level].push(entry);
    }
    return byLevel;
  }, [doubledGrid, nodeStep]);

  const cellSize = 36;
  const padding = 24;

  return (
    <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
      {([0, 1] as const).map((level) => {
        const nodes = levelNodes[level];
        if (nodes.length === 0) return null;
        const xs = nodes.map(n => n.x);
        const ys = nodes.map(n => n.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const rangeX = maxX - minX || 1;
        const rangeY = maxY - minY || 1;
        const svgW = rangeX * cellSize / 2 + 2 * padding + 30;
        const svgH = rangeY * cellSize / 2 + 2 * padding + 30;

        const toSvgX = (c: number) => ((c - minX) * cellSize / 2) + padding + 15;
        const toSvgY = (c: number) => ((c - minY) * cellSize / 2) + padding + 15;

        return (
          <div key={level}>
            <h4 style={{ marginBottom: "4px", fontSize: "13px" }}>
              Level {level} ({level === 0 ? "Low" : "High"})
            </h4>
            <svg
              width={Math.min(svgW, 350)}
              height={Math.min(svgH, 350)}
              viewBox={`0 0 ${svgW} ${svgH}`}
              style={{
                border: "1px solid #ccc",
                borderRadius: "4px",
                backgroundColor: level === 0 ? "#f0fafa" : "#fef8f0",
              }}
            >
              {nodes.map((nd) => {
                const cx = toSvgX(nd.x);
                const cy = toSvgY(nd.y);
                if (nd.step !== null) {
                  // Node is in the loop — draw a filled circle with step number
                  const fill = level === 0 ? "#00838f" : "#ff8c00";
                  const isHighlighted = nd.id === highlightedNodeId;
                  return (
                    <g
                      key={nd.id}
                      onClick={() => onNodeClick?.(nd.id)}
                      style={{ cursor: onNodeClick ? "pointer" : undefined }}
                    >
                      {isHighlighted && (
                        <circle cx={cx} cy={cy} r={16} fill="none" stroke="#FFD700" strokeWidth={3} />
                      )}
                      <circle cx={cx} cy={cy} r={11} fill={fill} stroke={isHighlighted ? "#FFD700" : "#333"} strokeWidth={isHighlighted ? 2 : 1} />
                      <text
                        x={cx}
                        y={cy}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize="9"
                        fontWeight="bold"
                        fill="#fff"
                      >
                        {nd.step}
                      </text>
                    </g>
                  );
                } else {
                  // Node not in loop — small grey dot
                  return (
                    <circle
                      key={nd.id}
                      cx={cx}
                      cy={cy}
                      r={3}
                      fill="#ccc"
                      stroke="#999"
                      strokeWidth={0.5}
                    />
                  );
                }
              })}
            </svg>
          </div>
        );
      })}
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
  const [maxLength, setMaxLength] = useState(10);
  const [minLength, setMinLength] = useState(0);
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

  const minSize = wallpaperGroup === "P4g" || wallpaperGroup === "P6" ? 4 : 2;

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
    const nextSize = (nextGroup === "P4g" || nextGroup === "P6") && size < 4 ? 4 : size;
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
            <option value="pmm">pmm (mirrors)</option>
            <option value="P3">P3 (120° rotation - axial)</option>
            <option value="P4">P4 (90° rotation)</option>
            <option value="P4g">P4g (90° rotation + diagonal flip)</option>
            <option value="P6">P6 (120° rotation + diagonal flip)</option>
          </select>
        </div>

        <ValidatedInput value={size} onChange={handleSizeChange} min={minSize} max={10} label="Size (n)"
          extraValidate={wallpaperGroup === "P2" ? (n) => n % 2 !== 0 ? "must be even" : null : undefined}
        />
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
            <ValidatedInput
              value={maxLength}
              onChange={(v) => {
                setMaxLength(v);
                setReachableVoltages([]);
                setSelectedTargetVoltageKey(null);
                if (minLength > v) setMinLength(v);
              }}
              min={2}
              max={9999}
              label="Max steps"
              disabled={solvingLoop || computingVoltages}
            />
            <ValidatedInput
              value={minLength}
              onChange={setMinLength}
              min={0}
              max={maxLength}
              label="Min steps"
              disabled={solvingLoop || computingVoltages}
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
            <ValidatedInput
              value={maxLengthLoops}
              onChange={(v) => {
                setMaxLengthLoops(v);
                resetLoopsFinderState();
                if (minLengthLoops > v) setMinLengthLoops(v);
              }}
              min={2}
              max={9999}
              label="Max steps"
              disabled={solvingAllLoops}
            />
            <ValidatedInput
              value={minLengthLoops}
              onChange={(v) => {
                setMinLengthLoops(v);
                resetLoopsFinderState();
              }}
              min={0}
              max={maxLengthLoops}
              label="Min steps"
              disabled={solvingAllLoops}
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

      {/* Pending loop result: accept/reject with 2D loop display */}
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

          <DoubledOrbifoldLoopDisplay
            doubledGrid={doubledGrid}
            pathNodeIds={pendingLoopResult.pathNodeIds}
          />

          <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
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

      {/* Accepted loop: 2D cross-reference + 3D lifted graph */}
      {loopAccepted && (
        <div>
          <h3 style={{ marginBottom: "10px" }}>Loop Path (Cross Reference)</h3>
          <DoubledOrbifoldLoopDisplay
            doubledGrid={doubledGrid}
            pathNodeIds={acceptedPathNodeIds}
            onNodeClick={(nodeId) => setHighlightedNodeId(prev => prev === nodeId ? null : nodeId)}
            highlightedNodeId={highlightedNodeId}
          />

          <h3 style={{ marginTop: "20px", marginBottom: "10px" }}>3D Weave (Lifted Graph)</h3>
          <p style={{ fontSize: "12px", color: "#666", marginBottom: "10px" }}>
            Nodes: {liftedGraph.nodes.size} | Edges: {liftedGraph.edges.size}
          </p>
          <div style={{ display: "flex", gap: "20px", marginBottom: "10px", fontSize: "13px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              Level height:
              <input
                type="range"
                min={0}
                max={6}
                step={0.1}
                value={levelHeight}
                onChange={(e) => setLevelHeight(parseFloat(e.target.value))}
                style={{ width: "120px" }}
              />
              <span style={{ minWidth: "32px" }}>{levelHeight.toFixed(1)}</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              Tube radius:
              <input
                type="range"
                min={0}
                max={0.5}
                step={0.01}
                value={tubeRadius}
                onChange={(e) => setTubeRadius(parseFloat(e.target.value))}
                style={{ width: "120px" }}
              />
              <span style={{ minWidth: "32px" }}>{tubeRadius.toFixed(2)}</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              Bead speed:
              <input
                type="range"
                min={0}
                max={5}
                step={0.1}
                value={beadSpeed}
                onChange={(e) => setBeadSpeed(parseFloat(e.target.value))}
                style={{ width: "120px" }}
              />
              <span style={{ minWidth: "32px" }}>{beadSpeed.toFixed(1)}</span>
            </label>
          </div>
          <ErrorBoundary>
            <WeaveThreeRenderer
              liftedGraph={liftedGraph}
              orbifoldGrid={doubledGrid}
              useAxialTransform={wallpaperGroup === "P3" || wallpaperGroup === "P6"}
              highlightedOrbifoldNodeId={highlightedNodeId}
              levelSpacing={levelHeight}
              tubeRadius={tubeRadius}
              beadSpeed={beadSpeed}
            />
          </ErrorBoundary>
        </div>
      )}
    </div>
  );
}
