import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { GridColoringPage } from './pages/GridColoringPage';
import { PolyformsPage } from './pages/PolyformsPage';

export function AppRouter() {
  return (
    <BrowserRouter>
      <div style={{ 
        backgroundColor: '#ecf0f1', 
        padding: '12px 0', 
        marginBottom: '20px',
        borderBottom: '2px solid #bdc3c7'
      }}>
        <nav style={{ 
          maxWidth: '1200px', 
          margin: '0 auto', 
          padding: '0 2rem',
          display: 'flex',
          gap: '20px'
        }}>
          <Link 
            to="/" 
            style={{
              textDecoration: 'none',
              padding: '8px 16px',
              borderRadius: '4px',
              backgroundColor: '#3498db',
              color: 'white',
              fontWeight: '500',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2980b9'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#3498db'}
          >
            Grid Coloring Solver
          </Link>
          <Link 
            to="/polyforms" 
            style={{
              textDecoration: 'none',
              padding: '8px 16px',
              borderRadius: '4px',
              backgroundColor: '#3498db',
              color: 'white',
              fontWeight: '500',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2980b9'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#3498db'}
          >
            Polyforms Explorer
          </Link>
        </nav>
      </div>
      <Routes>
        <Route path="/" element={<GridColoringPage />} />
        <Route path="/polyforms" element={<PolyformsPage />} />
      </Routes>
    </BrowserRouter>
  );
}
