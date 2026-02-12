/**
 * WallpaperMazeExplorerV2 - Rewritten wallpaper maze explorer using new abstractions
 *
 * This explorer uses the Manifold, SubManifold, and OrbifoldLift abstractions
 * to provide a cleaner architecture with three main UI components:
 * 1. Sketchpad - for blocking nodes and setting root
 * 2. SubManifold Viewer - shows the spanning tree with all edges
 * 3. Orbifold Lift Viewer - shows the lifted graph
 */

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import WallpaperMazeWorker from "../../problem/wallpaper-maze.worker?worker";
import type {
  WallpaperMazeRequest,
  WallpaperMazeResponse,
} from "../../problem/wallpaper-maze.worker";
import type { WallpaperGroupName } from "../WallpaperGroups";

import {
  createManifold,
  getManifoldTypes,
  SubManifoldImpl,
} from "../manifold";
import type { ManifoldNode, ManifoldType, Manifold } from "../manifold/types";

import { getCompatibleLifts } from "../orbifold-lift";
import type { OrbifoldLift, OrbifoldLiftGraph, LiftedNode } from "../orbifold-lift";

import { Sketchpad } from "../components/Sketchpad";
import { SubManifoldViewer } from "../components/SubManifoldViewer";
import { OrbifoldLiftViewer } from "../components/OrbifoldLiftViewer";

import "../../App.css";

// Convert ManifoldType to WallpaperGroupName for the worker
function manifoldTypeToWallpaperGroup(type: ManifoldType): WallpaperGroupName {
  switch (type) {
    case "P1":
      return "P1";
    case "P2":
      return "P2";
    case "P3":
      return "P3";
    case "PGG":
      return "pgg";
  }
}

// Constants
const DEFAULT_LENGTH = 4;
const DEFAULT_MULTIPLIER = 2;
const CELL_SIZE = 40;

// Tool types
type SketchpadTool = "rootSetter" | "neighborhoodViewer" | "blockSetter";

/**
 * Frozen solution state - stores all settings at solve time
 * This is completely disconnected from the sketchpad settings after solve
 */
interface FrozenSolution {
  /** The manifold type used for this solution */
  manifoldType: ManifoldType;
  /** The size used for this solution */
  size: number;
  /** The multiplier used for this solution */
  multiplier: number;
  /** The lift type used for this solution */
  liftType: string;
  /** The root node used for this solution */
  root: ManifoldNode;
  /** The blocked nodes at solve time */
  blockedNodes: Set<string>;
  /** The parent map from the SAT solver */
  parentMap: Map<string, ManifoldNode | null>;
}

/**
 * Main explorer component
 */
