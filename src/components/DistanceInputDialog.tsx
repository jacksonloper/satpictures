import React from "react";

interface DistanceInputDialogProps {
  pendingCell: { row: number; col: number };
  distanceInput: string;
  onDistanceInputChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export function DistanceInputDialog({
  pendingCell,
  distanceInput,
  onDistanceInputChange,
  onSubmit,
  onCancel,
  onKeyDown,
}: DistanceInputDialogProps) {
  return (
    <div
      style={{
        padding: "16px",
        marginTop: "12px",
        backgroundColor: "#fff3cd",
        borderRadius: "8px",
        border: "2px solid #ffc107",
        boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
      }}
    >
      <div style={{ fontWeight: "bold", fontSize: "14px", marginBottom: "8px" }}>
        Set minimum distance for cell ({pendingCell.row}, {pendingCell.col})
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
        <input
          type="number"
          min="0"
          step="1"
          value={distanceInput}
          onChange={(e) => onDistanceInputChange(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
          style={{
            width: "80px",
            padding: "8px 12px",
            borderRadius: "4px",
            border: "2px solid #3498db",
            fontSize: "16px",
          }}
          placeholder="e.g. 5"
        />
        <button
          onClick={onSubmit}
          style={{
            padding: "8px 16px",
            backgroundColor: "#27ae60",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: "bold",
            fontSize: "14px",
          }}
        >
          Save
        </button>
        <button
          onClick={onCancel}
          style={{
            padding: "8px 16px",
            backgroundColor: "#95a5a6",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          Cancel
        </button>
      </div>
      <div style={{ fontSize: "12px", color: "#7f8c8d", marginTop: "8px" }}>
        Enter a positive integer for minimum distance, or 0/empty to remove constraint.
      </div>
    </div>
  );
}
