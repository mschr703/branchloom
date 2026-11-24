import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ReleaseUpdateNotice } from './components/ReleaseUpdateNotice';
import '@fontsource-variable/ibm-plex-sans/wght.css';
import './styles.css';
import './navigation.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <ReleaseUpdateNotice />
  </React.StrictMode>,
);
