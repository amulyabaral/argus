// Background script to manage gene data with IndexedDB
const DB_NAME = 'GeneHighlighterDB';
const DB_VERSION = 1;
const STORE_NAME = 'geneData';

let db = null;
let geneNamesCache = null;
let fullDataUrl = null;
let panGeneIndex = null; // Map: originalGeneId -> panGeneId
let fullDataCache = null; // Cache the entire dataset in memory

// Initialize IndexedDB
async function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

// Load data on installation
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Gene Highlighter extension installed');
  await initDB();
  await loadGeneNames();
  await loadPanGeneIndex(); // Build pan gene index

  // Initialize default settings
  const settings = await chrome.storage.sync.get({
    globalEnabled: true,
    blockedSites: ['panres.rambio.dk']
  });

  // Only set if not already set
  if (settings.globalEnabled === undefined) {
    await chrome.storage.sync.set({
      globalEnabled: true,
      blockedSites: ['panres.rambio.dk']
    });
  }
});

// Load only gene names (lightweight data)
async function loadGeneNames() {
  try {
    await initDB();

    // Check if data already exists in IndexedDB
    const cachedNames = await getFromDB('gene_names');

    if (cachedNames) {
      console.log('Using cached gene names from IndexedDB');
      geneNamesCache = cachedNames;
      return;
    }

    // Load gene names (compact file for fast searching)
    console.log('Loading gene_names.json...');
    const namesResponse = await fetch(chrome.runtime.getURL('gene_names.json'));
    geneNamesCache = await namesResponse.json();
    await saveToDB('gene_names', geneNamesCache);
    console.log(`Loaded ${geneNamesCache.total_searchable_names} gene names`);

  } catch (error) {
    console.error('Error loading gene data:', error);
  }
}

// Get full data URL (lazy initialization)
function getFullDataUrl() {
  if (!fullDataUrl) {
    fullDataUrl = chrome.runtime.getURL('panres2.json');
  }
  return fullDataUrl;
}

// Load full dataset into memory once
async function loadFullData() {
  try {
    if (fullDataCache) {
      return fullDataCache;
    }

    console.log('Loading full gene dataset into memory...');
    const startTime = performance.now();

    const response = await fetch(getFullDataUrl());
    fullDataCache = await response.json();

    const endTime = performance.now();
    console.log(`Loaded full dataset in ${(endTime - startTime).toFixed(2)}ms`);

    return fullDataCache;
  } catch (error) {
    console.error('Error loading full data:', error);
    throw error;
  }
}

// Load and build pan gene index for fast lookups
async function loadPanGeneIndex() {
  try {
    await initDB();

    // Check if index already exists in IndexedDB
    const cachedIndex = await getFromDB('pan_gene_index');

    if (cachedIndex) {
      console.log('Using cached pan gene index from IndexedDB');
      panGeneIndex = cachedIndex;
      // Also load the full data into memory for fast access
      await loadFullData();
      return;
    }

    // Build the index from full data
    console.log('Building pan gene index...');
    const startTime = performance.now();

    const fullData = await loadFullData();

    panGeneIndex = {};

    // Iterate through all subjects to find pan genes and their relationships
    for (const [subjectId, subjectData] of Object.entries(fullData.subjects)) {
      if (subjectData.types && subjectData.types.includes('PanGene')) {
        const sameAs = subjectData.properties['same_as'];
        if (sameAs && Array.isArray(sameAs)) {
          // Map each original gene to this pan gene
          for (const ref of sameAs) {
            panGeneIndex[ref.value] = subjectId;
          }
        }
      }
    }

    // Save to IndexedDB for future use
    await saveToDB('pan_gene_index', panGeneIndex);

    const endTime = performance.now();
    console.log(`Built pan gene index with ${Object.keys(panGeneIndex).length} mappings in ${(endTime - startTime).toFixed(2)}ms`);

  } catch (error) {
    console.error('Error building pan gene index:', error);
  }
}

// Save to IndexedDB
async function saveToDB(key, value) {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(value, key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

// Get from IndexedDB
async function getFromDB(key) {
  if (!db) await initDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

// Fetch individual gene info on-demand
async function getGeneInfo(geneId) {
  try {
    // Ensure full data is loaded in memory
    if (!fullDataCache) {
      await loadFullData();
    }

    // Direct lookup from in-memory cache - instant!
    const subject = fullDataCache.subjects[geneId];

    if (!subject) {
      console.log(`Gene not found: ${geneId}`);
    }

    return subject;
  } catch (error) {
    console.error(`Error fetching gene info for ${geneId}:`, error);
    throw error;
  }
}

// Find pan gene for a given original gene using the index
async function findPanGene(geneId) {
  try {
    // Ensure index is loaded
    if (!panGeneIndex) {
      await loadPanGeneIndex();
    }

    // Simple lookup in the index
    const panGeneId = panGeneIndex[geneId];

    if (panGeneId) {
      console.log(`Found pan gene ${panGeneId} for ${geneId} (indexed lookup)`);
      return panGeneId;
    }

    console.log(`No pan gene found for ${geneId}`);
    return null;
  } catch (error) {
    console.error(`Error finding pan gene for ${geneId}:`, error);
    throw error;
  }
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getGeneNames') {
    if (geneNamesCache) {
      sendResponse({ data: geneNamesCache });
    } else {
      loadGeneNames().then(() => {
        sendResponse({ data: geneNamesCache });
      }).catch(err => {
        sendResponse({ error: err.message });
      });
      return true; // Async response
    }
  } else if (request.action === 'getGeneInfo') {
    getGeneInfo(request.geneId).then(subject => {
      sendResponse({ data: subject });
    }).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // Async response
  } else if (request.action === 'findPanGene') {
    findPanGene(request.geneId).then(panGeneId => {
      sendResponse({ panGeneId: panGeneId });
    }).catch(err => {
      sendResponse({ error: err.message });
    });
    return true; // Async response
  }
});

// Initialize on startup
initDB().then(() => {
  loadGeneNames();
  loadPanGeneIndex(); // This will also trigger loadFullData()
});
