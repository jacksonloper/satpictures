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
 * - Find non-self-intersecting loops with target voltage via SAT solving
 *   (uses BFS to compute reachable voltages, then SAT with variable-length paths)
 * - See the generated lifted graph with highlighting for inspected nodes
 */

import { useState, useCallback, useMemo, useRef } from "react";
import {
  createOrbifoldGrid,
  type WallpaperGroupType,
  type ColorData,
  type EdgeStyleData,
  type EdgeLinestyle,
  type LoopStep,
} from "./createOrbifolds";
import {
  constructLiftedGraphFromOrbifold,
  processAllNonInteriorOnce,
  buildAdjacency,
  type OrbifoldGrid,
  type OrbifoldEdgeId,
  type OrbifoldNodeId,
} from "./orbifoldbasics";
import { applyRandomSpanningTreeToWhiteNodes } from "./spanningTree";
import { OrbifoldColorsExplorer } from "./OrbifoldColorsExplorer";
import {
  ErrorBoundary,
  OrbifoldGridTools,
  LoopResultRenderer,
  ControlsPanel,
  ToolSelector,
  LoopFinderPanel,
  LoopsFinderPanel,
  InspectionPanel,
  LiftedGraphSection,
  HelpSection,
  type ToolType,
  type InspectionInfo,
  type BackgroundMode,
} from "./components";
import { useLoopFinder } from "./hooks";
import "../App.css";

