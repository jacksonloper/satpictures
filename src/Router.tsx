import { useState, useEffect } from 'react';
import App from './App';
import TilingApp from './TilingApp';

/**
 * Simple hash-based router for switching between apps
 */
export function Router() {
  const [currentPage, setCurrentPage] = useState<'main' | 'tiling'>('main');

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash === '#/tiling') {
        setCurrentPage('tiling');
      } else {
        setCurrentPage('main');
      }
    };

    // Check initial hash
    handleHashChange();

    // Listen for hash changes
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  if (currentPage === 'tiling') {
    return <TilingApp />;
  }
  return <App />;
}
