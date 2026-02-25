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
      <div
        style={{
          marginBottom: "16px",
          display: "flex",
          gap: "20px",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <div>
          <label style={{ marginRight: "8px" }}>Tiling Width:</label>
          <input
            type="text"
            value={tilingWidthInput}
            onChange={(e) => {
              onTilingWidthInputChange(e.target.value);
              setTilingWidthError(false);
            }}
            onBlur={onTilingWidthBlur}
            disabled={solving}
            style={{
              width: "60px",
              padding: "8px",
              fontSize: "14px",
              borderRadius: "4px",
              border: tilingWidthError
                ? "2px solid #e74c3c"
                : "1px solid #bdc3c7",
              backgroundColor: tilingWidthError ? "#fdecea" : "white",
            }}
          />
          {tilingWidthError && (
            <span
              style={{ color: "#e74c3c", marginLeft: "8px", fontSize: "12px" }}
            >
              Enter an integer (1-50)
            </span>
          )}
        </div>
        <div>
          <label style={{ marginRight: "8px" }}>Tiling Height:</label>
          <input
            type="text"
            value={tilingHeightInput}
            onChange={(e) => {
              onTilingHeightInputChange(e.target.value);
              setTilingHeightError(false);
            }}
            onBlur={onTilingHeightBlur}
            disabled={solving}
            style={{
              width: "60px",
              padding: "8px",
              fontSize: "14px",
              borderRadius: "4px",
              border: tilingHeightError
                ? "2px solid #e74c3c"
                : "1px solid #bdc3c7",
              backgroundColor: tilingHeightError ? "#fdecea" : "white",
            }}
          />
          {tilingHeightError && (
            <span
              style={{ color: "#e74c3c", marginLeft: "8px", fontSize: "12px" }}
            >
              Enter an integer (1-50)
            </span>
          )}
        </div>
        <button
          onClick={onSolveTiling}
          disabled={solving}
          style={{
            padding: "8px 20px",
            backgroundColor: solving ? "#95a5a6" : "#27ae60",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: solving ? "not-allowed" : "pointer",
            fontWeight: "bold",
          }}
        >
          {solving ? "⏳ Solving..." : "🔍 Solve Tiling"}
        </button>
        {solving && (
          <button
            onClick={onCancelSolving}
            style={{
              padding: "8px 20px",
              backgroundColor: "#e74c3c",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            ❌ Cancel
          </button>
        )}
      </div>

      {/* Progress/Stats display */}
      {solving && tilingStats && (
        <div
          style={{
            padding: "12px",
            backgroundColor: "#e8f4fd",
            borderRadius: "4px",
            marginBottom: "12px",
            fontSize: "14px",
          }}
        >
          <strong>Solving...</strong>{" "}
          {tilingStats.numVars.toLocaleString()} variables,{" "}
          {tilingStats.numClauses.toLocaleString()} clauses
        </div>
      )}

      {/* Error display */}
      {tilingError && (
        <div
          style={{
            padding: "12px",
            backgroundColor: "#fdecea",
            borderRadius: "4px",
            marginBottom: "12px",
            color: "#e74c3c",
            fontSize: "14px",
          }}
        >
          ❌ {tilingError}
        </div>
      )}

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
              {allEdges.length > 0 && (
                <div
                  style={{
                    padding: "12px",
                    backgroundColor: "#e7f3ff",
                    border: "1px solid #b6d4fe",
                    borderRadius: "4px",
                    marginBottom: "12px",
                    fontSize: "12px",
                  }}
                >
                  <strong>🔍 Edge Debugger</strong>
                  <span style={{ marginLeft: "8px", color: "#666" }}>
                    ({allEdges.length} edges total,{" "}
                    {allEdges.filter((e) => !e.isConsistent).length} violations)
                  </span>
                  <div style={{ marginTop: "8px" }}>
                    <label style={{ marginRight: "8px" }}>Filter:</label>
                    <select
                      value={edgeFilter}
                      onChange={(e) => {
                        setEdgeFilter(
                          e.target.value as "all" | "violations" | "consistent"
                        );
                        setSelectedEdgeIndex(null);
                      }}
                      style={{ marginRight: "16px" }}
                    >
                      <option value="all">All edges ({allEdges.length})</option>
                      <option value="violations">
                        Violations only (
                        {allEdges.filter((e) => !e.isConsistent).length})
                      </option>
                      <option value="consistent">
                        Consistent only (
                        {allEdges.filter((e) => e.isConsistent).length})
                      </option>
                    </select>

                    <label style={{ marginRight: "8px" }}>Select edge:</label>
                    <select
                      value={selectedEdgeIndex ?? ""}
                      onChange={(e) =>
                        setSelectedEdgeIndex(
                          e.target.value === "" ? null : Number(e.target.value)
                        )
                      }
                      style={{ maxWidth: "350px" }}
                    >
                      <option value="">-- Choose an edge --</option>
                      {allEdges
                        .map((e, i) => ({ edge: e, originalIndex: i }))
                        .filter(({ edge }) =>
                          edgeFilter === "all"
                            ? true
                            : edgeFilter === "violations"
                              ? !edge.isConsistent
                              : edge.isConsistent
                        )
                        .map(({ edge, originalIndex }) => (
                          <option key={originalIndex} value={originalIndex}>
                            {edge.isConsistent ? "🟢" : "🔴"} ({edge.cell1.q},
                            {edge.cell1.r})#{edge.edgeIdx1} ↔ ({edge.cell2.q},
                            {edge.cell2.r})#{edge.edgeIdx2}:{" "}
                            {edge.value1 ? "●" : "○"} vs{" "}
                            {edge.value2 ? "●" : "○"}
                          </option>
                        ))}
                    </select>
                  </div>

                  {selectedEdgeIndex !== null &&
                    allEdges[selectedEdgeIndex] && (
                      <div
                        style={{
                          marginTop: "8px",
                          padding: "8px",
                          backgroundColor: "#fff",
                          borderRadius: "4px",
                        }}
                      >
                        <div style={{ marginBottom: "4px" }}>
                          <strong>Toggle side:</strong>{" "}
                          <button
                            onClick={() => setShowDebugSide("A")}
                            style={{
                              marginRight: "4px",
                              fontWeight:
                                showDebugSide === "A" ? "bold" : "normal",
                              backgroundColor:
                                showDebugSide === "A" ? "#007bff" : "#e9ecef",
                              color:
                                showDebugSide === "A" ? "#fff" : "#212529",
                              border: "none",
                              padding: "4px 8px",
                              borderRadius: "4px",
                              cursor: "pointer",
                            }}
                          >
                            Side A
                          </button>
                          <button
                            onClick={() => setShowDebugSide("B")}
                            style={{
                              fontWeight:
                                showDebugSide === "B" ? "bold" : "normal",
                              backgroundColor:
                                showDebugSide === "B" ? "#007bff" : "#e9ecef",
                              color:
                                showDebugSide === "B" ? "#fff" : "#212529",
                              border: "none",
                              padding: "4px 8px",
                              borderRadius: "4px",
                              cursor: "pointer",
                            }}
                          >
                            Side B
                          </button>
                          <span
                            style={{
                              marginLeft: "12px",
                              padding: "4px 8px",
                              borderRadius: "4px",
                              backgroundColor: allEdges[selectedEdgeIndex]
                                .isConsistent
                                ? "#d4edda"
                                : "#f8d7da",
                              color: allEdges[selectedEdgeIndex].isConsistent
                                ? "#155724"
                                : "#721c24",
                            }}
                          >
                            {allEdges[selectedEdgeIndex].isConsistent
                              ? "✓ Consistent"
                              : "✗ Mismatch!"}
                          </span>
                        </div>
                        <div
                          style={{ fontFamily: "monospace", fontSize: "11px" }}
                        >
                          {showDebugSide === "A" ? (
                            <>
                              <div>
                                <strong>Cell:</strong> (
                                {allEdges[selectedEdgeIndex].cell1.q},{" "}
                                {allEdges[selectedEdgeIndex].cell1.r})
                              </div>
                              <div>
                                <strong>Edge Index:</strong>{" "}
                                {allEdges[selectedEdgeIndex].edgeIdx1}
                              </div>
                              <div>
                                <strong>Filledness:</strong>{" "}
                                <span
                                  style={{
                                    color: allEdges[selectedEdgeIndex].value1
                                      ? "green"
                                      : "red",
                                  }}
                                >
                                  {allEdges[selectedEdgeIndex].value1
                                    ? "●  FILLED"
                                    : "○  UNFILLED"}
                                </span>
                              </div>
                              <div>
                                <strong>Placement:</strong> #
                                {allEdges[selectedEdgeIndex].placementIdx1}
                              </div>
                            </>
                          ) : (
                            <>
                              <div>
                                <strong>Cell:</strong> (
                                {allEdges[selectedEdgeIndex].cell2.q},{" "}
                                {allEdges[selectedEdgeIndex].cell2.r})
                              </div>
                              <div>
                                <strong>Edge Index:</strong>{" "}
                                {allEdges[selectedEdgeIndex].edgeIdx2}
                              </div>
                              <div>
                                <strong>Filledness:</strong>{" "}
                                <span
                                  style={{
                                    color: allEdges[selectedEdgeIndex].value2
                                      ? "green"
                                      : "red",
                                  }}
                                >
                                  {allEdges[selectedEdgeIndex].value2
                                    ? "●  FILLED"
                                    : "○  UNFILLED"}
                                </span>
                              </div>
                              <div>
                                <strong>Placement:</strong> #
                                {allEdges[selectedEdgeIndex].placementIdx2}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                </div>
              )}

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

              {/* Highlight controls */}
              <div
                style={{
                  marginTop: "12px",
                  display: "flex",
                  gap: "8px",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <button
                  onClick={onPrevPlacement}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "#007bff",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "14px",
                  }}
                >
                  ◀ Prev
                </button>
                <button
                  onClick={onNextPlacement}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "#007bff",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "14px",
                  }}
                >
                  Next ▶
                </button>
                <button
                  onClick={onClearHighlight}
                  disabled={highlightedPlacement === null}
                  style={{
                    padding: "8px 16px",
                    backgroundColor:
                      highlightedPlacement !== null ? "#6c757d" : "#adb5bd",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor:
                      highlightedPlacement !== null ? "pointer" : "not-allowed",
                    fontSize: "14px",
                  }}
                >
                  Clear Highlight
                </button>
                {highlightedPlacement !== null && tilingResult.placements && (
                  <span style={{ fontSize: "14px", color: "#495057" }}>
                    Placement <strong>{highlightedPlacement + 1}</strong> of{" "}
                    {tilingResult.placements.length}
                    {" | "}
                    Transform:{" "}
                    <strong>
                      {tilingResult.placements[highlightedPlacement].transformIndex}
                    </strong>
                  </span>
                )}
              </div>

              {/* Hide fills checkbox (only for polyhex) */}
              {solvedPolyformType === "polyhex" && (
                <div style={{ marginTop: "12px" }}>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      cursor: "pointer",
                      fontSize: "14px",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={hideFills}
                      onChange={(e) => setHideFills(e.target.checked)}
                      style={{
                        width: "16px",
                        height: "16px",
                        cursor: "pointer",
                      }}
                    />
                    Hide filled hexes (show edges only)
                  </label>
                </div>
              )}

              {/* Edge debugging controls (only for polyhex when placement is highlighted) */}
              {solvedPolyformType === "polyhex" &&
                highlightedPlacement !== null &&
                tilingResult.placements && (
                  <div
                    style={{
                      marginTop: "12px",
                      padding: "12px",
                      backgroundColor: "#f8f9fa",
                      borderRadius: "4px",
                      border: "1px solid #dee2e6",
                    }}
                  >
                    <div
                      style={{
                        marginBottom: "8px",
                        fontWeight: "bold",
                        fontSize: "14px",
                      }}
                    >
                      🔍 Edge Debugging
                    </div>
                    <div
                      style={{
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <button
                        onClick={onPrevEdge}
                        style={{
                          padding: "6px 12px",
                          backgroundColor: "#28a745",
                          color: "white",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "12px",
                        }}
                      >
                        ◀ Prev Edge
                      </button>
                      <button
                        onClick={onNextEdge}
                        style={{
                          padding: "6px 12px",
                          backgroundColor: "#28a745",
                          color: "white",
                          border: "none",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "12px",
                        }}
                      >
                        Next Edge ▶
                      </button>
                      <button
                        onClick={onClearEdge}
                        disabled={highlightedEdge === null}
                        style={{
                          padding: "6px 12px",
                          backgroundColor:
                            highlightedEdge !== null ? "#6c757d" : "#adb5bd",
                          color: "white",
                          border: "none",
                          borderRadius: "4px",
                          cursor:
                            highlightedEdge !== null ? "pointer" : "not-allowed",
                          fontSize: "12px",
                        }}
                      >
                        Clear Edge
                      </button>
                      {highlightedEdge !== null && (
                        <span style={{ fontSize: "12px", color: "#495057" }}>
                          Edge <strong>{highlightedEdge + 1}</strong> of{" "}
                          {tilingResult.placements[highlightedPlacement].cells
                            .length * 6}
                        </span>
                      )}
                    </div>
                    {edgeInfo && (
                      <div
                        style={{
                          marginTop: "8px",
                          padding: "8px",
                          backgroundColor: edgeInfo.isInternal
                            ? "#d4edda"
                            : "#f8d7da",
                          borderRadius: "4px",
                          fontSize: "12px",
                          fontFamily: "monospace",
                        }}
                      >
                        <div>
                          <strong>Edge Type:</strong>{" "}
                          {edgeInfo.isInternal ? "🔗 INTERNAL" : "🚧 EXTERNAL"}{" "}
                          (direction: {edgeInfo.direction})
                        </div>
                        <div>
                          <strong>Cell:</strong> ({edgeInfo.coord1.q},{" "}
                          {edgeInfo.coord1.r}) [cell #{edgeInfo.cellIndex + 1},
                          edge #{edgeInfo.edgeIndex}]
                        </div>
                        {edgeInfo.isInternal && edgeInfo.coord2 && (
                          <div>
                            <strong>Connects to:</strong> ({edgeInfo.coord2.q},{" "}
                            {edgeInfo.coord2.r})
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

              {/* Download buttons */}
              <div
                style={{
                  marginTop: "12px",
                  display: "flex",
                  gap: "8px",
                  flexWrap: "wrap",
                }}
              >
                <button
                  onClick={onDownloadSvg}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "#6c757d",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "14px",
                  }}
                >
                  💾 Save as SVG
                </button>
                <button
                  onClick={onDownloadPlacementsJson}
                  style={{
                    padding: "8px 16px",
                    backgroundColor: "#17a2b8",
                    color: "white",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                    fontSize: "14px",
                  }}
                >
                  📥 Download Placements JSON
                </button>
                {/* Generate Maze button - only for polyomino */}
                {solvedPolyformType === "polyomino" && (
                  <button
                    onClick={onGenerateMaze}
                    style={{
                      padding: "8px 16px",
                      backgroundColor: "#9b59b6",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "14px",
                      fontWeight: "bold",
                    }}
                  >
                    🌲 Generate Maze
                  </button>
                )}
                {/* Generate Hex Maze button - only for polyhex */}
                {solvedPolyformType === "polyhex" && (
                  <button
                    onClick={onGenerateHexMaze}
                    style={{
                      padding: "8px 16px",
                      backgroundColor: "#9b59b6",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "14px",
                      fontWeight: "bold",
                    }}
                  >
                    🌲 Generate Maze
                  </button>
                )}
                {/* Generate Triangle Maze button - only for polyiamond */}
                {solvedPolyformType === "polyiamond" && (
                  <button
                    onClick={onGenerateTriMaze}
                    style={{
                      padding: "8px 16px",
                      backgroundColor: "#9b59b6",
                      color: "white",
                      border: "none",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "14px",
                      fontWeight: "bold",
                    }}
                  >
                    🌲 Generate Maze
                  </button>
                )}
              </div>

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
