/**
 * IndexedDB Storage Module
 *
 * Provides functions to save, load, delete, and restore mazes from IndexedDB.
 */

import type { ColorGrid, GridType } from "../solver";

const DB_NAME = "satpictures";
const DB_VERSION = 1;
const STORE_NAME = "mazes";

/**
 * A saved maze entry
 */
export interface SavedMaze {
  id: string;
  name: string;
  grid: ColorGrid;
  gridType: GridType;
  createdAt: number;
}

/**
 * Opens the IndexedDB database and creates object stores if needed
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error("Failed to open IndexedDB"));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
  });
}

/**
 * Generates a unique ID for a new maze
 */
function generateId(): string {
  return `maze_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Save a maze to IndexedDB
 */
export async function saveMaze(
  name: string,
  grid: ColorGrid,
  gridType: GridType
): Promise<SavedMaze> {
  const db = await openDB();

  const maze: SavedMaze = {
    id: generateId(),
    name,
    grid,
    gridType,
    createdAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(maze);

    request.onerror = () => {
      reject(new Error("Failed to save maze"));
    };

    request.onsuccess = () => {
      resolve(maze);
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Get all saved mazes from IndexedDB
 */
export async function listMazes(): Promise<SavedMaze[]> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index("createdAt");
    const request = index.getAll();

    request.onerror = () => {
      reject(new Error("Failed to list mazes"));
    };

    request.onsuccess = () => {
      // Sort by createdAt descending (most recent first)
      const mazes = request.result as SavedMaze[];
      mazes.sort((a, b) => b.createdAt - a.createdAt);
      resolve(mazes);
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Get a specific maze by ID
 */
export async function getMaze(id: string): Promise<SavedMaze | null> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onerror = () => {
      reject(new Error("Failed to get maze"));
    };

    request.onsuccess = () => {
      resolve(request.result || null);
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}

/**
 * Delete a maze from IndexedDB
 */
export async function deleteMaze(id: string): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onerror = () => {
      reject(new Error("Failed to delete maze"));
    };

    request.onsuccess = () => {
      resolve();
    };

    transaction.oncomplete = () => {
      db.close();
    };
  });
}
