export function HelpSection() {
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
        <li><strong>P2hex:</strong> Like P2, but with hexagonal nodes in axial coordinates (6 neighbors per node)</li>
        <li><strong>pgg:</strong> Includes glide reflections at boundaries (no pure rotations)</li>
        <li><strong>P3:</strong> Includes 120° rotations at boundaries (3-fold symmetry, uses axial coordinates)</li>
        <li><strong>P4:</strong> Includes 90° rotations at boundaries (4-fold symmetry)</li>
        <li><strong>P4g:</strong> Like P4, but folded across the NW-SE diagonal (requires n &ge; 4)</li>
      </ul>
      <p style={{ marginTop: "8px" }}>
        Use <strong>🎨 Color</strong> tool to paint cells, or <strong>🔍 Inspect</strong> tool to see node coordinates, edges, and voltage matrices.
      </p>
      <p style={{ marginTop: "8px", color: "#666" }}>
        <strong>Tip:</strong> Use "Apply axial-to-screen transform" to view the lifted graph with a sheared coordinate system that shows proper hexagonal structure.
      </p>
    </div>
  );
}
