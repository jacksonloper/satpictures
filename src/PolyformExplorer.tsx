import { useState, useCallback, useMemo } from "react";
import "./App.css";
import {
  type PolyformType,
  createEmptyBooleanGrid,
} from "./utils/polyformTransforms";
import {
  parseCoordsJson,
  PolyformControls,
  type EdgeState,
  createEmptyEdgeState,
  rotateCellsAndEdges,
  flipCellsAndEdges,
  UnifiedGridEditor,
} from "./polyform-explorer";
import { TileTabs } from "./polyform-explorer/TileTabs";
import { TilingSection } from "./polyform-explorer/TilingSection";
import { useTilingSolver } from "./polyform-explorer/useTilingSolver";
import {
  getGridDef,
  type TileState,
  createEmptyTileState,
} from "./PolyformExplorerHelpers";

/** Editor mode for the grid */
type EditorMode = 'cell' | 'edge';

export function PolyformExplorer() {
  const [polyformType, setPolyformType] = useState<PolyformType>("polyomino");
  const [editorMode, setEditorMode] = useState<EditorMode>('cell');
  
  // Multi-tile state: array of tiles and the currently active tile index
  const [tiles, setTiles] = useState<TileState[]>(() => [createEmptyTileState(8, 8, 'polyomino')]);
  const [activeTileIndex, setActiveTileIndex] = useState(0);
  
  // Derived state for the active tile (for convenience)
  // Use a safe fallback in case activeTileIndex is temporarily out of bounds during state transitions
  const activeTile = tiles[activeTileIndex] ?? tiles[0] ?? createEmptyTileState(8, 8, polyformType);
  const gridWidth = activeTile.gridWidth;
  const gridHeight = activeTile.gridHeight;
  const cells = activeTile.cells;
  const edgeState = activeTile.edgeState;
  const widthInput = activeTile.widthInput;
  const heightInput = activeTile.heightInput;
  const widthError = activeTile.widthError;
  const heightError = activeTile.heightError;

  // Compute all tile edge states and cells for multi-tile rendering
  // These arrays are indexed by tile type (matching tileTypeIndex in placements)
  const allTileData = useMemo(() => {
    const tilesWithContent = tiles
      .map((tile, index) => ({ tile, index }))
      .filter(({ tile }) => tile.cells.some(row => row.some(c => c)));

    const allEdgeStates: EdgeState[] = [];
    const allTileCells: Array<Array<{ row: number; col: number }>> = [];

    for (const { tile } of tilesWithContent) {
      allEdgeStates.push(tile.edgeState);

      const coords: Array<{ row: number; col: number }> = [];
      for (let row = 0; row < tile.cells.length; row++) {
        for (let col = 0; col < tile.cells[row].length; col++) {
          if (tile.cells[row][col]) {
            coords.push({ row, col });
          }
        }
      }
      allTileCells.push(coords);
    }

    return { allEdgeStates, allTileCells };
  }, [tiles]);
  
  // Setter helpers that update the active tile
  const updateActiveTile = useCallback((updates: Partial<TileState>) => {
    setTiles(prev => prev.map((tile, i) => 
      i === activeTileIndex ? { ...tile, ...updates } : tile
    ));
  }, [activeTileIndex]);
  
  const setCells = useCallback((updater: boolean[][] | ((prev: boolean[][]) => boolean[][])) => {
    setTiles(prev => prev.map((tile, i) => {
      if (i !== activeTileIndex) return tile;
      const newCells = typeof updater === 'function' ? updater(tile.cells) : updater;
      return { ...tile, cells: newCells };
    }));
  }, [activeTileIndex]);
  
  const setEdgeState = useCallback((updater: EdgeState | ((prev: EdgeState) => EdgeState)) => {
    setTiles(prev => prev.map((tile, i) => {
      if (i !== activeTileIndex) return tile;
      const newEdgeState = typeof updater === 'function' ? updater(tile.edgeState) : updater;
      return { ...tile, edgeState: newEdgeState };
    }));
  }, [activeTileIndex]);
  
  const setGridWidth = useCallback((width: number) => {
    updateActiveTile({ gridWidth: width });
  }, [updateActiveTile]);
  
  const setGridHeight = useCallback((height: number) => {
    updateActiveTile({ gridHeight: height });
  }, [updateActiveTile]);
  
  const setWidthInput = useCallback((value: string) => {
    updateActiveTile({ widthInput: value });
  }, [updateActiveTile]);
  
  const setHeightInput = useCallback((value: string) => {
    updateActiveTile({ heightInput: value });
  }, [updateActiveTile]);
  
  const setWidthError = useCallback((value: boolean) => {
    updateActiveTile({ widthError: value });
  }, [updateActiveTile]);
  
  const setHeightError = useCallback((value: boolean) => {
    updateActiveTile({ heightError: value });
  }, [updateActiveTile]);
  
  // Tiling solver hook (state and callbacks for tiling solver)
  const tilingSolver = useTilingSolver({ tiles, polyformType });
  
  // Coords JSON state for import/export
  const [coordsJsonInput, setCoordsJsonInput] = useState("");

  // Export all tiles with edges as JSON
  const handleExportTileCoords = useCallback(() => {
    const tilesWithContent = tiles
      .map((tile, index) => ({ tile, index }))
      .filter(({ tile }) => tile.cells.some(row => row.some(c => c)));

    if (tilesWithContent.length === 0) {
      alert("No tiles to export");
      return;
    }

    const exportData = {
      polyformType,
      tiles: tilesWithContent.map(({ tile }) => {
        const coords: Array<{ row: number; col: number }> = [];
        for (let row = 0; row < tile.cells.length; row++) {
          for (let col = 0; col < tile.cells[row].length; col++) {
            if (tile.cells[row][col]) {
              coords.push({ row, col });
            }
          }
        }

        const edges: Array<{ row: number; col: number; edgeIndex: number }> = [];
        for (let row = 0; row < tile.edgeState.length; row++) {
          for (let col = 0; col < tile.edgeState[row].length; col++) {
            if (tile.cells[row]?.[col]) {
              const cellEdges = tile.edgeState[row][col];
              for (let edgeIndex = 0; edgeIndex < cellEdges.length; edgeIndex++) {
                if (cellEdges[edgeIndex]) {
                  edges.push({ row, col, edgeIndex });
                }
              }
            }
          }
        }

        return { coords, edges };
      }),
    };

    const json = JSON.stringify(exportData, null, 2);
    const totalCells = exportData.tiles.reduce((sum, t) => sum + t.coords.length, 0);
    const totalEdges = exportData.tiles.reduce((sum, t) => sum + t.edges.length, 0);

    navigator.clipboard.writeText(json).then(() => {
      alert(`Copied ${tilesWithContent.length} tile(s) with ${totalCells} cells and ${totalEdges} edges to clipboard!`);
    }).catch(() => {
      prompt("Copy this JSON:", json);
    });
  }, [tiles, polyformType]);
  
  // Import tile coordinates from JSON
  const handleImportTileCoords = useCallback(() => {
    const result = parseCoordsJson(coordsJsonInput);
    if (!result) {
      alert("Invalid JSON: expected an array of {row, col} objects with numeric values");
      return;
    }
    
    const { coords, maxRow, maxCol } = result;
    
    const newWidth = Math.max(maxCol + 1, 3);
    const newHeight = Math.max(maxRow + 1, 3);
    const newCells = createEmptyBooleanGrid(newWidth, newHeight);
    
    for (const { row, col } of coords) {
      if (row >= 0 && row < newHeight && col >= 0 && col < newWidth) {
        newCells[row][col] = true;
      }
    }
    
    setGridWidth(newWidth);
    setGridHeight(newHeight);
    setWidthInput(String(newWidth));
    setHeightInput(String(newHeight));
    setCells(newCells);
    setCoordsJsonInput("");
    alert(`Imported ${coords.length} coordinates`);
  }, [coordsJsonInput, setGridWidth, setGridHeight, setWidthInput, setHeightInput, setCells]);
  
  // Validate and apply width on blur
  const handleWidthBlur = useCallback(() => {
    const parsed = parseInt(widthInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
      setWidthError(false);
      if (parsed !== gridWidth) {
        setGridWidth(parsed);
        // Resize grid, preserving existing cells where possible
        setCells(prev => {
          const newCells = createEmptyBooleanGrid(parsed, gridHeight);
          for (let row = 0; row < Math.min(prev.length, gridHeight); row++) {
            for (let col = 0; col < Math.min(prev[row].length, parsed); col++) {
              newCells[row][col] = prev[row][col];
            }
          }
          return newCells;
        });
      }
    } else {
      setWidthError(true);
    }
  }, [widthInput, gridWidth, gridHeight, setWidthError, setGridWidth, setCells]);
  
  // Validate and apply height on blur
  const handleHeightBlur = useCallback(() => {
    const parsed = parseInt(heightInput, 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 50) {
      setHeightError(false);
      if (parsed !== gridHeight) {
        setGridHeight(parsed);
        // Resize grid, preserving existing cells where possible
        setCells(prev => {
          const newCells = createEmptyBooleanGrid(gridWidth, parsed);
          for (let row = 0; row < Math.min(prev.length, parsed); row++) {
            for (let col = 0; col < Math.min(prev[row].length, gridWidth); col++) {
              newCells[row][col] = prev[row][col];
            }
          }
          return newCells;
        });
      }
    } else {
      setHeightError(true);
    }
  }, [heightInput, gridHeight, gridWidth, setHeightError, setGridHeight, setCells]);
  
  // Toggle cell on click
  const handleCellClick = useCallback((row: number, col: number) => {
    setCells(prev => {
      const newCells = prev.map(r => [...r]);
      newCells[row][col] = !newCells[row][col];
      return newCells;
    });
  }, [setCells]);
  
  // Toggle edge on click
  const handleEdgeClick = useCallback((row: number, col: number, edgeIndex: number) => {
    setEdgeState(prev => {
      const newEdgeState = prev.map(r => r.map(c => [...c]));
      if (newEdgeState[row]?.[col]) {
        newEdgeState[row][col][edgeIndex] = !newEdgeState[row][col][edgeIndex];
      }
      return newEdgeState;
    });
  }, [setEdgeState]);
  
  // Rotate the polyform (transforms cells and edges together to keep them aligned)
  const handleRotate = useCallback(() => {
    const grid = getGridDef(polyformType);
    
    // We need the current edge state to transform together with cells
    setTiles(prevTiles => prevTiles.map((tile, i) => {
      if (i !== activeTileIndex) return tile;
      
      const { cells: rotatedCells, edgeState: rotatedEdges } = rotateCellsAndEdges(
        grid, tile.cells, tile.edgeState
      );
      
      const newHeight = Math.min(rotatedCells.length, 50);
      const newWidth = Math.min(rotatedCells[0]?.length ?? 0, 50);
      
      return {
        ...tile,
        cells: rotatedCells,
        edgeState: rotatedEdges,
        gridWidth: newWidth,
        gridHeight: newHeight,
        widthInput: String(newWidth),
        heightInput: String(newHeight),
      };
    }));
    
    // Also update the top-level grid dimensions for display
    setTiles(prevTiles => {
      const tile = prevTiles[activeTileIndex];
      if (tile) {
        setGridHeight(tile.gridHeight);
        setGridWidth(tile.gridWidth);
        setHeightInput(tile.heightInput);
        setWidthInput(tile.widthInput);
        setWidthError(false);
        setHeightError(false);
      }
      return prevTiles;
    });
  }, [polyformType, activeTileIndex, setTiles, setGridHeight, setGridWidth, setHeightInput, setWidthInput, setWidthError, setHeightError]);
  
  // Flip horizontally (transforms cells and edges together to keep them aligned)
  const handleFlipH = useCallback(() => {
    const grid = getGridDef(polyformType);
    
    setTiles(prevTiles => prevTiles.map((tile, i) => {
      if (i !== activeTileIndex) return tile;
      
      const { cells: flippedCells, edgeState: flippedEdges } = flipCellsAndEdges(
        grid, tile.cells, tile.edgeState
      );
      
      const newHeight = Math.min(flippedCells.length, 50);
      const newWidth = Math.min(flippedCells[0]?.length ?? 0, 50);
      
      return {
        ...tile,
        cells: flippedCells,
        edgeState: flippedEdges,
        gridWidth: newWidth,
        gridHeight: newHeight,
        widthInput: String(newWidth),
        heightInput: String(newHeight),
      };
    }));
    
    setTiles(prevTiles => {
      const tile = prevTiles[activeTileIndex];
      if (tile) {
        setGridHeight(tile.gridHeight);
        setGridWidth(tile.gridWidth);
        setHeightInput(tile.heightInput);
        setWidthInput(tile.widthInput);
        setWidthError(false);
        setHeightError(false);
      }
      return prevTiles;
    });
  }, [polyformType, activeTileIndex, setTiles, setGridHeight, setGridWidth, setHeightInput, setWidthInput, setWidthError, setHeightError]);
  
  // Flip vertically (transforms cells and edges together)
  // Vertical flip = horizontal flip followed by 180° rotation.
  const handleFlipV = useCallback(() => {
    const grid = getGridDef(polyformType);
    
    setTiles(prevTiles => prevTiles.map((tile, i) => {
      if (i !== activeTileIndex) return tile;
      
      // First flip horizontally
      let { cells: currentCells, edgeState: currentEdges } = flipCellsAndEdges(
        grid, tile.cells, tile.edgeState
      );
      // Then rotate 180° (half of total rotations)
      const halfRotations = Math.floor(grid.numRotations / 2);
      for (let j = 0; j < halfRotations; j++) {
        const result = rotateCellsAndEdges(grid, currentCells, currentEdges);
        currentCells = result.cells;
        currentEdges = result.edgeState;
      }
      
      const newHeight = Math.min(currentCells.length, 50);
      const newWidth = Math.min(currentCells[0]?.length ?? 0, 50);
      
      return {
        ...tile,
        cells: currentCells,
        edgeState: currentEdges,
        gridWidth: newWidth,
        gridHeight: newHeight,
        widthInput: String(newWidth),
        heightInput: String(newHeight),
      };
    }));
    
    setTiles(prevTiles => {
      const tile = prevTiles[activeTileIndex];
      if (tile) {
        setGridHeight(tile.gridHeight);
        setGridWidth(tile.gridWidth);
        setHeightInput(tile.heightInput);
        setWidthInput(tile.widthInput);
        setWidthError(false);
        setHeightError(false);
      }
      return prevTiles;
    });
  }, [polyformType, activeTileIndex, setTiles, setGridHeight, setGridWidth, setHeightInput, setWidthInput, setWidthError, setHeightError]);
  
  // Clear the grid
  const handleClear = useCallback(() => {
    const grid = getGridDef(polyformType);
    setCells(createEmptyBooleanGrid(gridWidth, gridHeight));
    setEdgeState(createEmptyEdgeState(grid, gridWidth, gridHeight));
  }, [gridWidth, gridHeight, polyformType, setCells, setEdgeState]);
  
  // Change polyform type
  const handleTypeChange = useCallback((newType: PolyformType) => {
    setPolyformType(newType);
    // Reset all tiles when changing type (with correct edge state for new type)
    setTiles([createEmptyTileState(8, 8, newType)]);
    setActiveTileIndex(0);
  }, []);
  
  // Add a new tile
  const handleAddTile = useCallback(() => {
    setTiles(prev => {
      const newTiles = [...prev, createEmptyTileState(8, 8, polyformType)];
      // Use setTimeout to set the active index after the state update
      // to avoid stale closure issues
      setActiveTileIndex(newTiles.length - 1);
      return newTiles;
    });
  }, [polyformType]);
  
  // Remove the active tile (if there's more than one)
  const handleRemoveTile = useCallback(() => {
    setTiles(prev => {
      if (prev.length <= 1) return prev;
      const newTiles = prev.filter((_, i) => i !== activeTileIndex);
      // Adjust active index if it's now out of bounds
      if (activeTileIndex >= newTiles.length) {
        setActiveTileIndex(newTiles.length - 1);
      }
      return newTiles;
    });
  }, [activeTileIndex]);
  
  // Switch to a specific tile
  const handleSelectTile = useCallback((index: number) => {
    setTiles(prev => {
      if (index >= 0 && index < prev.length) {
        setActiveTileIndex(index);
      }
      return prev;
    });
  }, []);
  
  // Count filled cells
  const filledCount = useMemo(() => {
    let count = 0;
    for (const row of cells) {
      for (const cell of row) {
        if (cell) count++;
      }
    }
    return count;
  }, [cells]);
  
  return (
    <div className="app">
      <h1>🧩 Polyform Explorer</h1>
      <p className="description">
        Build polyforms by clicking cells to toggle them on/off. 
        Use the rotation and flip buttons to transform your shape.
      </p>
      

      {/* Controls */}
      <PolyformControls
        polyformType={polyformType}
        onTypeChange={handleTypeChange}
        widthInput={widthInput}
        heightInput={heightInput}
        widthError={widthError}
        heightError={heightError}
        onWidthInputChange={(v) => { setWidthInput(v); setWidthError(false); }}
        onHeightInputChange={(v) => { setHeightInput(v); setHeightError(false); }}
        onWidthBlur={handleWidthBlur}
        onHeightBlur={handleHeightBlur}
        onRotate={handleRotate}
        onFlipH={handleFlipH}
        onFlipV={handleFlipV}
        onClear={handleClear}
        onExportTileCoords={handleExportTileCoords}
        coordsJsonInput={coordsJsonInput}
        onCoordsJsonInputChange={setCoordsJsonInput}
        onImportTileCoords={handleImportTileCoords}
        filledCount={filledCount}
      />

      {/* Tile Tabs Navigation */}
      <TileTabs
        tiles={tiles}
        activeTileIndex={activeTileIndex}
        onSelectTile={handleSelectTile}
        onAddTile={handleAddTile}
        onRemoveTile={handleRemoveTile}
      />

      {/* Editor Mode Toggle */}
      <div style={{ marginBottom: "16px", display: "flex", gap: "8px", alignItems: "center" }}>
        <label style={{ fontWeight: "bold" }}>Mode:</label>
        <button
          onClick={() => setEditorMode('cell')}
          style={{
            padding: "8px 16px",
            backgroundColor: editorMode === 'cell' ? "#3498db" : "#ecf0f1",
            color: editorMode === 'cell' ? "white" : "#333",
            border: "1px solid #bdc3c7",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: editorMode === 'cell' ? "bold" : "normal",
          }}
        >
          🔲 Cells
        </button>
        <button
          onClick={() => setEditorMode('edge')}
          style={{
            padding: "8px 16px",
            backgroundColor: editorMode === 'edge' ? "#f39c12" : "#ecf0f1",
            color: editorMode === 'edge' ? "white" : "#333",
            border: "1px solid #bdc3c7",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: editorMode === 'edge' ? "bold" : "normal",
          }}
        >
          ➖ Edges
        </button>
        {editorMode === 'edge' && (
          <span style={{ fontSize: "12px", color: "#7f8c8d" }}>
            Click edges to mark them (shown in orange)
          </span>
        )}
      </div>
      
      {/* Grid - Using unified component for all grid types */}
      <div style={{ 
        padding: "16px", 
        backgroundColor: "#f8f9fa", 
        borderRadius: "8px",
        border: `2px solid ${editorMode === 'edge' ? '#f39c12' : '#3498db'}`,
        display: "inline-block",
      }}>
        <UnifiedGridEditor
          grid={getGridDef(polyformType)}
          cells={cells}
          onCellClick={handleCellClick}
          mode={editorMode}
          edgeState={edgeState}
          onEdgeClick={handleEdgeClick}
        />
      </div>
      
      {/* Tiling Solver Section */}
      <TilingSection
        tilingWidthInput={tilingSolver.tilingWidthInput}
        tilingHeightInput={tilingSolver.tilingHeightInput}
        tilingWidthError={tilingSolver.tilingWidthError}
        tilingHeightError={tilingSolver.tilingHeightError}
        tilingWidth={tilingSolver.tilingWidth}
        tilingHeight={tilingSolver.tilingHeight}
        solving={tilingSolver.solving}
        tilingStats={tilingSolver.tilingStats}
        tilingError={tilingSolver.tilingError}
        tilingResult={tilingSolver.tilingResult}
        solvedPolyformType={tilingSolver.solvedPolyformType}
        allTileData={allTileData}
        edgeViolations={tilingSolver.edgeViolations}
        allEdges={tilingSolver.allEdges}
        selectedEdgeIndex={tilingSolver.selectedEdgeIndex}
        showDebugSide={tilingSolver.showDebugSide}
        edgeFilter={tilingSolver.edgeFilter}
        highlightedPlacement={tilingSolver.highlightedPlacement}
        highlightedEdge={tilingSolver.highlightedEdge}
        edgeInfo={tilingSolver.edgeInfo}
        hideFills={tilingSolver.hideFills}
        mazeResult={tilingSolver.mazeResult}
        hexMazeResult={tilingSolver.hexMazeResult}
        triMazeResult={tilingSolver.triMazeResult}
        tilingSvgRef={tilingSolver.tilingSvgRef}
        mazeSvgRef={tilingSolver.mazeSvgRef}
        onTilingWidthInputChange={tilingSolver.setTilingWidthInput}
        onTilingHeightInputChange={tilingSolver.setTilingHeightInput}
        onTilingWidthBlur={tilingSolver.handleTilingWidthBlur}
        onTilingHeightBlur={tilingSolver.handleTilingHeightBlur}
        setTilingWidthError={tilingSolver.setTilingWidthError}
        setTilingHeightError={tilingSolver.setTilingHeightError}
        onSolveTiling={tilingSolver.handleSolveTiling}
        onCancelSolving={tilingSolver.handleCancelSolving}
        setSelectedEdgeIndex={tilingSolver.setSelectedEdgeIndex}
        setShowDebugSide={tilingSolver.setShowDebugSide}
        setEdgeFilter={tilingSolver.setEdgeFilter}
        setEdgeInfo={tilingSolver.setEdgeInfo}
        onPrevPlacement={tilingSolver.handlePrevPlacement}
        onNextPlacement={tilingSolver.handleNextPlacement}
        onClearHighlight={tilingSolver.handleClearHighlight}
        setHideFills={tilingSolver.setHideFills}
        onPrevEdge={tilingSolver.handlePrevEdge}
        onNextEdge={tilingSolver.handleNextEdge}
        onClearEdge={tilingSolver.handleClearEdge}
        onDownloadSvg={tilingSolver.handleDownloadSvg}
        onDownloadPlacementsJson={tilingSolver.handleDownloadPlacementsJson}
        onGenerateMaze={tilingSolver.handleGenerateMaze}
        onGenerateHexMaze={tilingSolver.handleGenerateHexMaze}
        onGenerateTriMaze={tilingSolver.handleGenerateTriMaze}
        onDownloadMazeSvg={tilingSolver.handleDownloadMazeSvg}
      />
    </div>
  );
}

export default PolyformExplorer;
