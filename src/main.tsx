import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find #root element in index.html');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// Production only — gated so dev/HMR never fights a cached asset. See
// public/sw.js for the cache-first-assets/network-first-shell strategy.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js');
  });
}
