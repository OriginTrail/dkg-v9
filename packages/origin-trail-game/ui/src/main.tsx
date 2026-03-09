import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

window.addEventListener('message', (e) => {
  if (e.data?.type === 'dkg-nonce' && typeof e.data.nonce === 'string') {
    window.parent.postMessage({ type: 'dkg-token-request', nonce: e.data.nonce }, '*');
  } else if (e.data?.type === 'dkg-token' && typeof e.data.token === 'string') {
    (window as any).__DKG_TOKEN__ = e.data.token;
    if (typeof e.data.apiOrigin === 'string') {
      (window as any).__DKG_API_ORIGIN__ = e.data.apiOrigin;
    }
  }
});

createRoot(document.getElementById('root')!).render(<App />);
