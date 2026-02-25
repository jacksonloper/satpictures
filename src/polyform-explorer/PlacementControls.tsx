import type { UnifiedTilingResult } from "./grids/unifiedTiling";
import type { PolyformType } from "../utils/polyformTransforms";

interface PlacementControlsProps {
  highlightedPlacement: number | null;
  tilingResult: UnifiedTilingResult;
  solvedPolyformType: PolyformType | null;
  hideFills: boolean;
  onPrevPlacement: () => void;
  onNextPlacement: () => void;
  onClearHighlight: () => void;
  setHideFills: (value: boolean) => void;
}

export function PlacementControls({
  highlightedPlacement,
  tilingResult,
  solvedPolyformType,
  hideFills,
  onPrevPlacement,
  onNextPlacement,
  onClearHighlight,
  setHideFills,
}: PlacementControlsProps) {
  return (
    <>
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
    </>
  );
}
