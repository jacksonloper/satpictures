import { useState, useCallback, useRef, useEffect } from "react";
import type { UnifiedTilingResult } from "./grids/unifiedTiling";
import type { PolyformType } from "../utils/polyformTransforms";
import {
  generateMaze,
  type MazeResult,
  generateHexMaze,
  type HexMazeResult,
  generateTriMaze,
  type TriMazeResult,
  type EdgeAdjacencyViolation,
  type UnifiedEdgeInfo,
  checkEdgeAdjacencyConsistency,
  getAllEdges,
  normalizeEdgeState,
  downloadSvg,
  downloadJson,
} from "../polyform-explorer";
import { getGridDef, toSquarePlacements, toHexPlacements, toTriPlacements, type TileState } from "../PolyformExplorerHelpers";

export interface UseTilingSolverOptions {
  tiles: TileState[];
  polyformType: PolyformType;
}

export function useTilingSolver({ tiles, polyformType }: UseTilingSolverOptions) {
  // Tiling solver state
  const [tilingWidthInput, setTilingWidthInput] = useState("6");
  const [tilingHeightInput, setTilingHeightInput] = useState("6");
  const [tilingWidth, setTilingWidth] = useState(6);
  const [tilingHeight, setTilingHeight] = useState(6);
  const [tilingWidthError, setTilingWidthError] = useState(false);
  const [tilingHeightError, setTilingHeightError] = useState(false);
  const [solving, setSolving] = useState(false);
  const [tilingResult, setTilingResult] = useState<UnifiedTilingResult | null>(null);
  const [tilingError, setTilingError] = useState<string | null>(null);
  const [tilingStats, setTilingStats] = useState<{ numVars: number; numClauses: number } | null>(null);
  const [solvedPolyformType, setSolvedPolyformType] = useState<PolyformType | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const tilingSvgRef = useRef<SVGSVGElement | null>(null);
  
  // Debugging state
  const [highlightedPlacement, setHighlightedPlacement] = useState<number | null>(null);
  const [highlightedEdge, setHighlightedEdge] = useState<number | null>(null);
  const [edgeInfo, setEdgeInfo] = useState<{
    cellIndex: number;
    edgeIndex: number;
    isInternal: boolean;
    coord1: { q: number; r: number };
    coord2: { q: number; r: number } | null;
    direction: string;
  } | null>(null);
  const [hideFills, setHideFills] = useState(false);
  
  // Edge adjacency violation state for debugging
  const [edgeViolations, setEdgeViolations] = useState<EdgeAdjacencyViolation[]>([]);
  const [allEdges, setAllEdges] = useState<UnifiedEdgeInfo[]>([]);
  const [selectedEdgeIndex, setSelectedEdgeIndex] = useState<number | null>(null);
  const [showDebugSide, setShowDebugSide] = useState<'A' | 'B'>('A');
  const [edgeFilter, setEdgeFilter] = useState<'all' | 'violations' | 'consistent'>('all');
  
  // Maze generation state
  const [mazeResult, setMazeResult] = useState<MazeResult | null>(null);
  const [hexMazeResult, setHexMazeResult] = useState<HexMazeResult | null>(null);
  const [triMazeResult, setTriMazeResult] = useState<TriMazeResult | null>(null);
  const mazeSvgRef = useRef<SVGSVGElement | null>(null);
  
  // Download SVG function
  const handleDownloadSvg = useCallback(() => {
    if (!tilingSvgRef.current) return;
    downloadSvg(tilingSvgRef.current, `tiling-${tilingWidth}x${tilingHeight}.svg`);
  }, [tilingWidth, tilingHeight]);
  
  // Download placements as JSON
  const handleDownloadPlacementsJson = useCallback(() => {
    if (!tilingResult || !tilingResult.placements) return;
    
    const data = {
      gridWidth: tilingWidth,
      gridHeight: tilingHeight,
      polyformType: solvedPolyformType,
      numPlacements: tilingResult.placements.length,
      placements: tilingResult.placements.map((p, i) => ({
        index: i,
        id: p.id,
        transformIndex: p.transformIndex,
        cells: p.cells,
        ...(("offset" in p) ? { offset: p.offset } : {}),
      })),
    };
    
    downloadJson(data, `placements-${tilingWidth}x${tilingHeight}.json`);
  }, [tilingResult, tilingWidth, tilingHeight, solvedPolyformType]);
  
  // Generate maze from current solution (polyomino)
  const handleGenerateMaze = useCallback(() => {
    if (!tilingResult?.placements || solvedPolyformType !== "polyomino") return;
    const placements = toSquarePlacements(tilingResult.placements);
    const result = generateMaze(placements);
    setMazeResult(result);
  }, [tilingResult, solvedPolyformType]);
  
  // Generate hex maze from current solution (polyhex)
  const handleGenerateHexMaze = useCallback(() => {
    if (!tilingResult?.placements || solvedPolyformType !== "polyhex") return;
    const placements = toHexPlacements(tilingResult.placements);
    const result = generateHexMaze(placements);
    setHexMazeResult(result);
  }, [tilingResult, solvedPolyformType]);
  
  // Generate triangle maze from current solution (polyiamond)
  const handleGenerateTriMaze = useCallback(() => {
    if (!tilingResult?.placements || solvedPolyformType !== "polyiamond") return;
    const placements = toTriPlacements(tilingResult.placements);
    const result = generateTriMaze(placements);
    setTriMazeResult(result);
  }, [tilingResult, solvedPolyformType]);
  
  // Download maze SVG
  const handleDownloadMazeSvg = useCallback(() => {
    if (!mazeSvgRef.current) return;
    downloadSvg(mazeSvgRef.current, `maze-${tilingWidth}x${tilingHeight}.svg`);
  }, [tilingWidth, tilingHeight]);
  
  // Highlight navigation
  const handlePrevPlacement = useCallback(() => {
    if (!tilingResult?.placements?.length) return;
    setHighlightedEdge(null);
    setHighlightedPlacement(prev => {
      if (prev === null) return tilingResult.placements!.length - 1;
      return (prev - 1 + tilingResult.placements!.length) % tilingResult.placements!.length;
    });
  }, [tilingResult]);
  
  const handleNextPlacement = useCallback(() => {
    if (!tilingResult?.placements?.length) return;
    setHighlightedEdge(null);
    setHighlightedPlacement(prev => {
      if (prev === null) return 0;
      return (prev + 1) % tilingResult.placements!.length;
    });
  }, [tilingResult]);
  
  const handleClearHighlight = useCallback(() => {
    setHighlightedPlacement(null);
    setHighlightedEdge(null);
  }, []);
  
  // Edge cycling handlers
  const handlePrevEdge = useCallback(() => {
    if (highlightedPlacement === null || !tilingResult?.placements?.[highlightedPlacement]) return;
    const numCells = tilingResult.placements[highlightedPlacement].cells.length;
    const totalEdges = numCells * 6;
    setHighlightedEdge(prev => {
      if (prev === null) return totalEdges - 1;
      return (prev - 1 + totalEdges) % totalEdges;
    });
  }, [highlightedPlacement, tilingResult]);
  
  const handleNextEdge = useCallback(() => {
    if (highlightedPlacement === null || !tilingResult?.placements?.[highlightedPlacement]) return;
    const numCells = tilingResult.placements[highlightedPlacement].cells.length;
    const totalEdges = numCells * 6;
    setHighlightedEdge(prev => {
      if (prev === null) return 0;
      return (prev + 1) % totalEdges;
    });
  }, [highlightedPlacement, tilingResult]);
  
  const handleClearEdge = useCallback(() => {
    setHighlightedEdge(null);
  }, []);
  
  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);
  
  // Check edge adjacency consistency when tiling result changes
  useEffect(() => {
    if (!tilingResult || !tilingResult.placements || !solvedPolyformType) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting derived state when inputs become invalid
      setEdgeViolations([]);
      setAllEdges([]);
      setSelectedEdgeIndex(null);
      return;
    }

    const gridDef = getGridDef(solvedPolyformType);
    const tilesWithContent = tiles.filter(tile =>
      tile.cells.some(row => row.some(c => c))
    );

    const hasAnyEdges = tilesWithContent.some(tile =>
      tile.edgeState.some(row =>
        row.some(cellEdges => cellEdges.some(filled => filled))
      )
    );

    if (!hasAnyEdges) {
      setEdgeViolations([]);
      setAllEdges([]);
      setSelectedEdgeIndex(null);
      return;
    }

    const normalizedEdgeStates = tilesWithContent.map(tile =>
      normalizeEdgeState(gridDef, tile.cells, tile.edgeState)
    );

    const violations = checkEdgeAdjacencyConsistency(
      gridDef,
      tilingResult.placements,
      normalizedEdgeStates
    );

    const edges = getAllEdges(
      gridDef,
      tilingResult.placements,
      normalizedEdgeStates
    );

    setEdgeViolations(violations);
    setAllEdges(edges);
    setSelectedEdgeIndex(null);
  }, [tilingResult, solvedPolyformType, tiles]);
  
  // Validate and apply tiling width on blur
  const handleTilingWidthBlur = useCallback(() => {
    const parsed = parseInt(tilingWidthInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
      setTilingWidthError(false);
      setTilingWidth(parsed);
    } else {
      setTilingWidthError(true);
    }
  }, [tilingWidthInput]);
  
  // Validate and apply tiling height on blur
  const handleTilingHeightBlur = useCallback(() => {
    const parsed = parseInt(tilingHeightInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
      setTilingHeightError(false);
      setTilingHeight(parsed);
    } else {
      setTilingHeightError(true);
    }
  }, [tilingHeightInput]);
  
  // Cancel solving (kill worker)
  const handleCancelSolving = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
      setSolving(false);
      setTilingError("Solving cancelled by user.");
      setTilingStats(null);
    }
  }, []);
  
  // Solve tiling problem
  const handleSolveTiling = useCallback(() => {
    const tileIndicesWithContent = tiles
      .map((tile, index) => ({ tile, index }))
      .filter(({ tile }) => tile.cells.some(row => row.some(c => c)))
      .map(({ index }) => index);
    
    if (tileIndicesWithContent.length === 0) {
      setTilingError("Please draw at least one tile first by clicking cells above.");
      return;
    }
    
    const tilesWithContent = tileIndicesWithContent.map(i => tiles[i].cells);
    const edgeStatesForTiles = tileIndicesWithContent.map(i => tiles[i].edgeState);
    
    setTilingResult(null);
    setTilingError(null);
    setTilingStats(null);
    setSolvedPolyformType(null);
    setMazeResult(null);
    setHexMazeResult(null);
    setTriMazeResult(null);
    setSolving(true);
    
    const worker = new Worker(
      new URL("../problem/polyomino-tiling.worker.ts", import.meta.url),
      { type: "module" }
    );
    workerRef.current = worker;
    
    worker.onmessage = (event) => {
      const response = event.data;
      
      if (response.messageType === "progress") {
        setTilingStats(response.stats);
      } else if (response.messageType === "result") {
        setSolving(false);
        if (response.success) {
          setTilingResult(response.result);
          setSolvedPolyformType(response.polyformType || "polyomino");
        } else {
          setTilingError(response.error || "Unknown error");
        }
        worker.terminate();
        workerRef.current = null;
      }
    };
    
    worker.onerror = (error) => {
      setSolving(false);
      setTilingError(`Worker error: ${error.message}`);
      worker.terminate();
      workerRef.current = null;
    };
    
    worker.postMessage({
      tiles: tilesWithContent,
      tilingWidth,
      tilingHeight,
      polyformType,
      edgeStates: edgeStatesForTiles,
    });
  }, [tiles, tilingWidth, tilingHeight, polyformType]);
  
  return {
    // State
    tilingWidthInput,
    tilingHeightInput,
    tilingWidth,
    tilingHeight,
    tilingWidthError,
    tilingHeightError,
    solving,
    tilingResult,
    tilingError,
    tilingStats,
    solvedPolyformType,
    highlightedPlacement,
    highlightedEdge,
    edgeInfo,
    hideFills,
    edgeViolations,
    allEdges,
    selectedEdgeIndex,
    showDebugSide,
    edgeFilter,
    mazeResult,
    hexMazeResult,
    triMazeResult,
    tilingSvgRef,
    mazeSvgRef,
    
    // Setters
    setTilingWidthInput,
    setTilingHeightInput,
    setTilingWidthError,
    setTilingHeightError,
    setEdgeInfo,
    setHideFills,
    setSelectedEdgeIndex,
    setShowDebugSide,
    setEdgeFilter,
    
    // Handlers
    handleTilingWidthBlur,
    handleTilingHeightBlur,
    handleSolveTiling,
    handleCancelSolving,
    handleDownloadSvg,
    handleDownloadPlacementsJson,
    handleGenerateMaze,
    handleGenerateHexMaze,
    handleGenerateTriMaze,
    handleDownloadMazeSvg,
    handlePrevPlacement,
    handleNextPlacement,
    handleClearHighlight,
    handlePrevEdge,
    handleNextEdge,
    handleClearEdge,
  };
}
