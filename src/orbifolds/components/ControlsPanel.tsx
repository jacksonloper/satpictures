import { type WallpaperGroupType } from "../createOrbifolds";
import { ValidatedInput } from "./ValidatedInput";

interface ControlsPanelProps {
  wallpaperGroup: WallpaperGroupType;
  onWallpaperGroupChange: (group: WallpaperGroupType) => void;
  size: number;
  onSizeChange: (size: number) => void;
  minSize: number;
  expansion: number;
  onExpansionChange: (expansion: number) => void;
  useAxialTransform: boolean;
  onUseAxialTransformChange: (value: boolean) => void;
}

export function ControlsPanel({
  wallpaperGroup,
  onWallpaperGroupChange,
  size,
  onSizeChange,
  minSize,
  expansion,
  onExpansionChange,
  useAxialTransform,
  onUseAxialTransformChange,
}: ControlsPanelProps) {
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
      {/* Wallpaper Group Selector */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <label>Wallpaper Group:</label>
        <select
          value={wallpaperGroup}
          onChange={(e) => onWallpaperGroupChange(e.target.value as WallpaperGroupType)}
          style={{
            padding: "4px 8px",
            borderRadius: "4px",
            border: "1px solid #ccc",
          }}
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
      
      {/* Size Input */}
      <ValidatedInput
        value={size}
        onChange={onSizeChange}
        min={minSize}
        max={10}
        label="Size (n)"
        extraValidate={wallpaperGroup === "P2" ? (n) => n % 2 !== 0 ? "must be even" : null : undefined}
      />
      
      {/* Expansion Input */}
      <ValidatedInput
        value={expansion}
        onChange={onExpansionChange}
        min={0}
        max={20}
        label="Expansion (m)"
      />
      
      {/* Axial Transform Checkbox (only visible for P3/P6) */}
      {(wallpaperGroup === "P3" || wallpaperGroup === "P6") && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={useAxialTransform}
              onChange={(e) => onUseAxialTransformChange(e.target.checked)}
            />
            Show axial coordinates
          </label>
        </div>
      )}
    </div>
  );
}
