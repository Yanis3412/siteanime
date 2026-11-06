import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/archivo/wdth.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/pages.css';
import './styles/reader.css';
import { UiProvider } from './state/ui.jsx';
import { AppProvider } from './state/app.jsx';
import { App } from './App.jsx';
import { registerServiceWorker } from './lib/pwa.js';

registerServiceWorker();

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <BrowserRouter>
            <UiProvider>
                <AppProvider>
                    <App />
                </AppProvider>
            </UiProvider>
        </BrowserRouter>
    </StrictMode>,
);
