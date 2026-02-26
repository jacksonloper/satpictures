import { ValidatedInput } from "./ValidatedInput";
import type { VoltageMatrix, LoopMethod } from "../loop-finder.worker";
import type { OrbifoldNodeId } from "../orbifoldbasics";

interface LoopFinderPanelProps {
  maxLength: number;
  onMaxLengthChange: (value: number) => void;
  minLength: number;
  onMinLengthChange: (value: number) => void;
  loopMethod: LoopMethod;
  onLoopMethodChange: (method: LoopMethod) => void;
  solvingLoop: boolean;
  computingVoltages: boolean;
  onComputeVoltages: () => void;
  onCancel: () => void;
  reachableVoltages: Array<{ key: string; matrix: VoltageMatrix }>;
  selectedTargetVoltageKey: string | null;
  onSelectedTargetVoltageKeyChange: (key: string) => void;
  onSolveLoop: () => void;
  loopSatStats: { numVars: number; numClauses: number } | null;
  rootNodeId: OrbifoldNodeId | null;
}

export function LoopFinderPanel({
  maxLength,
  onMaxLengthChange,
  minLength,
  onMinLengthChange,
  loopMethod,
  onLoopMethodChange,
  solvingLoop,
  computingVoltages,
  onComputeVoltages,
  onCancel,
  reachableVoltages,
  selectedTargetVoltageKey,
  onSelectedTargetVoltageKeyChange,
  onSolveLoop,
  loopSatStats,
  rootNodeId,
}: LoopFinderPanelProps) {
  return (
    <div style={{
      marginBottom: "10px",
      padding: "10px",
      backgroundColor: "#f4ecf7",
      borderRadius: "8px",
      border: "1px solid #8e44ad",
    }}>
      {/* Step 1: Max length + Compute Voltages */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
        <ValidatedInput
          value={maxLength}
          onChange={(v) => {
            onMaxLengthChange(v);
          }}
          min={2}
          max={9999}
          label="Max steps"
          disabled={solvingLoop || computingVoltages}
        />
        <ValidatedInput
          value={minLength}
          onChange={onMinLengthChange}
          min={0}
          max={maxLength}
          label="Min steps"
          disabled={solvingLoop || computingVoltages}
        />
        <button
          onClick={onComputeVoltages}
          disabled={solvingLoop || computingVoltages}
          style={{
            padding: "4px 12px",
            borderRadius: "4px",
            border: "1px solid #8e44ad",
            backgroundColor: computingVoltages ? "#d5d8dc" : "#e8daef",
            cursor: computingVoltages ? "not-allowed" : "pointer",
            fontSize: "13px",
          }}
        >
          {computingVoltages ? "Computing…" : "Compute Voltages"}
        </button>
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
      </div>

      {/* Loop method radio */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px", fontSize: "13px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
          <input
            type="radio"
            name="loopMethodSingle"
            checked={loopMethod === "nodeAtMostOnce"}
            onChange={() => onLoopMethodChange("nodeAtMostOnce")}
            disabled={solvingLoop || computingVoltages}
          />
          Each node at most once
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
          <input
            type="radio"
            name="loopMethodSingle"
            checked={loopMethod === "degreeConstraint"}
            onChange={() => onLoopMethodChange("degreeConstraint")}
            disabled={solvingLoop || computingVoltages}
          />
          Each node has 0 or 2 edges
        </label>
      </div>

      {/* Step 2: Voltage selector + Solve */}
      {reachableVoltages.length > 0 && (
        <div style={{ marginBottom: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <label style={{ fontSize: "13px" }}>Target voltage:</label>
            <select
              value={selectedTargetVoltageKey ?? ""}
              onChange={(e) => onSelectedTargetVoltageKeyChange(e.target.value)}
              disabled={solvingLoop}
              style={{
                padding: "4px 8px",
                borderRadius: "4px",
                border: "1px solid #ccc",
                fontSize: "12px",
                fontFamily: "monospace",
                maxWidth: "300px",
              }}
            >
              {reachableVoltages.map((v) => {
                const m = v.matrix;
                const label = `[[${m[0].join(",")}],[${m[1].join(",")}],[${m[2].join(",")}]]`;
                return (
                  <option key={v.key} value={v.key}>{label}</option>
                );
              })}
            </select>
            <button
              onClick={onSolveLoop}
              disabled={solvingLoop || !selectedTargetVoltageKey}
              style={{
                padding: "4px 12px",
                borderRadius: "4px",
                border: "1px solid #27ae60",
                backgroundColor: solvingLoop ? "#d5d8dc" : "#d5f5e3",
                cursor: solvingLoop || !selectedTargetVoltageKey ? "not-allowed" : "pointer",
                fontSize: "13px",
              }}
            >
              {solvingLoop ? "Solving…" : "Solve"}
            </button>
          </div>
          <p style={{ fontSize: "11px", color: "#666", marginTop: "4px" }}>
            {reachableVoltages.length} reachable voltage{reachableVoltages.length !== 1 ? "s" : ""} found
          </p>
        </div>
      )}

      {loopSatStats && (
        <p style={{ fontSize: "11px", color: "#666", marginTop: "6px" }}>
          SAT: {loopSatStats.numVars} vars, {loopSatStats.numClauses} clauses
        </p>
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
