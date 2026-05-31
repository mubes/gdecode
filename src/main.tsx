import './silence-three-warnings'; // must run before any Three.js code
import { createRoot } from 'react-dom/client';
import App from './App';

// NOTE: no <React.StrictMode>. Its dev-only double-invoke of effects churns
// the three.js/R3F WebGL context and duplicates leva control registrations
// (the mode folder fails to display). Standard practice for three.js/R3F apps.
createRoot(document.getElementById('root')!).render(<App />);
