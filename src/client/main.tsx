import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { unlockAudioOnGesture } from './feedback';
import { initTelegram } from './telegram';
import './styles.css';

initTelegram();
unlockAudioOnGesture();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
