import { useState, useEffect } from 'react';
import App from './App.tsx';
import PolyformExplorer from './PolyformExplorer.tsx';
import { WallpaperMazeExplorer } from './wallpaper-maze';
import { OrbifoldsExplorer } from './orbifolds';

type Page = 'main' | 'polyforms' | 'wallpapermazes' | 'orbifolds';

/** Simple hash-based router. Empty hash or '#' defaults to main page. */
export function Router() {
  const [page, setPage] = useState<Page>(() => {
    const hash = window.location.hash.slice(1);
    // Map hash to page
    if (hash === 'polyforms') return 'polyforms';
    if (hash === 'wallpapermazes') return 'wallpapermazes';
    if (hash === 'orbifolds') return 'orbifolds';
    return 'main';
  });

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash === 'polyforms') setPage('polyforms');
      else if (hash === 'wallpapermazes') setPage('wallpapermazes');
      else if (hash === 'orbifolds') setPage('orbifolds');
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
          href="#wallpapermazes"
          style={{
            color: page === 'wallpapermazes' ? '#3498db' : 'white',
            textDecoration: 'none',
            fontWeight: page === 'wallpapermazes' ? 'bold' : 'normal',
            fontSize: '16px',
          }}
        >
          🧱 Wallpaper Mazes
        </a>
        <a
          href="#orbifolds"
          style={{
            color: page === 'orbifolds' ? '#3498db' : 'white',
            textDecoration: 'none',
            fontWeight: page === 'orbifolds' ? 'bold' : 'normal',
            fontSize: '16px',
          }}
        >
          🔮 Orbifolds
        </a>
      </nav>

      {/* Page Content */}
      {page === 'main' && <App />}
      {page === 'polyforms' && <PolyformExplorer />}
      {page === 'wallpapermazes' && <WallpaperMazeExplorer />}
      {page === 'orbifolds' && <OrbifoldsExplorer />}
    </>
  );
}

export default Router;
