/**
 * Application entry point.
 * Imports styles and starts the app.
 */

import './styles/main.css';
import { initApp } from './app.js';

initApp().catch(err => {
  console.error('App failed to start:', err);
  document.getElementById('app').innerHTML = `
    <div style="padding:40px;text-align:center;font-family:system-ui">
      <h2>Failed to start Quackboard</h2>
      <p style="color:#6b6a65;margin-top:8px">${err.message}</p>
      <p style="color:#9c9a92;margin-top:16px;font-size:13px">
        Try refreshing the page. If the problem persists,
        check the browser console for details.
      </p>
    </div>
  `;
});
