import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AutomationDock } from './AutomationDock';
import './styles.css';
import './system-dashboard.css';

const rootElement = document.getElementById('root')!;

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
    <AutomationDock />
  </React.StrictMode>
);
