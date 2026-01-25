# SatPictures - Grid Coloring Solver

A web application that uses SAT solving to find valid maze configurations where each color region forms a tree rooted at a designated cell. Live at https://main--taupe-souffle-a1f8fd.netlify.app/

## Purpose

**While purpose-built maze software can solve these problems more efficiently, this project explores how far modern SAT solvers have come by encoding the problem as pure logical constraints.**

The goal is not to create the most efficient maze generator, but rather to assess the current state of SAT solver technology by expressing maze generation purely as a Boolean satisfiability problem. This provides insight into:
- How well CDCL (Conflict-Driven Clause Learning) solvers handle graph connectivity constraints
- The trade-offs between different SAT encodings (binary vs unary distance, bounded reachability vs tree structure)
- Practical limits of WASM-compiled SAT solvers running in the browser

## Problem Description

Given a finite 4-neighbor grid where each point has an assigned color, the solver determines which edges to keep (passages) and which to block (walls) such that:

1. **Different colors are disconnected**: No edge exists between cells of different colors
2. **Same colors are connected**: All cells of the same color form exactly one connected component

The connectivity constraint is encoded using a spanning tree formulation with parent variables and level variables to prevent cycles.

## Technical Details

### SAT Encoding

The problem is encoded as a SAT formula with the following variables:

- **Edge variables** `x_uv`: Whether the edge between adjacent cells u and v is kept
- **Parent variables** `p^k_{u→v}`: Whether u is the parent of v in color k's spanning tree
- **Level variables** `ℓ^k_v`: Binary-encoded tree depth for each vertex (prevents cycles)

### Constraints

1. **Disconnection**: For neighbors with different colors, force `¬x_uv`
2. **Parent implies edge**: `p^k_{u→v} → x_uv`
3. **Exactly one parent**: Each non-root vertex has exactly one parent
4. **Root has no parent**: The chosen root for each color has no incoming parent edges
5. **Acyclicity**: `p^k_{u→v} → (ℓ^k_u < ℓ^k_v)` ensures tree structure

### Architecture

The codebase has a clean separation between:

- **SAT Solver Abstraction** (`src/sat/`): Generic interface that can be swapped between solvers
- **MiniSat Implementation**: Uses `logic-solver` npm package (MiniSat compiled to WASM via Emscripten)
- **Grid Coloring Encoder** (`src/solver/`): Translates the grid problem to SAT clauses
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

The `SATSolver` interface in `src/sat/types.ts` defines the contract for any SAT solver implementation. To add a new solver:

1. Implement the `SATSolver` interface
2. Update the solver instantiation in `src/solver/grid-coloring.ts`

This makes it easy to swap in CaDiCaL (compiled to WASM) or other solvers in the future.
