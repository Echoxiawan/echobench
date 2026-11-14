import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { studioApi } from './studio-api';
import './styles.css';

window.studio = studioApi;
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
