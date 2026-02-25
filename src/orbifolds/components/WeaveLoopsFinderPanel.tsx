/**
 * Find Loops (plural) panel for Orbifold Weave Explorer.
 * Tries all voltages and returns satisfiable ones.
 */

import type { VoltageMatrix } from "../loop-finder.worker";
import { ValidatedInput } from "./ValidatedInput";

export interface SolveAllResult {
  key: string;
  matrix: VoltageMatrix;
  pathNodeIds: string[];
  loopEdgeIds: string[];
  pathEdgeIds?: string[];
}

export interface WeaveLoopsFinderPanelProps {
  maxLengthLoops: number;
  minLengthLoops: number;
  solvingAllLoops: boolean;
  solveAllProgress: { current: number; total: number } | null;
  solveAllResults: SolveAllResult[] | null;
  selectedLoopsVoltageKey: string | null;
  rootNodeId: string;
  onMaxLengthChange: (v: number) => void;
  onMinLengthChange: (v: number) => void;
  onFindAllLoops: () => void;
  onCancel: () => void;
  onVoltageKeyChange: (key: string) => void;
  onPreview: () => void;
}

export function WeaveLoopsFinderPanel({
  maxLengthLoops,
  minLengthLoops,
  solvingAllLoops,
  solveAllProgress,
  solveAllResults,
  selectedLoopsVoltageKey,
  rootNodeId,
  onMaxLengthChange,
  onMinLengthChange,
  onFindAllLoops,
  onCancel,
  onVoltageKeyChange,
  onPreview,
}: WeaveLoopsFinderPanelProps) {
  return (
    <div style={{
      marginBottom: "16px",
      padding: "12px",
      backgroundColor: "#d6eaf8",
      borderRadius: "8px",
      border: "1px solid #2980b9",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
        <ValidatedInput
          value={maxLengthLoops}
          onChange={onMaxLengthChange}
          min={2}
          max={9999}
          label="Max steps"
          disabled={solvingAllLoops}
        />
        <ValidatedInput
          value={minLengthLoops}
          onChange={onMinLengthChange}
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

      {solveAllResults && solveAllResults.length > 0 && (
        <div style={{ marginBottom: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <label style={{ fontSize: "13px" }}>SAT voltage:</label>
            <select
              value={selectedLoopsVoltageKey ?? ""}
              onChange={(e) => onVoltageKeyChange(e.target.value)}
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
                return <option key={v.key} value={v.key}>{label}</option>;
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
          </div>
          <p style={{ fontSize: "11px", color: "#666", marginTop: "4px" }}>
            {solveAllResults.length} satisfiable voltage{solveAllResults.length !== 1 ? "s" : ""} found
          </p>
        </div>
      )}

      <p style={{ fontSize: "11px", color: "#666", marginTop: "4px" }}>
        Root: <code style={{ backgroundColor: "#fff", padding: "1px 4px" }}>{rootNodeId}</code>
      </p>
    </div>
  );
}
