// Popup script for managing extension settings
let currentTab = null;

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  // Get current tab
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tabs[0];

  // Load settings
  await loadSettings();

  // Setup event listeners
  setupEventListeners();
});

// Load current settings
async function loadSettings() {
  const settings = await chrome.storage.sync.get({
    globalEnabled: true,
    blockedSites: ['panres.rambio.dk'] // Default blocked site
  });

  // Update global toggle
  const globalToggle = document.getElementById('global-toggle');
  globalToggle.dataset.enabled = settings.globalEnabled;
  globalToggle.textContent = settings.globalEnabled ? 'ON' : 'OFF';

  // Update current site info
  if (currentTab?.url) {
    const url = new URL(currentTab.url);
    const hostname = url.hostname;
    document.getElementById('current-site').textContent = hostname;

    // Update button text based on whether current site is blocked
    const isBlocked = isHostnameBlocked(hostname, settings.blockedSites);
    const toggleButton = document.getElementById('toggle-current-site');
    toggleButton.textContent = isBlocked ? 'Enable on This Site' : 'Disable on This Site';
    toggleButton.dataset.blocked = isBlocked;
  }

  // Render blocked sites list
  renderBlockedSites(settings.blockedSites);
}

// Check if hostname matches any blocked pattern
function isHostnameBlocked(hostname, blockedSites) {
  return blockedSites.some(pattern => {
    if (pattern.startsWith('*.')) {
      // Wildcard subdomain match
      const domain = pattern.substring(2);
      return hostname === domain || hostname.endsWith('.' + domain);
    } else {
      // Exact match
      return hostname === pattern;
    }
  });
}

// Render blocked sites list
function renderBlockedSites(blockedSites) {
  const container = document.getElementById('blocked-sites-list');

  if (blockedSites.length === 0) {
    container.innerHTML = '<div class="empty-state">No blocked sites</div>';
    return;
  }

  container.innerHTML = blockedSites.map(site => `
    <div class="blocked-site-item">
      <span class="site-name">${site}</span>
      <button class="remove-button" data-site="${site}">Remove</button>
    </div>
  `).join('');

  // Add remove listeners
  container.querySelectorAll('.remove-button').forEach(button => {
    button.addEventListener('click', () => removeSite(button.dataset.site));
  });
}

// Setup event listeners
function setupEventListeners() {
  // Global toggle
  document.getElementById('global-toggle').addEventListener('click', toggleGlobal);

  // Current site toggle
  document.getElementById('toggle-current-site').addEventListener('click', toggleCurrentSite);

  // Add filter
  document.getElementById('add-filter').addEventListener('click', addCustomFilter);

  // Enter key in filter input
  document.getElementById('custom-filter').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addCustomFilter();
    }
  });
}

// Toggle global extension state
async function toggleGlobal() {
  const button = document.getElementById('global-toggle');
  const currentState = button.dataset.enabled === 'true';
  const newState = !currentState;

  await chrome.storage.sync.set({ globalEnabled: newState });

  button.dataset.enabled = newState;
  button.textContent = newState ? 'ON' : 'OFF';

  // Reload current tab to apply changes
  if (currentTab?.id) {
    chrome.tabs.reload(currentTab.id);
  }
}

// Toggle current site
async function toggleCurrentSite() {
  if (!currentTab?.url) return;

  const url = new URL(currentTab.url);
  const hostname = url.hostname;

  const settings = await chrome.storage.sync.get({ blockedSites: ['panres.rambio.dk'] });
  const blockedSites = settings.blockedSites;

  const isBlocked = isHostnameBlocked(hostname, blockedSites);

  if (isBlocked) {
    // Remove exact match or wildcard match
    const filtered = blockedSites.filter(pattern => {
      if (pattern.startsWith('*.')) {
        const domain = pattern.substring(2);
        return !(hostname === domain || hostname.endsWith('.' + domain));
      } else {
        return pattern !== hostname;
      }
    });
    await chrome.storage.sync.set({ blockedSites: filtered });
  } else {
    // Add to blocked sites
    blockedSites.push(hostname);
    await chrome.storage.sync.set({ blockedSites });
  }

  // Reload settings and current tab
  await loadSettings();
  if (currentTab?.id) {
    chrome.tabs.reload(currentTab.id);
  }
}

// Add custom filter
async function addCustomFilter() {
  const input = document.getElementById('custom-filter');
  const pattern = input.value.trim();

  if (!pattern) return;

  // Validate pattern
  if (!isValidPattern(pattern)) {
    alert('Invalid pattern. Use domain format like "example.com" or "*.example.com"');
    return;
  }

  const settings = await chrome.storage.sync.get({ blockedSites: ['panres.rambio.dk'] });
  const blockedSites = settings.blockedSites;

  // Check if already exists
  if (blockedSites.includes(pattern)) {
    alert('This filter already exists');
    return;
  }

  // Add new filter
  blockedSites.push(pattern);
  await chrome.storage.sync.set({ blockedSites });

  // Clear input and reload
  input.value = '';
  await loadSettings();
}

// Validate filter pattern
function isValidPattern(pattern) {
  // Allow wildcard subdomains or regular domains
  if (pattern.startsWith('*.')) {
    const domain = pattern.substring(2);
    return /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i.test(domain);
  }
  return /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/i.test(pattern);
}

// Remove site from blocked list
async function removeSite(site) {
  const settings = await chrome.storage.sync.get({ blockedSites: ['panres.rambio.dk'] });
  const blockedSites = settings.blockedSites.filter(s => s !== site);

  await chrome.storage.sync.set({ blockedSites });
  await loadSettings();

  // Reload current tab if we removed a filter affecting it
  if (currentTab?.id) {
    chrome.tabs.reload(currentTab.id);
  }
}
