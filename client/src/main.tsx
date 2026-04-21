import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { VersionBadge } from './components/VersionBadge';
import { registerServiceWorker } from './lib/sw-register';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <VersionBadge />
  </React.StrictMode>,
);

registerServiceWorker();
