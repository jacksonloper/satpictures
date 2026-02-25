/**
 * Top controls panel for Orbifold Weave Explorer.
 */

import type { WallpaperGroupType } from "../createOrbifolds";
import { ValidatedInput } from "./ValidatedInput";

export interface WeaveControlsPanelProps {
  wallpaperGroup: WallpaperGroupType;
  size: number;
  expansion: number;
  minSize: number;
  onWallpaperGroupChange: (group: WallpaperGroupType) => void;
  onSizeChange: (size: number) => void;
  onExpansionChange: (expansion: number) => void;
}

export function WeaveControlsPanel({
  wallpaperGroup,
  size,
  expansion,
  minSize,
  onWallpaperGroupChange,
  onSizeChange,
  onExpansionChange,
}: WeaveControlsPanelProps) {
  return (
    <div style={{
      display: "flex",
      flexWrap: "wrap",
      gap: "20px",
      marginBottom: "20px",
      padding: "16px",
      backgroundColor: "#f8f9fa",
      borderRadius: "8px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <label>Wallpaper Group:</label>
        <select
          value={wallpaperGroup}
          onChange={(e) => onWallpaperGroupChange(e.target.value as WallpaperGroupType)}
          style={{ padding: "4px 8px", borderRadius: "4px", border: "1px solid #ccc" }}
        >
          <option value="P1">P1 (Torus)</option>
          <option value="P2">P2 (180° rotation)</option>
          <option value="pgg">pgg (glide reflections)</option>
          <option value="pmm">pmm (mirrors)</option>
          <option value="P3">P3 (120° rotation - axial)</option>
          <option value="P4">P4 (90° rotation)</option>
          <option value="P4g">P4g (90° rotation + diagonal flip)</option>
          <option value="P6">P6 (120° rotation + diagonal flip)</option>
        </select>
      </div>

      <ValidatedInput value={size} onChange={onSizeChange} min={minSize} max={10} label="Size (n)"
        extraValidate={wallpaperGroup === "P2" ? (n) => n % 2 !== 0 ? "must be even" : null : undefined}
      />
      <ValidatedInput value={expansion} onChange={onExpansionChange} min={0} max={20} label="Expansion (m)" />
    </div>
  );
}
