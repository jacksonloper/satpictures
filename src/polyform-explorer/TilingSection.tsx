import type { RefObject } from "react";
import type { UnifiedTilingResult } from "./grids/unifiedTiling";
import type { PolyformType } from "../utils/polyformTransforms";
import {
  TilingViewer,
  HexTilingViewer,
  TriTilingViewer,
  type EdgeState,
  type EdgeAdjacencyViolation,
  type UnifiedEdgeInfo,
  type MazeResult,
  type HexMazeResult,
  type TriMazeResult,
} from "../polyform-explorer";
import {
  toSquarePlacements,
  toHexPlacements,
  toTriPlacements,
} from "../PolyformExplorerHelpers";
import { MazeResultSection } from "./MazeResultSection";
import { TilingSizeInputs } from "./TilingSizeInputs";
import { TilingStatusDisplay } from "./TilingStatusDisplay";
import { EdgeDebuggerPanel } from "./EdgeDebuggerPanel";
import { PlacementControls } from "./PlacementControls";
import { EdgeDebuggingControls } from "./EdgeDebuggingControls";
import { TilingDownloadButtons } from "./TilingDownloadButtons";

export interface TilingSectionProps {
  // Tiling solver inputs
  tilingWidthInput: string;
  tilingHeightInput: string;
  tilingWidthError: boolean;
  tilingHeightError: boolean;
  tilingWidth: number;
  tilingHeight: number;
  solving: boolean;
  tilingStats: { numVars: number; numClauses: number } | null;
  tilingError: string | null;
  tilingResult: UnifiedTilingResult | null;
  solvedPolyformType: PolyformType | null;

  // Edge state data for multi-tile rendering
  allTileData: {
    allEdgeStates: EdgeState[];
    allTileCells: Array<Array<{ row: number; col: number }>>;
  };

  // Debugging state
  edgeViolations: EdgeAdjacencyViolation[];
  allEdges: UnifiedEdgeInfo[];
  selectedEdgeIndex: number | null;
  showDebugSide: "A" | "B";
  edgeFilter: "all" | "violations" | "consistent";
  highlightedPlacement: number | null;
  highlightedEdge: number | null;
  edgeInfo: {
    cellIndex: number;
    edgeIndex: number;
    isInternal: boolean;
    coord1: { q: number; r: number };
    coord2: { q: number; r: number } | null;
    direction: string;
  } | null;
  hideFills: boolean;

  // Maze state
  mazeResult: MazeResult | null;
  hexMazeResult: HexMazeResult | null;
  triMazeResult: TriMazeResult | null;

  // Refs
  tilingSvgRef: RefObject<SVGSVGElement | null>;
  mazeSvgRef: RefObject<SVGSVGElement | null>;

  // Callbacks
  onTilingWidthInputChange: (value: string) => void;
  onTilingHeightInputChange: (value: string) => void;
  onTilingWidthBlur: () => void;
  onTilingHeightBlur: () => void;
  setTilingWidthError: (value: boolean) => void;
  setTilingHeightError: (value: boolean) => void;
  onSolveTiling: () => void;
  onCancelSolving: () => void;
  setSelectedEdgeIndex: (value: number | null) => void;
  setShowDebugSide: (value: "A" | "B") => void;
  setEdgeFilter: (value: "all" | "violations" | "consistent") => void;
  setEdgeInfo: (
    info: {
      cellIndex: number;
      edgeIndex: number;
      isInternal: boolean;
      coord1: { q: number; r: number };
      coord2: { q: number; r: number } | null;
      direction: string;
    } | null
  ) => void;
  onPrevPlacement: () => void;
  onNextPlacement: () => void;
  onClearHighlight: () => void;
  setHideFills: (value: boolean) => void;
  onPrevEdge: () => void;
  onNextEdge: () => void;
  onClearEdge: () => void;
  onDownloadSvg: () => void;
  onDownloadPlacementsJson: () => void;
  onGenerateMaze: () => void;
  onGenerateHexMaze: () => void;
  onGenerateTriMaze: () => void;
  onDownloadMazeSvg: () => void;
}

