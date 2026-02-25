import type { PolyformType } from "../utils/polyformTransforms";

interface TilingDownloadButtonsProps {
  solvedPolyformType: PolyformType | null;
  onDownloadSvg: () => void;
  onDownloadPlacementsJson: () => void;
  onGenerateMaze: () => void;
  onGenerateHexMaze: () => void;
  onGenerateTriMaze: () => void;
}

export function TilingDownloadButtons({
  solvedPolyformType,
  onDownloadSvg,
  onDownloadPlacementsJson,
  onGenerateMaze,
  onGenerateHexMaze,
  onGenerateTriMaze,
}: TilingDownloadButtonsProps) {
  return (
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
  );
}
