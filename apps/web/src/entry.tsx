import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AutomationDock } from './AutomationDock';
import './styles.css';
import './automation-dock.css';
import './automation-groups.css';
import './zenite-production.css';

document.documentElement.lang = 'pt-BR';
localStorage.setItem('promo_language', 'pt-BR');

const rootElement = document.getElementById('root')!;

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
    <AutomationDock />
  </React.StrictMode>
);
