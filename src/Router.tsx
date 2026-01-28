import { useState, useEffect } from 'react';
import App from './App.tsx';
import PolyformExplorer from './PolyformExplorer.tsx';

/** Simple hash-based router */
export function Router() {
  const [page, setPage] = useState(() => {
    const hash = window.location.hash.slice(1);
    return hash === 'polyforms' ? 'polyforms' : 'main';
  });

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      setPage(hash === 'polyforms' ? 'polyforms' : 'main');
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <>
      {/* Navigation */}
      <nav style={{
        padding: '12px 24px',
        backgroundColor: '#2c3e50',
        display: 'flex',
        gap: '16px',
      }}>
        <a
          href="#main"
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
      </nav>

      {/* Page Content */}
      {page === 'main' ? <App /> : <PolyformExplorer />}
    </>
  );
}

export default Router;
