import { ValidatedInput } from "./ValidatedInput";
import type { VoltageMatrix } from "../loop-finder.worker";
import type { OrbifoldNodeId } from "../orbifoldbasics";

interface LoopsFinderPanelProps {
  maxLengthLoops: number;
  onMaxLengthLoopsChange: (value: number) => void;
  minLengthLoops: number;
  onMinLengthLoopsChange: (value: number) => void;
  solvingAllLoops: boolean;
  onFindAllLoops: () => void;
  onCancel: () => void;
  solveAllProgress: { current: number; total: number } | null;
  solveAllResults: Array<{
    key: string;
    matrix: VoltageMatrix;
    pathNodeIds: string[];
    loopEdgeIds: string[];
    pathEdgeIds?: string[];
  }> | null;
  selectedLoopsVoltageKey: string | null;
  onSelectedLoopsVoltageKeyChange: (key: string) => void;
  onPreview: () => void;
  onDismiss: () => void;
  rootNodeId: OrbifoldNodeId | null;
}

export function LoopsFinderPanel({
  maxLengthLoops,
  onMaxLengthLoopsChange,
  minLengthLoops,
  onMinLengthLoopsChange,
  solvingAllLoops,
  onFindAllLoops,
  onCancel,
  solveAllProgress,
  solveAllResults,
  selectedLoopsVoltageKey,
  onSelectedLoopsVoltageKeyChange,
  onPreview,
  onDismiss,
  rootNodeId,
}: LoopsFinderPanelProps) {
  return (
    <div style={{
      marginBottom: "10px",
      padding: "10px",
      backgroundColor: "#d6eaf8",
      borderRadius: "8px",
      border: "1px solid #2980b9",
    }}>
      {/* Max length + Find Loops button */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
        <ValidatedInput
          value={maxLengthLoops}
          onChange={onMaxLengthLoopsChange}
          min={2}
          max={9999}
          label="Max steps"
          disabled={solvingAllLoops}
        />
        <ValidatedInput
          value={minLengthLoops}
          onChange={onMinLengthLoopsChange}
          min={0}
          max={maxLengthLoops}
          label="Min steps"
          disabled={solvingAllLoops}
        />
        <button
          onClick={onFindAllLoops}
          disabled={solvingAllLoops}
          style={{
            padding: "4px 12px",
            borderRadius: "4px",
            border: "1px solid #2980b9",
            backgroundColor: solvingAllLoops ? "#d5d8dc" : "#aed6f1",
            cursor: solvingAllLoops ? "not-allowed" : "pointer",
            fontSize: "13px",
          }}
        >
          {solvingAllLoops ? "Searching…" : "Find All Loops"}
        </button>
        {solvingAllLoops && (
          <button
            onClick={onCancel}
            style={{
              padding: "4px 12px",
              borderRadius: "4px",
              border: "1px solid #e74c3c",
              backgroundColor: "#fadbd8",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            Cancel
          </button>
        )}
      </div>

      {/* Progress bar */}
      {solvingAllLoops && solveAllProgress && (
        <div style={{ marginBottom: "8px" }}>
          <div style={{
            width: "100%",
            height: "20px",
            backgroundColor: "#e0e0e0",
            borderRadius: "4px",
            overflow: "hidden",
          }}>
            <div style={{
              width: `${(solveAllProgress.current / solveAllProgress.total) * 100}%`,
              height: "100%",
              backgroundColor: "#2980b9",
              transition: "width 0.3s ease",
            }} />
          </div>
          <p style={{ fontSize: "11px", color: "#666", marginTop: "4px" }}>
            Testing voltage {solveAllProgress.current} / {solveAllProgress.total}…
          </p>
        </div>
      )}

      {/* Results: voltage selector from SAT-satisfiable voltages */}
      {solveAllResults && solveAllResults.length > 0 && (
        <div style={{ marginBottom: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <label style={{ fontSize: "13px" }}>SAT voltage:</label>
            <select
              value={selectedLoopsVoltageKey ?? ""}
              onChange={(e) => onSelectedLoopsVoltageKeyChange(e.target.value)}
              style={{
                padding: "4px 8px",
                borderRadius: "4px",
                border: "1px solid #ccc",
                fontSize: "12px",
                fontFamily: "monospace",
                maxWidth: "300px",
              }}
            >
              {solveAllResults.map((v) => {
                const m = v.matrix;
                const label = `[[${m[0].join(",")}],[${m[1].join(",")}],[${m[2].join(",")}]]`;
                return (
                  <option key={v.key} value={v.key}>{label}</option>
                );
              })}
            </select>
            <button
              onClick={onPreview}
              disabled={!selectedLoopsVoltageKey}
              style={{
                padding: "4px 12px",
                borderRadius: "4px",
                border: "1px solid #27ae60",
                backgroundColor: !selectedLoopsVoltageKey ? "#d5d8dc" : "#d5f5e3",
                cursor: !selectedLoopsVoltageKey ? "not-allowed" : "pointer",
                fontSize: "13px",
              }}
            >
              Preview
            </button>
            <button
              onClick={onDismiss}
              style={{
                padding: "4px 12px",
                borderRadius: "4px",
                border: "1px solid #e74c3c",
                backgroundColor: "#fadbd8",
                color: "#c0392b",
                cursor: "pointer",
                fontSize: "13px",
              }}
            >
              Dismiss
            </button>
          </div>
          <p style={{ fontSize: "11px", color: "#666", marginTop: "4px" }}>
            {solveAllResults.length} satisfiable voltage{solveAllResults.length !== 1 ? "s" : ""} found
          </p>
        </div>
      )}

      {rootNodeId && (
        <p style={{ fontSize: "11px", color: "#666", marginTop: "4px" }}>
          Root: <code style={{ backgroundColor: "#fff", padding: "1px 4px" }}>{rootNodeId}</code>
        </p>
      )}
      {!rootNodeId && (
        <p style={{ fontSize: "11px", color: "#e74c3c", marginTop: "4px" }}>
          ⚠️ Set a root node first (use 📌 Root tool)
        </p>
      )}
    </div>
  );
}