export function WallpaperMazeExplorerV2() {
  // Sketchpad settings (editable by user)
  const [manifoldType, setManifoldType] = useState<ManifoldType>("P1");
  const [size, setSize] = useState(DEFAULT_LENGTH);
  const [multiplier, setMultiplier] = useState(DEFAULT_MULTIPLIER);
  const [blockedNodes, setBlockedNodes] = useState<Set<string>>(new Set());
  const [root, setRoot] = useState<ManifoldNode>({ row: 0, col: 0 });
  const [selectedLiftType, setSelectedLiftType] = useState<string | null>(null);

  // Tool state
  const [activeTool, setActiveTool] = useState<SketchpadTool>("rootSetter");
  const [sketchpadSelectedNode, setSketchpadSelectedNode] = useState<ManifoldNode | null>(null);

  // FROZEN SOLUTION - completely disconnected from sketchpad after solve
  const [frozenSolution, setFrozenSolution] = useState<FrozenSolution | null>(null);

  // Solution viewer state
  const [subManifoldSelectedNode, setSubManifoldSelectedNode] = useState<ManifoldNode | null>(null);
  const [liftSelectedNodeId, setLiftSelectedNodeId] = useState<number | null>(null);

  // Solving state
  const [solving, setSolving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [satStats, setSatStats] = useState<{ numVars: number; numClauses: number } | null>(null);

  // Worker ref
  const workerRef = useRef<Worker | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Create manifold for SKETCHPAD (uses current settings)
  const sketchpadManifold = useMemo<Manifold>(
    () => createManifold(manifoldType, size),
    [manifoldType, size]
  );

  // Create manifold for SOLUTION (uses frozen settings if available)
  const solutionManifold = useMemo<Manifold | null>(() => {
    if (!frozenSolution) return null;
    return createManifold(frozenSolution.manifoldType, frozenSolution.size);
  }, [frozenSolution]);

  // Reset sketchpad when manifold type or size changes
  useEffect(() => {
    setBlockedNodes(new Set());
    setRoot({ row: 0, col: 0 });
    setSketchpadSelectedNode(null);
  }, [manifoldType, size]);

  // Get compatible orbifold lifts for current sketchpad settings
  const compatibleLifts = useMemo<OrbifoldLift[]>(
    () => getCompatibleLifts(manifoldType),
    [manifoldType]
  );

  // Auto-select first compatible lift
  useEffect(() => {
    if (compatibleLifts.length > 0 && !compatibleLifts.find((l) => l.type === selectedLiftType)) {
      setSelectedLiftType(compatibleLifts[0].type);
    }
  }, [compatibleLifts, selectedLiftType]);

  // Get selected orbifold lift for SOLUTION (uses frozen settings)
  const solutionLift = useMemo<OrbifoldLift | null>(() => {
    if (!frozenSolution) return null;
    const lifts = getCompatibleLifts(frozenSolution.manifoldType);
    return lifts.find((l) => l.type === frozenSolution.liftType) ?? null;
  }, [frozenSolution]);

  // Create sub-manifold from FROZEN SOLUTION (completely disconnected from sketchpad)
  const subManifold = useMemo<SubManifoldImpl | null>(() => {
    if (!frozenSolution || !solutionManifold) return null;
    return SubManifoldImpl.fromParentMap(
      solutionManifold,
      frozenSolution.parentMap,
      frozenSolution.blockedNodes,
      frozenSolution.root
    );
  }, [frozenSolution, solutionManifold]);

  // Create lifted graph from FROZEN SOLUTION
  const liftedGraph = useMemo<OrbifoldLiftGraph | null>(() => {
    if (!subManifold || !solutionLift || !frozenSolution) return null;
    return solutionLift.lift(subManifold, frozenSolution.multiplier, CELL_SIZE);
  }, [subManifold, solutionLift, frozenSolution]);

  // Clean up worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  // Handle sketchpad node click
  const handleSketchpadClick = useCallback(
    (node: ManifoldNode) => {
      const nodeKey = sketchpadManifold.nodeKey(node);

      switch (activeTool) {
        case "rootSetter":
          if (!blockedNodes.has(nodeKey)) {
            setRoot(node);
          }
          break;

        case "neighborhoodViewer":
          if (
            sketchpadSelectedNode &&
            sketchpadSelectedNode.row === node.row &&
            sketchpadSelectedNode.col === node.col
          ) {
            setSketchpadSelectedNode(null);
          } else {
            setSketchpadSelectedNode(node);
          }
          break;

        case "blockSetter":
          if (node.row === root.row && node.col === root.col) {
            return; // Can't block root
          }
          setBlockedNodes((prev) => {
            const next = new Set(prev);
            if (next.has(nodeKey)) {
              next.delete(nodeKey);
            } else {
              next.add(nodeKey);
            }
            return next;
          });
          break;
      }
    },
    [activeTool, sketchpadManifold, blockedNodes, root, sketchpadSelectedNode]
  );

  // Handle sub-manifold node click
  const handleSubManifoldClick = useCallback(
    (node: ManifoldNode) => {
      if (
        subManifoldSelectedNode &&
        subManifoldSelectedNode.row === node.row &&
        subManifoldSelectedNode.col === node.col
      ) {
        setSubManifoldSelectedNode(null);
      } else {
        setSubManifoldSelectedNode(node);
      }
      // Clear lift selection when selecting in sub-manifold
      setLiftSelectedNodeId(null);
    },
    [subManifoldSelectedNode]
  );

  // Handle lift node click
  const handleLiftClick = useCallback(
    (node: LiftedNode) => {
      if (liftSelectedNodeId === node.id) {
        setLiftSelectedNodeId(null);
        setSubManifoldSelectedNode(null);
      } else {
        setLiftSelectedNodeId(node.id);
        // Also select the original node in sub-manifold viewer
        setSubManifoldSelectedNode(node.originalNode);
      }
    },
    [liftSelectedNodeId]
  );

  // Get highlighted nodes in sub-manifold based on lift selection
  const highlightedSubManifoldNodes = useMemo<Set<string>>(() => {
    if (liftSelectedNodeId === null || !liftedGraph || !solutionManifold) return new Set();
    const node = liftedGraph.nodeById.get(liftSelectedNodeId);
    if (!node) return new Set();
    return new Set([solutionManifold.nodeKey(node.originalNode)]);
  }, [liftSelectedNodeId, liftedGraph, solutionManifold]);

  // Get highlighted nodes in lift based on sub-manifold selection
  const highlightedLiftNodes = useMemo<Set<string>>(() => {
    if (!subManifoldSelectedNode || !solutionManifold) return new Set();
    return new Set([solutionManifold.nodeKey(subManifoldSelectedNode)]);
  }, [subManifoldSelectedNode, solutionManifold]);

  // Handle solve - creates a FROZEN solution
  const handleSolve = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
    }

    // Ensure root is not blocked
    let safeRoot = root;
    if (blockedNodes.has(sketchpadManifold.nodeKey(root))) {
      // Find first non-blocked node
      for (const node of sketchpadManifold.getNodes()) {
        if (!blockedNodes.has(sketchpadManifold.nodeKey(node))) {
          safeRoot = node;
          break;
        }
      }
      setRoot(safeRoot);
    }

    // Validate that a lift type is selected
    if (!selectedLiftType) {
      setErrorMessage("Please select an orbifold lift type");
      return;
    }

    setSolving(true);
    setErrorMessage(null);
    setSatStats(null);
    // Clear viewer selections when starting new solve
    setSubManifoldSelectedNode(null);
    setLiftSelectedNodeId(null);

    // Capture current settings to freeze with solution
    const currentManifoldType = manifoldType;
    const currentSize = size;
    const currentMultiplier = multiplier;
    const currentLiftType = selectedLiftType;
    const currentRoot = safeRoot;
    const currentBlockedNodes = new Set(blockedNodes);

    const worker = new WallpaperMazeWorker();
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WallpaperMazeResponse>) => {
      const response = event.data;

      if (response.messageType === "progress") {
        if (response.stats) {
          setSatStats(response.stats);
        }
        return;
      }

      if (response.success && response.result) {
        // Convert parent array to Map<string, ManifoldNode | null>
        const newParentMap = new Map<string, ManifoldNode | null>();
        for (const [key, parent] of response.result.parentOf) {
          newParentMap.set(key, parent);
        }
        
        // Create FROZEN solution with all settings captured at solve time
        setFrozenSolution({
          manifoldType: currentManifoldType,
          size: currentSize,
          multiplier: currentMultiplier,
          liftType: currentLiftType,
          root: currentRoot,
          blockedNodes: currentBlockedNodes,
          parentMap: newParentMap,
        });
        setErrorMessage(null);
      } else {
        setErrorMessage(response.error || "Failed to solve maze");
      }

      setSolving(false);
      workerRef.current = null;
    };

    worker.onerror = (error) => {
      setErrorMessage(`Worker error: ${error.message}`);
      setSolving(false);
      workerRef.current = null;
    };

    const request: WallpaperMazeRequest = {
      length: currentSize,
      rootRow: safeRoot.row,
      rootCol: safeRoot.col,
      wallpaperGroup: manifoldTypeToWallpaperGroup(currentManifoldType),
      vacantCells: Array.from(currentBlockedNodes),
    };
    worker.postMessage(request);
  }, [sketchpadManifold, manifoldType, size, multiplier, selectedLiftType, root, blockedNodes]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
      setSolving(false);
      setErrorMessage("Solving cancelled");
    }
  }, []);

  return (
    <div className="wallpaper-maze-explorer" style={{ padding: "20px" }}>
      <h2>Wallpaper Maze Explorer (v2)</h2>

      <div style={{ display: "flex", gap: "40px", marginBottom: "20px", flexWrap: "wrap" }}>
        {/* Left panel: Sketchpad and Controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <h3 style={{ margin: 0 }}>Sketchpad ({manifoldType})</h3>

          {/* Tool selector */}
          <div style={{ display: "flex", gap: "5px", marginBottom: "10px", flexWrap: "wrap" }}>
            <button
              onClick={() => setActiveTool("rootSetter")}
              style={{
                padding: "5px 10px",
                backgroundColor: activeTool === "rootSetter" ? "#4caf50" : "#e0e0e0",
                color: activeTool === "rootSetter" ? "white" : "black",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              🎯 Root
            </button>
            <button
              onClick={() => setActiveTool("neighborhoodViewer")}
              style={{
                padding: "5px 10px",
                backgroundColor: activeTool === "neighborhoodViewer" ? "#2196f3" : "#e0e0e0",
                color: activeTool === "neighborhoodViewer" ? "white" : "black",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              🔍 Neighbors
            </button>
            <button
              onClick={() => setActiveTool("blockSetter")}
              style={{
                padding: "5px 10px",
                backgroundColor: activeTool === "blockSetter" ? "#f44336" : "#e0e0e0",
                color: activeTool === "blockSetter" ? "white" : "black",
                border: "none",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              ⬛ Block
            </button>
          </div>

          {/* Sketchpad */}
          <Sketchpad
            manifold={sketchpadManifold}
            blockedNodes={blockedNodes}
            root={root}
            selectedNode={sketchpadSelectedNode}
            activeTool={activeTool}
            cellSize={CELL_SIZE}
            onNodeClick={handleSketchpadClick}
          />

          {/* Settings */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" }}>
            <label>
              Manifold Type:
              <select
                value={manifoldType}
                onChange={(e) => setManifoldType(e.target.value as ManifoldType)}
                style={{ marginLeft: "10px" }}
              >
                {getManifoldTypes().map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Size:
              <input
                type="number"
                min={2}
                max={10}
                value={size}
                onChange={(e) => setSize(parseInt(e.target.value))}
                style={{ marginLeft: "10px", width: "60px" }}
              />
            </label>

            <label>
              Multiplier:
              <input
                type="number"
                min={1}
                max={5}
                value={multiplier}
                onChange={(e) => setMultiplier(parseInt(e.target.value))}
                style={{ marginLeft: "10px", width: "60px" }}
              />
            </label>

            <label>
              Orbifold Lift:
              <select
                value={selectedLiftType || ""}
                onChange={(e) => setSelectedLiftType(e.target.value)}
                style={{ marginLeft: "10px" }}
              >
                {compatibleLifts.map((lift) => (
                  <option key={lift.type} value={lift.type}>
                    {lift.type}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Solve buttons */}
          <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
            {!solving ? (
              <button onClick={handleSolve} style={{ padding: "10px 20px" }}>
                Solve
              </button>
            ) : (
              <button
                onClick={handleCancel}
                style={{ padding: "10px 20px", backgroundColor: "#f44336", color: "white" }}
              >
                Cancel
              </button>
            )}
          </div>

          {solving && satStats && (
            <div style={{ fontSize: "12px", color: "#666" }}>
              Variables: {satStats.numVars}, Clauses: {satStats.numClauses}
            </div>
          )}

          {errorMessage && <div style={{ color: "red" }}>{errorMessage}</div>}

          <div style={{ fontSize: "12px", color: "#666", marginTop: "5px" }}>
            <strong>Root:</strong> ({root.row}, {root.col})
            <br />
            <strong>Blocked:</strong> {blockedNodes.size} nodes
          </div>
        </div>

        {/* Middle panel: Sub-manifold Viewer */}
        {subManifold && frozenSolution && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <h3 style={{ margin: 0 }}>Sub-Manifold Viewer</h3>
            <p style={{ margin: 0, fontSize: "12px", color: "#666", backgroundColor: "#f0f0f0", padding: "4px 8px", borderRadius: "4px" }}>
              <strong>{frozenSolution.manifoldType}</strong> • Size: {frozenSolution.size}×{frozenSolution.size} • Root: ({frozenSolution.root.row}, {frozenSolution.root.col})
            </p>
            <p style={{ margin: 0, fontSize: "12px", color: "#666" }}>
              Click nodes to see edges in both viewers
            </p>

            <SubManifoldViewer
              subManifold={subManifold}
              selectedNode={subManifoldSelectedNode}
              cellSize={CELL_SIZE}
              onNodeClick={handleSubManifoldClick}
              highlightedNodes={highlightedSubManifoldNodes}
              showAllEdges={true}
            />

            {subManifoldSelectedNode && (
              <div style={{ fontSize: "12px", color: "#666" }}>
                <strong>Selected:</strong> ({subManifoldSelectedNode.row},{" "}
                {subManifoldSelectedNode.col})
              </div>
            )}
          </div>
        )}

        {/* Right panel: Orbifold Lift Viewer */}
        {liftedGraph && subManifold && frozenSolution && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <h3 style={{ margin: 0 }}>Orbifold Lift ({frozenSolution.liftType})</h3>
            <p style={{ margin: 0, fontSize: "12px", color: "#666", backgroundColor: "#f0f0f0", padding: "4px 8px", borderRadius: "4px" }}>
              Multiplier: {frozenSolution.multiplier}×{frozenSolution.multiplier}
            </p>
            <p style={{ margin: 0, fontSize: "12px", color: "#666" }}>
              Click nodes to see edges in both viewers
            </p>

            <OrbifoldLiftViewer
              graph={liftedGraph}
              subManifold={subManifold}
              selectedNodeId={liftSelectedNodeId}
              onNodeClick={handleLiftClick}
              highlightedOriginalNodes={highlightedLiftNodes}
              svgRef={svgRef}
            />
          </div>
        )}
      </div>
    </div>
  );
}
