/**
 * Find Loop panel for Orbifold Weave Explorer.
 * Phase 1: compute voltages on undoubled grid
 * Phase 2: solve loop on doubled grid
 */

import type { VoltageMatrix } from "../loop-finder.worker";
import { ValidatedInput } from "./ValidatedInput";

export interface WeaveLoopFinderPanelProps {
  maxLength: number;
  minLength: number;
  solvingLoop: boolean;
  computingVoltages: boolean;
  reachableVoltages: Array<{ key: string; matrix: VoltageMatrix }>;
  selectedTargetVoltageKey: string | null;
  rootNodeId: string;
  doubledRootNodeId: string;
  onMaxLengthChange: (v: number) => void;
  onMinLengthChange: (v: number) => void;
  onTargetVoltageChange: (key: string) => void;
  onComputeVoltages: () => void;
  onSolveLoop: () => void;
  onCancel: () => void;
}

export function WeaveLoopFinderPanel({
  maxLength,
  minLength,
  solvingLoop,
  computingVoltages,
  reachableVoltages,
  selectedTargetVoltageKey,
  rootNodeId,
  doubledRootNodeId,
  onMaxLengthChange,
  onMinLengthChange,
  onTargetVoltageChange,
  onComputeVoltages,
  onSolveLoop,
  onCancel,
}: WeaveLoopFinderPanelProps) {
  return (
    <div style={{
      marginBottom: "16px",
      padding: "12px",
      backgroundColor: "#f4ecf7",
      borderRadius: "8px",
      border: "1px solid #8e44ad",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
        <ValidatedInput
          value={maxLength}
          onChange={onMaxLengthChange}
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

      {reachableVoltages.length > 0 && (
        <div style={{ marginBottom: "8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <label style={{ fontSize: "13px" }}>Target voltage:</label>
            <select
              value={selectedTargetVoltageKey ?? ""}
              onChange={(e) => onTargetVoltageChange(e.target.value)}
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
                return <option key={v.key} value={v.key}>{label}</option>;
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

      <p style={{ fontSize: "11px", color: "#666", marginTop: "4px" }}>
        Root: <code style={{ backgroundColor: "#fff", padding: "1px 4px" }}>{rootNodeId}</code>
        {" "}(doubled: <code style={{ backgroundColor: "#fff", padding: "1px 4px" }}>{doubledRootNodeId}</code>)
      </p>
    </div>
  );
}