export function TilingSection({
  tilingWidthInput,
  tilingHeightInput,
  tilingWidthError,
  tilingHeightError,
  tilingWidth,
  tilingHeight,
  solving,
  tilingStats,
  tilingError,
  tilingResult,
  solvedPolyformType,
  allTileData,
  edgeViolations,
  allEdges,
  selectedEdgeIndex,
  showDebugSide,
  edgeFilter,
  highlightedPlacement,
  highlightedEdge,
  edgeInfo,
  hideFills,
  mazeResult,
  hexMazeResult,
  triMazeResult,
  tilingSvgRef,
  mazeSvgRef,
  onTilingWidthInputChange,
  onTilingHeightInputChange,
  onTilingWidthBlur,
  onTilingHeightBlur,
  setTilingWidthError,
  setTilingHeightError,
  onSolveTiling,
  onCancelSolving,
  setSelectedEdgeIndex,
  setShowDebugSide,
  setEdgeFilter,
  setEdgeInfo,
  onPrevPlacement,
  onNextPlacement,
  onClearHighlight,
  setHideFills,
  onPrevEdge,
  onNextEdge,
  onClearEdge,
  onDownloadSvg,
  onDownloadPlacementsJson,
  onGenerateMaze,
  onGenerateHexMaze,
  onGenerateTriMaze,
  onDownloadMazeSvg,
}: TilingSectionProps) {
  return (
    <div
      style={{
        marginTop: "24px",
        padding: "16px",
        backgroundColor: "#f8f9fa",
        borderRadius: "8px",
        border: "1px solid #dee2e6",
      }}
    >
      <h3 style={{ marginTop: 0, marginBottom: "12px" }}>🧩 Tiling Solver</h3>
      <p style={{ fontSize: "14px", color: "#6c757d", marginBottom: "16px" }}>
        Try to tile a grid of the specified size using rotations, translations,
        and flips of your polyform.
      </p>

      {/* Tiling Grid Size Inputs */}
      <TilingSizeInputs
        tilingWidthInput={tilingWidthInput}
        tilingHeightInput={tilingHeightInput}
        tilingWidthError={tilingWidthError}
        tilingHeightError={tilingHeightError}
        solving={solving}
        onTilingWidthInputChange={onTilingWidthInputChange}
        onTilingHeightInputChange={onTilingHeightInputChange}
        onTilingWidthBlur={onTilingWidthBlur}
        onTilingHeightBlur={onTilingHeightBlur}
        setTilingWidthError={setTilingWidthError}
        setTilingHeightError={setTilingHeightError}
        onSolveTiling={onSolveTiling}
        onCancelSolving={onCancelSolving}
      />

      {/* Progress/Stats and Error display */}
      <TilingStatusDisplay
        solving={solving}
        tilingStats={tilingStats}
        tilingError={tilingError}
      />

      {/* Result display */}
      {tilingResult && (
        <div style={{ marginTop: "16px" }}>
          {tilingResult.satisfiable ? (
            <>
              <div
                style={{
                  padding: "12px",
                  backgroundColor: "#d4edda",
                  borderRadius: "4px",
                  marginBottom: "12px",
                  color: "#155724",
                  fontSize: "14px",
                }}
              >
                ✅ <strong>Solution found!</strong> Using{" "}
                {tilingResult.placements?.length ?? 0} tile placements.
                {tilingResult.tileTypeCounts &&
                  tilingResult.tileTypeCounts.length > 1 && (
                    <>
                      <br />
                      <span style={{ fontSize: "12px", color: "#155724" }}>
                        {tilingResult.tileTypeCounts
                          .map((count, index) => `Tile ${index + 1}: ${count}`)
                          .join(" • ")}
                      </span>
                    </>
                  )}
                <br />
                <span style={{ fontSize: "12px", color: "#6c757d" }}>
                  ({tilingResult.stats.numPlacements.toLocaleString()} total
                  possible placements,{" "}
                  {tilingResult.stats.numVariables.toLocaleString()} vars,{" "}
                  {tilingResult.stats.numClauses.toLocaleString()} clauses)
                </span>
              </div>

              {/* Red warning for edge adjacency violations */}
              {edgeViolations.length > 0 && (
                <div
                  style={{
                    padding: "12px",
                    backgroundColor: "#f8d7da",
                    border: "1px solid #f5c6cb",
                    borderRadius: "4px",
                    marginBottom: "12px",
                    color: "#721c24",
                    fontSize: "14px",
                  }}
                >
                  ⚠️ <strong>Edge Adjacency Violations Detected!</strong>
                  <br />
                  <span style={{ fontSize: "12px" }}>
                    {edgeViolations.length} edge
                    {edgeViolations.length === 1 ? "" : "s"} have inconsistent
                    filledness values between adjacent tiles.
                  </span>
                </div>
              )}

              {/* Edge Debugger - shows ALL edges */}
              <EdgeDebuggerPanel
                allEdges={allEdges}
                selectedEdgeIndex={selectedEdgeIndex}
                showDebugSide={showDebugSide}
                edgeFilter={edgeFilter}
                setSelectedEdgeIndex={setSelectedEdgeIndex}
                setShowDebugSide={setShowDebugSide}
                setEdgeFilter={setEdgeFilter}
              />

              {solvedPolyformType === "polyhex" ? (
                <HexTilingViewer
                  width={tilingWidth}
                  height={tilingHeight}
                  placements={toHexPlacements(tilingResult.placements || [])}
                  svgRef={tilingSvgRef}
                  highlightedPlacement={highlightedPlacement}
                  highlightedEdge={highlightedEdge}
                  onEdgeInfo={setEdgeInfo}
                  hideFills={hideFills}
                />
              ) : solvedPolyformType === "polyiamond" ? (
                <TriTilingViewer
                  width={tilingWidth}
                  height={tilingHeight}
                  placements={toTriPlacements(tilingResult.placements || [])}
                  svgRef={tilingSvgRef}
                  highlightedPlacement={highlightedPlacement}
                />
              ) : (
                <TilingViewer
                  width={tilingWidth}
                  height={tilingHeight}
                  placements={toSquarePlacements(tilingResult.placements || [])}
                  svgRef={tilingSvgRef}
                  highlightedPlacement={highlightedPlacement}
                  edgeStates={allTileData.allEdgeStates}
                  allTileCells={allTileData.allTileCells}
                />
              )}

              <PlacementControls
                highlightedPlacement={highlightedPlacement}
                tilingResult={tilingResult}
                solvedPolyformType={solvedPolyformType}
                hideFills={hideFills}
                onPrevPlacement={onPrevPlacement}
                onNextPlacement={onNextPlacement}
                onClearHighlight={onClearHighlight}
                setHideFills={setHideFills}
              />

              {/* Edge debugging controls (only for polyhex when placement is highlighted) */}
              {solvedPolyformType === "polyhex" &&
                highlightedPlacement !== null &&
                tilingResult.placements && (
                  <EdgeDebuggingControls
                    highlightedPlacement={highlightedPlacement}
                    highlightedEdge={highlightedEdge}
                    tilingResult={tilingResult}
                    edgeInfo={edgeInfo}
                    onPrevEdge={onPrevEdge}
                    onNextEdge={onNextEdge}
                    onClearEdge={onClearEdge}
                  />
                )}

              {/* Download buttons */}
              <TilingDownloadButtons
                solvedPolyformType={solvedPolyformType}
                onDownloadSvg={onDownloadSvg}
                onDownloadPlacementsJson={onDownloadPlacementsJson}
                onGenerateMaze={onGenerateMaze}
                onGenerateHexMaze={onGenerateHexMaze}
                onGenerateTriMaze={onGenerateTriMaze}
              />

              {/* Maze Results */}
              <MazeResultSection
                solvedPolyformType={solvedPolyformType}
                tilingWidth={tilingWidth}
                tilingHeight={tilingHeight}
                mazeResult={mazeResult}
                hexMazeResult={hexMazeResult}
                triMazeResult={triMazeResult}
                mazeSvgRef={mazeSvgRef}
                onDownloadMazeSvg={onDownloadMazeSvg}
              />
            </>
          ) : (
            <div
              style={{
                padding: "12px",
                backgroundColor: "#fff3cd",
                borderRadius: "4px",
                color: "#856404",
                fontSize: "14px",
              }}
            >
              ⚠️ <strong>No tiling possible</strong> with this tile for a{" "}
              {tilingWidth}×{tilingHeight} grid.
              <br />
              <span style={{ fontSize: "12px", color: "#6c757d" }}>
                ({tilingResult.stats.numPlacements.toLocaleString()} possible
                placements checked,{" "}
                {tilingResult.stats.numVariables.toLocaleString()} vars,{" "}
                {tilingResult.stats.numClauses.toLocaleString()} clauses)
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
