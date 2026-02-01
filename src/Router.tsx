import { useState, useEffect } from 'react';
import App from './App.tsx';
import PolyformExplorer from './PolyformExplorer.tsx';
import EdgeColoringExplorer from './EdgeColoringExplorer.tsx';

type PageType = 'main' | 'polyforms' | 'edgecoloring';

/** Simple hash-based router. Empty hash or '#' defaults to main page. */
export function Router() {
  const [page, setPage] = useState<PageType>(() => {
    const hash = window.location.hash.slice(1);
    // Empty hash, no hash, or '#main' all show the main page
    if (hash === 'polyforms') return 'polyforms';
    if (hash === 'edgecoloring') return 'edgecoloring';
    return 'main';
  });

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash === 'polyforms') setPage('polyforms');
      else if (hash === 'edgecoloring') setPage('edgecoloring');
      else setPage('main');
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <>
      {/* Navigation bar */}
      <nav style={{
        padding: '12px 24px',
        backgroundColor: '#2c3e50',
        display: 'flex',
        gap: '16px',
      }}>
        <a
          href="#"
          style={{
            color: page === 'main' ? '#3498db' : 'white',
            textDecoration: 'none',
            fontWeight: page === 'main' ? 'bold' : 'normal',
            fontSize: '16px',
          }}
        >
          🎨 Grid Coloring
        </a>
        <a
          href="#polyforms"
          style={{
            color: page === 'polyforms' ? '#3498db' : 'white',
            textDecoration: 'none',
            fontWeight: page === 'polyforms' ? 'bold' : 'normal',
            fontSize: '16px',
          }}
        >
          🧩 Polyforms
        </a>
        <a
          href="#edgecoloring"
          style={{
            color: page === 'edgecoloring' ? '#3498db' : 'white',
            textDecoration: 'none',
            fontWeight: page === 'edgecoloring' ? 'bold' : 'normal',
            fontSize: '16px',
          }}
        >
          🎨 Edge Coloring
        </a>
      </nav>

      {/* Page Content */}
      {page === 'main' && <App />}
      {page === 'polyforms' && <PolyformExplorer />}
      {page === 'edgecoloring' && <EdgeColoringExplorer />}
    </>
  );
}

export default Router;