// Constants
const DEFAULT_SIZE = 4;
const DEFAULT_EXPANSION = 10;

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
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>("domain");
  const [showDashedLines, setShowDashedLines] = useState(true);
  const [showNodes, setShowNodes] = useState(false);
  const [showWalls, setShowWalls] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rootNodeId, setRootNodeId] = useState<OrbifoldNodeId | null>(() => {
    const grid = createOrbifoldGrid("P1", DEFAULT_SIZE);
    const firstNodeId = grid.nodes.keys().next().value as OrbifoldNodeId;
    return firstNodeId ?? null;
  });

  const minSize = wallpaperGroup === "P4g" || wallpaperGroup === "P6" ? 4 : 2;
  const liftedGraphSvgRef = useRef<SVGSVGElement>(null);
  
  const [orbifoldGrid, setOrbifoldGrid] = useState<OrbifoldGrid<ColorData, EdgeStyleData>>(() => {
    const grid = createOrbifoldGrid(wallpaperGroup, size);
    buildAdjacency(grid);
    return grid;
  });

  // Use the loop finder hook
  const loopFinder = useLoopFinder({
    orbifoldGrid,
    rootNodeId,
    onError: setErrorMessage,
  });

  // Recreate grid and reset dependent state when wallpaper group or size changes
  const resetGrid = useCallback((nextGroup: WallpaperGroupType, nextSize: number) => {
    const grid = createOrbifoldGrid(nextGroup, nextSize);
    buildAdjacency(grid);
    setOrbifoldGrid(grid);
    setInspectionInfo(null);
    setSelectedVoltageKey(null);
    const firstNodeId = grid.nodes.keys().next().value as OrbifoldNodeId;
    setRootNodeId(firstNodeId ?? null);
    loopFinder.resetAllLoopState();
  }, [loopFinder]);

  const handleWallpaperGroupChange = (nextGroup: WallpaperGroupType) => {
    let nextSize = (nextGroup === "P4g" || nextGroup === "P6") && size < 4 ? 4 : size;
    if ((nextGroup === "P2" || nextGroup === "P2hex") && nextSize % 2 !== 0) nextSize++;
    if (nextSize !== size) setSize(nextSize);
    setWallpaperGroup(nextGroup);
    resetGrid(nextGroup, nextSize);
  };

  const handleSizeChange = useCallback((nextSize: number) => {
    setSize(nextSize);
    resetGrid(wallpaperGroup, nextSize);
  }, [wallpaperGroup, resetGrid]);

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

  const toggleLinestyle = (current: EdgeLinestyle): EdgeLinestyle => 
    current === "solid" ? "dashed" : "solid";

  const handleEdgeLinestyleToggle = useCallback((edgeId: OrbifoldEdgeId) => {
    setOrbifoldGrid((prev) => {
      const newEdges = new Map(prev.edges);
      const edge = newEdges.get(edgeId);
      if (edge) {
        const currentLinestyle = edge.data?.linestyle ?? "solid";
        const newLinestyle = toggleLinestyle(currentLinestyle);
        newEdges.set(edgeId, { ...edge, data: { linestyle: newLinestyle } });
      }
      return { nodes: prev.nodes, edges: newEdges, adjacency: prev.adjacency };
    });
    setInspectionInfo((prevInfo) => {
      if (!prevInfo) return null;
      return {
        ...prevInfo,
        edges: prevInfo.edges.map((e) => {
          if (e.edgeId === edgeId) {
            return { ...e, linestyle: toggleLinestyle(e.linestyle) };
          }
          return e;
        }),
      };
    });
  }, []);

  const handleInspect = useCallback((info: InspectionInfo | null) => {
    setInspectionInfo(info);
  }, []);

  const handleRandomSpanningTree = useCallback(() => {
    try {
      setErrorMessage(null);
      setOrbifoldGrid((prev) => applyRandomSpanningTreeToWhiteNodes(prev));
      setInspectionInfo(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "An unexpected error occurred";
      setErrorMessage(`Random tree generation failed: ${message}`);
    }
  }, []);

  const handleSetRoot = useCallback((nodeId: OrbifoldNodeId) => {
    setRootNodeId(nodeId);
  }, []);

  const handleAcceptLoop = useCallback((selectedEdgeIds: string[]) => {
    if (!loopFinder.pendingLoopResult) return;

    const pathNodeIds = loopFinder.pendingLoopResult.pathNodeIds;
    const chosenEdges = new Set(selectedEdgeIds);
    const loopNodeIds = new Set(pathNodeIds);

    // Build loopStep per node: array of all step indices where this node appears
    // (excluding the final return-to-root which duplicates step 0)
    const nodeLoopSteps = new Map<string, number[]>();
    for (let t = 0; t < pathNodeIds.length - 1; t++) {
      const id = pathNodeIds[t];
      if (!nodeLoopSteps.has(id)) nodeLoopSteps.set(id, []);
      nodeLoopSteps.get(id)!.push(t);
    }

    // Build loopSteps per edge: for each step t, selectedEdgeIds[t] is the
    // edge used from pathNodeIds[t] to pathNodeIds[t+1]
    const edgeLoopSteps = new Map<string, LoopStep[]>();
    for (let t = 0; t < selectedEdgeIds.length; t++) {
      const edgeId = selectedEdgeIds[t];
      if (!edgeId) continue;
      if (!edgeLoopSteps.has(edgeId)) edgeLoopSteps.set(edgeId, []);
      edgeLoopSteps.get(edgeId)!.push({ startStep: t, startNode: pathNodeIds[t] });
    }

    setOrbifoldGrid((prev) => {
      const newEdges = new Map(prev.edges);
      for (const [edgeId, edge] of newEdges) {
        const linestyle = chosenEdges.has(edgeId) ? "solid" : "dashed";
        const loopSteps = edgeLoopSteps.get(edgeId) ?? [];
        newEdges.set(edgeId, { ...edge, data: { linestyle, loopSteps } });
      }
      const newNodes = new Map(prev.nodes);
      for (const [nodeId, node] of newNodes) {
        if (!loopNodeIds.has(nodeId)) {
          newNodes.set(nodeId, { ...node, data: { ...node.data, color: "black", loopStep: null } });
        } else {
          const steps = nodeLoopSteps.get(nodeId) ?? null;
          newNodes.set(nodeId, { ...node, data: { color: "white", ...node.data, loopStep: steps } });
        }
      }
      return { nodes: newNodes, edges: newEdges, adjacency: prev.adjacency };
    });

    setInspectionInfo(null);
    loopFinder.setPendingLoopResult(null);
    loopFinder.resetLoopsFinderState();
  }, [loopFinder]);

  const handleClear = useCallback(() => {
    setOrbifoldGrid((prev) => {
      const newNodes = new Map(prev.nodes);
      for (const [nodeId, node] of newNodes) {
        newNodes.set(nodeId, { ...node, data: { ...node.data, color: "white", loopStep: null } });
      }
      const newEdges = new Map(prev.edges);
      for (const [edgeId, edge] of newEdges) {
        newEdges.set(edgeId, { ...edge, data: { ...edge.data, linestyle: "solid", loopSteps: undefined } });
      }
      return { nodes: newNodes, edges: newEdges, adjacency: prev.adjacency };
    });
  }, []);

  const handleExportSvg = useCallback(() => {
    const svgElement = liftedGraphSvgRef.current;
    if (!svgElement) return;
    const svgClone = svgElement.cloneNode(true) as SVGSVGElement;
    svgClone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgClone);
    const blob = new Blob([svgString], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const safeGroup = wallpaperGroup.toLowerCase();
    link.download = `lifted-graph-${safeGroup}-${size}x${size}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [wallpaperGroup, size]);

  const handleLiftedNodeClick = useCallback((_liftedNodeId: string, voltageKey: string) => {
    setSelectedVoltageKey(prev => prev === voltageKey ? null : voltageKey);
  }, []);

  const liftedGraph = useMemo(() => {
    const lifted = constructLiftedGraphFromOrbifold<ColorData, EdgeStyleData>(orbifoldGrid);
    for (let i = 0; i < expansion; i++) {
      processAllNonInteriorOnce(lifted);
    }
    return lifted;
  }, [orbifoldGrid, expansion]);

  return (
    <div className="orbifolds-explorer" style={{ padding: "20px" }}>
      <h1 style={{ marginBottom: "20px" }}>🔮 Orbifolds Explorer</h1>
      
      {/* Controls */}
      <ControlsPanel
        wallpaperGroup={wallpaperGroup}
        onWallpaperGroupChange={handleWallpaperGroupChange}
        size={size}
        onSizeChange={handleSizeChange}
        minSize={minSize}
        expansion={expansion}
        onExpansionChange={setExpansion}
        useAxialTransform={useAxialTransform}
        onUseAxialTransformChange={setUseAxialTransform}
      />
      
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
          <ToolSelector
            tool={tool}
            onToolChange={setTool}
            onRandomSpanningTree={handleRandomSpanningTree}
            onToggleLoopFinder={loopFinder.handleToggleLoopFinder}
            showLoopFinder={loopFinder.showLoopFinder}
            onToggleLoopsFinder={loopFinder.handleToggleLoopsFinder}
            showLoopsFinder={loopFinder.showLoopsFinder}
            onClear={handleClear}
          />
          
          {/* Loop Finder Panel */}
          {loopFinder.showLoopFinder && (
            <LoopFinderPanel
              maxLength={loopFinder.maxLength}
              onMaxLengthChange={(v) => {
                loopFinder.setMaxLength(v);
                loopFinder.setReachableVoltages([]);
                loopFinder.setSelectedTargetVoltageKey(null);
                if (loopFinder.minLength > v) loopFinder.setMinLength(v);
              }}
              minLength={loopFinder.minLength}
              onMinLengthChange={loopFinder.setMinLength}
              loopMethod={loopFinder.loopMethod}
              onLoopMethodChange={loopFinder.setLoopMethod}
              solvingLoop={loopFinder.solvingLoop}
              computingVoltages={loopFinder.computingVoltages}
              onComputeVoltages={loopFinder.handleComputeVoltages}
              onCancel={loopFinder.handleCancelLoopFind}
              reachableVoltages={loopFinder.reachableVoltages}
              selectedTargetVoltageKey={loopFinder.selectedTargetVoltageKey}
              onSelectedTargetVoltageKeyChange={loopFinder.setSelectedTargetVoltageKey}
              onSolveLoop={loopFinder.handleSolveLoop}
              loopSatStats={loopFinder.loopSatStats}
              rootNodeId={rootNodeId}
            />
          )}
          
          {/* Find Loops (plural) Panel */}
          {loopFinder.showLoopsFinder && (
            <LoopsFinderPanel
              maxLengthLoops={loopFinder.maxLengthLoops}
              onMaxLengthLoopsChange={(v) => {
                loopFinder.setMaxLengthLoops(v);
                loopFinder.resetLoopsFinderState();
                if (loopFinder.minLengthLoops > v) loopFinder.setMinLengthLoops(v);
              }}
              minLengthLoops={loopFinder.minLengthLoops}
              onMinLengthLoopsChange={(v) => {
                loopFinder.setMinLengthLoops(v);
                loopFinder.resetLoopsFinderState();
              }}
              loopMethodLoops={loopFinder.loopMethodLoops}
              onLoopMethodLoopsChange={loopFinder.setLoopMethodLoops}
              solvingAllLoops={loopFinder.solvingAllLoops}
              onFindAllLoops={loopFinder.handleFindAllLoops}
              onCancel={loopFinder.handleCancelLoopsFind}
              solveAllProgress={loopFinder.solveAllProgress}
              solveAllResults={loopFinder.solveAllResults}
              selectedLoopsVoltageKey={loopFinder.selectedLoopsVoltageKey}
              onSelectedLoopsVoltageKeyChange={(key) => {
                loopFinder.setSelectedLoopsVoltageKey(key);
                loopFinder.setPendingLoopResult(null);
              }}
              onPreview={loopFinder.handlePreviewLoopsResult}
              onDismiss={loopFinder.handleDismissLoops}
              rootNodeId={rootNodeId}
            />
          )}

          {/* Loop Result Preview (Accept/Reject) */}
          {loopFinder.pendingLoopResult && rootNodeId && (
            <LoopResultRenderer
              n={size}
              grid={orbifoldGrid}
              pathNodeIds={loopFinder.pendingLoopResult.pathNodeIds}
              rootNodeId={rootNodeId}
              onAccept={handleAcceptLoop}
              onReject={loopFinder.handleRejectLoop}
              wallpaperGroup={wallpaperGroup}
              initialEdgeIds={loopFinder.pendingLoopResult.pathEdgeIds}
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
            <InspectionPanel
              inspectionInfo={inspectionInfo}
              onEdgeLinestyleToggle={handleEdgeLinestyleToggle}
            />
          )}
        </div>
        
        {/* Lifted Graph */}
        <LiftedGraphSection
          wallpaperGroup={wallpaperGroup}
          useAxialTransform={useAxialTransform}
          liftedGraph={liftedGraph}
          orbifoldGrid={orbifoldGrid}
          inspectedNodeId={inspectionInfo?.nodeId ?? null}
          selectedVoltageKey={selectedVoltageKey}
          onNodeClick={handleLiftedNodeClick}
          backgroundMode={backgroundMode}
          onBackgroundModeChange={setBackgroundMode}
          showDashedLines={showDashedLines}
          onShowDashedLinesChange={setShowDashedLines}
          showNodes={showNodes}
          onShowNodesChange={setShowNodes}
          showWalls={showWalls}
          onShowWallsChange={setShowWalls}
          onExportSvg={handleExportSvg}
          svgRef={liftedGraphSvgRef}
        />
      </div>
      
      {/* Help text */}
      <HelpSection />

      {/* Show Examples toggle */}
      <div style={{ marginTop: "30px" }}>
        <button
          onClick={() => setShowExamples((prev) => !prev)}
          style={{
            padding: "8px 16px",
            borderRadius: "6px",
            border: showExamples ? "2px solid #3498db" : "1px solid #3498db",
            backgroundColor: showExamples ? "#ebf5fb" : "white",
            cursor: "pointer",
            fontSize: "14px",
            fontWeight: showExamples ? "bold" : "normal",
          }}
        >
          {showExamples ? "Hide Examples" : "Show Examples"}
        </button>
        {showExamples && (
          <div style={{ marginTop: "16px" }}>
            <OrbifoldColorsExplorer />
          </div>
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
