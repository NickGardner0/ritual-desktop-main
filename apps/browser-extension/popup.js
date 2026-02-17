/**
 * Ritual Browser Tracker - Popup UI
 * Displays connection status, current tracking info, and stats.
 */

function formatTimeAgo(timestamp) {
  if (!timestamp) return 'Never';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

async function updatePopup() {
  try {
    const { status } = await chrome.storage.local.get('status');
    if (!status) return;

    // Connection status
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    statusDot.className = `status-dot ${status.connected ? 'connected' : 'disconnected'}`;
    statusText.textContent = status.connected ? 'Connected' : 'Disconnected';

    // Browser name
    document.getElementById('browser-name').textContent = capitalize(status.browser || 'browser');

    // Last heartbeat
    document.getElementById('last-heartbeat').textContent = formatTimeAgo(status.lastHeartbeat);

    // Idle state
    document.getElementById('idle-state').textContent = capitalize(status.idleState || 'unknown');

    // Current tracking
    const domainEl = document.getElementById('current-domain');
    const titleEl = document.getElementById('current-title');

    if (status.currentDomain) {
      domainEl.textContent = status.currentDomain;
      titleEl.textContent = status.currentTitle || 'Untitled';
    } else {
      domainEl.textContent = '-';
      titleEl.textContent = 'No active tab';
    }

    // Stats
    document.getElementById('total-heartbeats').textContent =
      (status.totalHeartbeats || 0).toLocaleString();
    document.getElementById('total-errors').textContent =
      (status.totalErrors || 0).toLocaleString();
  } catch (e) {
    console.debug('Failed to update popup:', e.message);
  }
}

// Also check server status directly
async function checkServer() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'checkServer' });
    if (response?.connected) {
      const statusDot = document.getElementById('status-dot');
      const statusText = document.getElementById('status-text');
      statusDot.className = 'status-dot connected';
      statusText.textContent = 'Connected';
    }
  } catch (e) {
    console.debug('Server check failed:', e.message);
  }
}

// Initial load
updatePopup();
checkServer();

// Auto-refresh every 2 seconds while popup is open
setInterval(updatePopup, 2000);
