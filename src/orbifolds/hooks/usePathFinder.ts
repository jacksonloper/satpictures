import { useState, useCallback, useRef, useEffect } from "react";
import type { ColorData, EdgeStyleData } from "../createOrbifolds";
import type { OrbifoldGrid } from "../orbifoldbasics";
import PathFinderWorker from "../path-finder.worker?worker";
import type { PathFinderRequest, PathFinderResponse, PathEdgeInfo } from "../path-finder.worker";

export interface PathResult {
  edgeStyles: Record<string, "solid" | "dashed">;
  pathNodeCount: number;
}

interface UsePathFinderProps {
  orbifoldGrid: OrbifoldGrid<ColorData, EdgeStyleData>;
  onError: (message: string) => void;
}

function buildPathEdgeData(grid: OrbifoldGrid<ColorData, EdgeStyleData>): PathEdgeInfo[] {
  const edgesData: PathEdgeInfo[] = [];
  for (const [edgeId, edge] of grid.edges) {
    const endpoints = Array.from(edge.halfEdges.keys());
    if (endpoints.length === 1) {
      edgesData.push({ edgeId, endpoints: [endpoints[0], endpoints[0]] });
    } else {
      edgesData.push({ edgeId, endpoints: [endpoints[0], endpoints[1]] });
    }
  }
  return edgesData;
}

export function usePathFinder({ orbifoldGrid, onError }: UsePathFinderProps) {
  const [showPathFinder, setShowPathFinder] = useState(false);
  const [minNodes, setMinNodes] = useState(3);
  const [solvingPath, setSolvingPath] = useState(false);
  const [pathSatStats, setPathSatStats] = useState<{ numVars: number; numClauses: number } | null>(null);
  const [pendingPathResult, setPendingPathResult] = useState<PathResult | null>(null);
  const pathWorkerRef = useRef<Worker | null>(null);

  const handleTogglePathFinder = useCallback(() => {
    setShowPathFinder(prev => !prev);
  }, []);

  const resetPathFinderState = useCallback(() => {
    setSolvingPath(false);
    setPathSatStats(null);
    setPendingPathResult(null);
  }, []);

  const handleCancelPathFind = useCallback(() => {
    if (pathWorkerRef.current) {
      pathWorkerRef.current.terminate();
      pathWorkerRef.current = null;
      setSolvingPath(false);
      onError("Path search cancelled");
    }
  }, [onError]);

  const handleSolvePath = useCallback(() => {
    setSolvingPath(true);
    setPathSatStats(null);
    setPendingPathResult(null);

    const grid = orbifoldGrid;
    const nodeIds = Array.from(grid.nodes.keys());
    const edgesData = buildPathEdgeData(grid);

    const request: PathFinderRequest = {
      nodeIds,
      edges: edgesData,
      minNodes,
    };

    const worker = new PathFinderWorker();
    pathWorkerRef.current = worker;

    worker.onmessage = (event: MessageEvent<PathFinderResponse>) => {
      const response = event.data;

      if (response.messageType === "progress") {
        if (response.stats) {
          setPathSatStats(response.stats);
        }
        return;
      }

      if (response.success && response.edgeStyles) {
        setPendingPathResult({
          edgeStyles: response.edgeStyles,
          pathNodeCount: response.pathNodeCount ?? 0,
        });
      } else {
        onError(response.error || "Path search failed");
      }

      setSolvingPath(false);
      pathWorkerRef.current = null;
    };

    worker.onerror = (error) => {
      onError(`Worker error: ${error.message}`);
      setSolvingPath(false);
      pathWorkerRef.current = null;
    };

    worker.postMessage(request);
  }, [minNodes, orbifoldGrid, onError]);

  const handleRejectPath = useCallback(() => {
    setPendingPathResult(null);
  }, []);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (pathWorkerRef.current) {
        pathWorkerRef.current.terminate();
        pathWorkerRef.current = null;
      }
    };
  }, []);

  return {
    showPathFinder,
    minNodes,
    setMinNodes,
    solvingPath,
    pathSatStats,
    pendingPathResult,
    setPendingPathResult,
    handleTogglePathFinder,
    handleCancelPathFind,
    handleSolvePath,
    handleRejectPath,
    resetPathFinderState,
  };
}
