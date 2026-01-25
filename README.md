# SatPictures - Grid Coloring Solver

A web application that uses SAT solving to find valid maze configurations where each color region forms a tree rooted at a designated cell. Live at https://main--taupe-souffle-a1f8fd.netlify.app/

## Purpose

**While purpose-built maze software can solve these problems more efficiently, this project explores how far modern SAT solvers have come by encoding the problem as pure logical constraints.**

The goal is not to create the most efficient maze generator, but rather to assess the current state of SAT solver technology by expressing maze generation purely as a Boolean satisfiability problem. 

## Problem Description

Given a finite 4-neighbor grid where each point has an assigned color, the solver determines which edges to keep (passages) and which to block (walls) such that:

1. **Different colors are disconnected**: No edge exists between cells of different colors
2. **Same colors are connected**: All cells of the same color form exactly one connected component (a tree rooted at a designated root cell)

### Input Parameters

- **Nodes and edges**: The graph structure (typically a grid with 4-connectivity)
- **Node color hints**: Optional color assignments for nodes (-1 means "any color")
- **Root of each color** (required): Each color must have a designated root node that serves as the tree root for that color's connected component
- **Distance lower bounds** (optional): Constraints of the form `[node, minDistance]` that require certain nodes to be at least a minimum distance from their tree's root

The connectivity constraint is encoded using a spanning tree formulation with parent variables and unary distance variables.

## Technical Details

### SAT Encoding

The problem is encoded as a SAT formula using **UNARY distance encoding** for better SAT solver propagation. Instead of binary bit-vectors for tree depth, each node has N boolean variables (where N is the number of nodes) representing "distance from root is at least d".

#### Variables

- **Color variables** `col(u)=c`: Whether node u has color c
- **Parent variables** `par(u)→(v)`: Whether v is the parent of u (i.e., u picked v as its parent)
- **Keep variables** `keep(u--v)`: Whether the edge between u and v is kept
- **Distance variables** `dist(u)>=d`: Whether the distance of u from its root is at least d (unary encoding)

The unary distance variables form a decreasing chain: `dist(u)>=d → dist(u)>=(d-1)`, which enables efficient propagation during SAT solving.

### Constraints

1. **Exactly one color**: Each node has exactly one color
2. **Anti-parallel parent**: Cannot have both `par(u→v)` and `par(v→u)` (no cycles between adjacent nodes)
3. **Parent-keep linkage**: `par(u→v) → keep(u--v)` and `keep(u--v) → (par(u→v) ∨ par(v→u))`
4. **Same-color edges**: Kept edges enforce same color at endpoints
5. **Same-color parents**: A node can only choose a parent with the same color
6. **Distance ordering**: If u picks v as parent and `dist(v)>=d`, then `dist(u)>=(d+1)` (ensures tree structure and prevents cycles)
7. **Exactly one parent**: Each non-root node picks exactly one parent among its neighbors
8. **Root constraints**: Roots have distance 0 and no parent
9. **Global distance cap**: Distance must be less than N (prevents disconnected components)

### Architecture

The codebase has a clean separation between:

- **SAT Solver Abstraction** (`src/solvers/`): Generic interface (`SATSolver`) and formula builders that can be swapped between different solver implementations
- **Solver Implementations** (`src/solvers/`):
  - **CaDiCaL**: High-performance solver compiled to WASM via Emscripten
  - **MiniSat**: Uses `logic-solver` npm package (MiniSat compiled to JavaScript)
  - **DPLL**: Simple reference implementation for educational purposes
- **Problem Encoding** (`src/problem/`): Translates the colored forest problem to SAT clauses using UNARY distance encoding
- **React UI** (`src/components/`): Interactive grid editor and visualization

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Usage

1. Select a color from the palette
2. Paint cells on the grid (click and drag)
3. Click "Solve" to find a valid maze configuration
4. Walls appear between different colors and within same-color regions as needed

## Swapping SAT Solvers

The `SATSolver` interface in `src/solvers/types.ts` defines the contract for any SAT solver implementation. The codebase already includes three solver implementations:

1. **CaDiCaL** (`src/solvers/cadical-solver.ts`): High-performance WASM solver
2. **MiniSat** (`src/solvers/minisat-solver.ts`): JavaScript-compiled solver via `logic-solver` package
3. **DPLL** (`src/solvers/dpll-solver.ts`): Educational reference implementation

To add a new solver, implement the `SATSolver` interface and update the solver instantiation in the worker files.
