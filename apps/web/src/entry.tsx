import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AffiliateHub } from './AffiliateHub';
import { AutomationDock } from './AutomationDock';
import './promotion-browse-mode';
import './enterprise-ui-runtime';
import './styles.css';
import './automation-dock.css';
import './automation-groups.css';
import './zenite-production.css';
import './screen-separation.css';
import './marketplace-saas-2026.css';
import './corporate-polish-2026.css';
import './affiliate-hub.css';
import './enterprise-operational-2026.css';

document.documentElement.lang = 'pt-BR';
localStorage.setItem('promo_language', 'pt-BR');

const rootElement = document.getElementById('root')!;

createRoot(rootElement).render(
  <React.StrictMode>
    <App />
    <AutomationDock />
    <AffiliateHub />
  </React.StrictMode>
);
