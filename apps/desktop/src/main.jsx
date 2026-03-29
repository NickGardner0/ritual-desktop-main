import React from 'react';
import ReactDOM from 'react-dom/client';

import { DesktopShellApp } from './DesktopShellApp';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <DesktopShellApp />
  </React.StrictMode>,
);
