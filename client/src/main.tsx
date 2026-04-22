import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { VersionBadge } from './components/VersionBadge';
import { ConfirmProvider } from './components/ConfirmModal';
import { registerServiceWorker } from './lib/sw-register';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
    <VersionBadge />
  </React.StrictMode>,
);

registerServiceWorker();
