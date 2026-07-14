import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { DlqPanel } from './DlqPanel';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <DlqPanel />
  </React.StrictMode>
);
