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
 * Main explorer component
 */
export function WallpaperMazeExplorerV2() {
  // Manifold settings
  const [manifoldType, setManifoldType] = useState<ManifoldType>("P1");
  const [size, setSize] = useState(DEFAULT_LENGTH);
  const [multiplier, setMultiplier] = useState(DEFAULT_MULTIPLIER);

  // Sub-manifold state
  const [blockedNodes, setBlockedNodes] = useState<Set<string>>(new Set());
  const [root, setRoot] = useState<ManifoldNode>({ row: 0, col: 0 });
  const [parentMap, setParentMap] = useState<Map<string, ManifoldNode | null> | null>(null);

  // Tool state
  const [activeTool, setActiveTool] = useState<SketchpadTool>("rootSetter");
  const [sketchpadSelectedNode, setSketchpadSelectedNode] = useState<ManifoldNode | null>(null);

  // Orbifold lift state
  const [selectedLiftType, setSelectedLiftType] = useState<string | null>(null);

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

  // Create manifold
  const manifold = useMemo<Manifold>(
    () => createManifold(manifoldType, size),
    [manifoldType, size]
  );

  // Reset when manifold type or size changes
  useEffect(() => {
    setBlockedNodes(new Set());
    setRoot({ row: 0, col: 0 });
    setParentMap(null);
    setSketchpadSelectedNode(null);
    setSubManifoldSelectedNode(null);
    setLiftSelectedNodeId(null);
  }, [manifoldType, size]);

  // Get compatible orbifold lifts
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

  // Get selected orbifold lift
  const selectedLift = useMemo<OrbifoldLift | null>(
    () => compatibleLifts.find((l) => l.type === selectedLiftType) ?? null,
    [compatibleLifts, selectedLiftType]
  );

  // Create sub-manifold from parent map
  const subManifold = useMemo<SubManifoldImpl | null>(() => {
    if (!parentMap) return null;
    return SubManifoldImpl.fromParentMap(manifold, parentMap, blockedNodes, root);
  }, [manifold, parentMap, blockedNodes, root]);

  // Create lifted graph
  const liftedGraph = useMemo<OrbifoldLiftGraph | null>(() => {
    if (!subManifold || !selectedLift) return null;
    return selectedLift.lift(subManifold, multiplier, CELL_SIZE);
  }, [subManifold, selectedLift, multiplier]);

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
      const nodeKey = manifold.nodeKey(node);

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
    [activeTool, manifold, blockedNodes, root, sketchpadSelectedNode]
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
    if (liftSelectedNodeId === null || !liftedGraph) return new Set();
    const node = liftedGraph.nodeById.get(liftSelectedNodeId);
    if (!node) return new Set();
    return new Set([manifold.nodeKey(node.originalNode)]);
  }, [liftSelectedNodeId, liftedGraph, manifold]);

  // Get highlighted nodes in lift based on sub-manifold selection
  const highlightedLiftNodes = useMemo<Set<string>>(() => {
    if (!subManifoldSelectedNode) return new Set();
    return new Set([manifold.nodeKey(subManifoldSelectedNode)]);
  }, [subManifoldSelectedNode, manifold]);

  // Handle solve
  const handleSolve = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
    }

    // Ensure root is not blocked
    let safeRoot = root;
    if (blockedNodes.has(manifold.nodeKey(root))) {
      // Find first non-blocked node
      for (const node of manifold.getNodes()) {
        if (!blockedNodes.has(manifold.nodeKey(node))) {
          safeRoot = node;
          break;
        }
      }
      setRoot(safeRoot);
    }

    setSolving(true);
    setErrorMessage(null);
    setSatStats(null);

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
        setParentMap(newParentMap);
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
      length: size,
      rootRow: safeRoot.row,
      rootCol: safeRoot.col,
      wallpaperGroup: manifoldTypeToWallpaperGroup(manifoldType),
      vacantCells: Array.from(blockedNodes),
    };
    worker.postMessage(request);
  }, [manifold, manifoldType, size, root, blockedNodes]);

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
            manifold={manifold}
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
        {subManifold && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <h3 style={{ margin: 0 }}>Sub-Manifold Viewer</h3>
            <p style={{ margin: 0, fontSize: "12px", color: "#666" }}>
              Click nodes to highlight in lift graph
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
        {liftedGraph && subManifold && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <h3 style={{ margin: 0 }}>Orbifold Lift ({selectedLiftType})</h3>
            <p style={{ margin: 0, fontSize: "12px", color: "#666" }}>
              Click nodes to highlight in sub-manifold
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
