import type { WallpaperGroupType } from "../createOrbifolds";

interface HelpSectionProps {
  wallpaperGroup: WallpaperGroupType;
}

export function HelpSection({ wallpaperGroup }: HelpSectionProps) {
  return (
    <div style={{ 
      marginTop: "30px", 
      padding: "16px", 
      backgroundColor: "#e8f4f8", 
      borderRadius: "8px",
      fontSize: "14px",
    }}>
      <h4 style={{ marginBottom: "8px" }}>About Orbifolds</h4>
      <p>
        An <strong>orbifold</strong> is a generalization of a surface that captures symmetry.
        The <strong>lifted graph</strong> shows how the fundamental domain tiles under the symmetry group.
      </p>
      <ul style={{ marginTop: "8px", paddingLeft: "20px" }}>
        <li><strong>P1:</strong> Simple torus wrapping (translations only)</li>
        <li><strong>P2:</strong> Includes 180° rotations at boundaries</li>
        <li><strong>pgg:</strong> Includes glide reflections at boundaries (no pure rotations)</li>
        <li><strong>P3:</strong> Includes 120° rotations at boundaries (3-fold symmetry, uses axial coordinates)</li>
        <li><strong>P4:</strong> Includes 90° rotations at boundaries (4-fold symmetry)</li>
        <li><strong>P4g:</strong> Like P4, but folded across the NW-SE diagonal (requires n &ge; 4)</li>
      </ul>
      <p style={{ marginTop: "8px" }}>
        Use <strong>🎨 Color</strong> tool to paint cells, or <strong>🔍 Inspect</strong> tool to see node coordinates, edges, and voltage matrices.
      </p>
      {(wallpaperGroup === "P3" || wallpaperGroup === "P6") && (
        <p style={{ marginTop: "8px", color: "#666" }}>
          <strong>Note:</strong> {wallpaperGroup} uses axial coordinates for 120° rotations. Neighbor distances in the lifted graph 
          may appear non-uniform in Cartesian display. Check "Show axial coordinates" for the transformed view.
        </p>
      )}
    </div>
  );
}
