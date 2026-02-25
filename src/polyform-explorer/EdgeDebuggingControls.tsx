import type { UnifiedTilingResult } from "./grids/unifiedTiling";

interface EdgeInfoType {
  cellIndex: number;
  edgeIndex: number;
  isInternal: boolean;
  coord1: { q: number; r: number };
  coord2: { q: number; r: number } | null;
  direction: string;
}

interface EdgeDebuggingControlsProps {
  highlightedPlacement: number;
  highlightedEdge: number | null;
  tilingResult: UnifiedTilingResult;
  edgeInfo: EdgeInfoType | null;
  onPrevEdge: () => void;
  onNextEdge: () => void;
  onClearEdge: () => void;
}

export function EdgeDebuggingControls({
  highlightedPlacement,
  highlightedEdge,
  tilingResult,
  edgeInfo,
  onPrevEdge,
  onNextEdge,
  onClearEdge,
}: EdgeDebuggingControlsProps) {
  return (
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
        {highlightedEdge !== null && tilingResult.placements && (
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
  );
}
