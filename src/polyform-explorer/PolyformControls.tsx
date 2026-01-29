import React from "react";
import type { PolyformType } from "../utils/polyformTransforms";

interface PolyformControlsProps {
  polyformType: PolyformType;
  onTypeChange: (type: PolyformType) => void;
  widthInput: string;
  heightInput: string;
  widthError: boolean;
  heightError: boolean;
  onWidthInputChange: (value: string) => void;
  onHeightInputChange: (value: string) => void;
  onWidthBlur: () => void;
  onHeightBlur: () => void;
  onRotate: () => void;
  onFlipH: () => void;
  onFlipV: () => void;
  onClear: () => void;
  onExportTileCoords: () => void;
  coordsJsonInput: string;
  onCoordsJsonInputChange: (value: string) => void;
  onImportTileCoords: () => void;
  filledCount: number;
}

export const PolyformControls: React.FC<PolyformControlsProps> = ({
  polyformType,
  onTypeChange,
  widthInput,
  heightInput,
  widthError,
  heightError,
  onWidthInputChange,
  onHeightInputChange,
  onWidthBlur,
  onHeightBlur,
  onRotate,
  onFlipH,
  onFlipV,
  onClear,
  onExportTileCoords,
  coordsJsonInput,
  onCoordsJsonInputChange,
  onImportTileCoords,
  filledCount,
}) => {
  return (
    <div style={{ marginBottom: "20px" }}>
      {/* Polyform Type Selector */}
      <div style={{ marginBottom: "16px" }}>
        <label style={{ marginRight: "12px", fontWeight: "bold" }}>Type:</label>
        <select
          value={polyformType}
          onChange={(e) => onTypeChange(e.target.value as PolyformType)}
          style={{
            padding: "8px 16px",
            fontSize: "14px",
            borderRadius: "4px",
            border: "1px solid #bdc3c7",
            cursor: "pointer",
          }}
        >
          <option value="polyomino">Polyomino (Square)</option>
          <option value="polyhex">Polyhex (Hexagon)</option>
          <option value="polyiamond">Polyiamond (Triangle)</option>
        </select>
      </div>
      
      {/* Grid Size Inputs */}
      <div style={{ marginBottom: "16px", display: "flex", gap: "20px", flexWrap: "wrap" }}>
        <div>
          <label style={{ marginRight: "8px" }}>Width:</label>
          <input
            type="text"
            value={widthInput}
            onChange={(e) => onWidthInputChange(e.target.value)}
            onBlur={onWidthBlur}
            style={{
              width: "60px",
              padding: "8px",
              fontSize: "14px",
              borderRadius: "4px",
              border: widthError ? "2px solid #e74c3c" : "1px solid #bdc3c7",
              backgroundColor: widthError ? "#fdecea" : "white",
            }}
          />
          {widthError && (
            <span style={{ color: "#e74c3c", marginLeft: "8px", fontSize: "12px" }}>
              Enter an integer (1-50)
            </span>
          )}
        </div>
        <div>
          <label style={{ marginRight: "8px" }}>Height:</label>
          <input
            type="text"
            value={heightInput}
            onChange={(e) => onHeightInputChange(e.target.value)}
            onBlur={onHeightBlur}
            style={{
              width: "60px",
              padding: "8px",
              fontSize: "14px",
              borderRadius: "4px",
              border: heightError ? "2px solid #e74c3c" : "1px solid #bdc3c7",
              backgroundColor: heightError ? "#fdecea" : "white",
            }}
          />
          {heightError && (
            <span style={{ color: "#e74c3c", marginLeft: "8px", fontSize: "12px" }}>
              Enter an integer (1-50)
            </span>
          )}
        </div>
      </div>
      
      {/* Action Buttons */}
      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <button
          onClick={onRotate}
          style={{
            padding: "8px 16px",
            backgroundColor: "#3498db",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          🔄 Rotate {polyformType === "polyomino" ? "90°" : "60°"}
        </button>
        <button
          onClick={onFlipH}
          style={{
            padding: "8px 16px",
            backgroundColor: "#9b59b6",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          ↔️ Flip H
        </button>
        <button
          onClick={onFlipV}
          style={{
            padding: "8px 16px",
            backgroundColor: "#9b59b6",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          ↕️ Flip V
        </button>
        <button
          onClick={onClear}
          style={{
            padding: "8px 16px",
            backgroundColor: "#e74c3c",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Clear
        </button>
        <button
          onClick={onExportTileCoords}
          style={{
            padding: "8px 16px",
            backgroundColor: "#17a2b8",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
          title="Copy tile coordinates as JSON"
        >
          📋 Copy JSON
        </button>
      </div>
      
      {/* JSON Import */}
      <div style={{ marginTop: "12px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          value={coordsJsonInput}
          onChange={(e) => onCoordsJsonInputChange(e.target.value)}
          placeholder='Paste JSON coords: [{"row":0,"col":0},...]'
          style={{
            padding: "6px 10px",
            borderRadius: "4px",
            border: "1px solid #bdc3c7",
            width: "300px",
            fontSize: "12px",
          }}
        />
        <button
          onClick={onImportTileCoords}
          disabled={!coordsJsonInput.trim()}
          style={{
            padding: "6px 12px",
            backgroundColor: coordsJsonInput.trim() ? "#28a745" : "#95a5a6",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: coordsJsonInput.trim() ? "pointer" : "not-allowed",
            fontSize: "12px",
          }}
        >
          📥 Import JSON
        </button>
      </div>
      
      {/* Stats */}
      <div style={{ marginTop: "12px", color: "#7f8c8d", fontSize: "14px" }}>
        Filled cells: <strong>{filledCount}</strong>
      </div>
    </div>
  );
};
