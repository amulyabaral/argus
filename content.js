// Optimized content script using trie-based matching
let geneNamesData = null;
let geneTrie = null;
let geneMap = null;
let tooltip = null;

// Check if extension should run on current page
async function shouldRunExtension() {
  const hostname = window.location.hostname;

  // Get settings from storage
  const settings = await chrome.storage.sync.get({
    globalEnabled: true,
    blockedSites: ['panres.rambio.dk']
  });

  // Check if globally disabled
  if (!settings.globalEnabled) {
    console.log('Gene Highlighter is globally disabled');
    return false;
  }

  // Check if current site is blocked
  const isBlocked = settings.blockedSites.some(pattern => {
    if (pattern.startsWith('*.')) {
      // Wildcard subdomain match
      const domain = pattern.substring(2);
      return hostname === domain || hostname.endsWith('.' + domain);
    } else {
      // Exact match
      return hostname === pattern;
    }
  });

  if (isBlocked) {
    console.log(`Gene Highlighter disabled on ${hostname}`);
    return false;
  }

  return true;
}

// Initialize
async function init() {
  // Check if extension should run on this page
  const shouldRun = await shouldRunExtension();
  if (!shouldRun) {
    return;
  }

  try {
    chrome.runtime.sendMessage({ action: 'getGeneNames' }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('Extension context invalidated - please reload the page');
        return;
      }

      if (response && response.data) {
        geneNamesData = response.data;
        buildGeneTrie();

        // Wait 3 seconds for page to fully load before highlighting
        setTimeout(() => {
          highlightGenes();
          setupTooltip();
        }, 3000);
      } else {
        console.log('Waiting for gene data to load...');
        setTimeout(init, 1000);
      }
    });
  } catch (error) {
    console.log('Extension context invalidated - please reload the page');
  }
}

// Helper function to check if element should be skipped
function shouldSkipElement(element) {
  if (!element) return true;
  const tagName = element.tagName.toLowerCase();
  return tagName === 'script' || tagName === 'style' || tagName === 'noscript' ||
         element.classList.contains('gene-highlight') ||
         element.classList.contains('gene-tooltip') ||
         element.classList.contains('gene-modal') ||
         element.classList.contains('gene-modal-title') ||
         element.closest('.gene-modal-overlay');
}

// Check if element is inline
function isInlineElement(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
  const tag = element.tagName.toLowerCase();
  return tag === 'sub' || tag === 'sup' || tag === 'em' || tag === 'strong' ||
         tag === 'i' || tag === 'b' || tag === 'span' || tag === 'a';
}

// Highlight genes in a specific element - now handles sub/sup
function highlightGenesInElement(element) {
  // Use a more direct approach: find all text nodes and process their parent context
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        const tagName = parent.tagName.toLowerCase();
        if (tagName === 'script' || tagName === 'style' || tagName === 'noscript' ||
            parent.classList.contains('gene-highlight') ||
            parent.classList.contains('gene-tooltip') ||
            parent.classList.contains('gene-modal') ||
            parent.classList.contains('gene-modal-title') ||
            parent.closest('.gene-modal-overlay')) {
          return NodeFilter.FILTER_REJECT;
        }

        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const textNodes = [];
  let node;
  while (node = walker.nextNode()) {
    textNodes.push(node);
  }

  // Group text nodes by their context (look at surrounding siblings)
  const processedElements = new Set();

  for (const textNode of textNodes) {
    try {
      // Get the effective parent for processing (go up if we're in an inline element)
      let contextElement = textNode.parentElement;
      if (!contextElement) continue;

      // If we're already inside an inline element, get its parent for context
      if (isInlineElement(contextElement)) {
        contextElement = contextElement.parentElement;
      }

      // Skip if already processed or invalid
      if (!contextElement || processedElements.has(contextElement)) {
        continue;
      }

      // Check if this context element has a pattern that might contain genes
      // across inline siblings (like <i>bla</i><sub>NDM-1</sub>)
      const children = Array.from(contextElement.children);
      const hasInlineChildren = children.some(child => isInlineElement(child));

      // Only process elements that are reasonably sized (avoid processing huge divs)
      const textLength = contextElement.textContent.length;
      if (textLength > 10000) {
        continue; // Skip very large elements
      }

      if (hasInlineChildren) {
        processedElements.add(contextElement);
        highlightInElement(contextElement);
      } else if (contextElement.children.length === 0) {
        // Leaf text element, process it
        processedElements.add(contextElement);
        highlightInElement(contextElement);
      }
    } catch (error) {
      // Skip this node if there's an error
      console.log('Error processing text node:', error);
      continue;
    }
  }
}

// Extract combined text from element including inline children like sub/sup
function getElementTextContent(element) {
  let text = '';
  const childMap = []; // Maps text positions to child nodes

  function processNode(node) {
    const startPos = text.length;
    let childText = '';

    if (node.nodeType === Node.TEXT_NODE) {
      childText = node.textContent;
      text += childText;

      if (childText) {
        childMap.push({
          node: node,
          start: startPos,
          end: text.length,
          text: childText
        });
      }
    } else if (node.nodeType === Node.ELEMENT_NODE && isInlineElement(node)) {
      // For inline elements, we need to preserve them but also get their text
      // Process recursively to handle nested structures like <sub><span>text</span></sub>
      childText = node.textContent;
      text += childText;

      if (childText) {
        childMap.push({
          node: node,
          start: startPos,
          end: text.length,
          text: childText
        });
      }
    }
  }

  for (const child of element.childNodes) {
    processNode(child);
  }

  return { text, childMap };
}

// Highlight genes in element with combined text from sub/sup
function highlightInElement(element) {
  if (!element || !element.textContent.trim()) return;
  if (shouldSkipElement(element)) return;

  try {
    const { text, childMap } = getElementTextContent(element);
    const matches = findGeneNames(text);

    if (matches.length === 0) return;

    // Build a new fragment with highlighted genes
    const fragment = document.createDocumentFragment();
    let lastPos = 0;

    for (const match of matches) {
      const geneId = geneMap[match.name];
      if (!geneId) continue; // Skip if no gene ID found

      // Add content before the match
      if (match.start > lastPos) {
        appendTextRange(fragment, childMap, lastPos, match.start);
      }

      // Add the highlighted gene (preserving any internal structure like sub/sup)
      const geneSpan = document.createElement('span');
      geneSpan.className = 'gene-highlight';
      geneSpan.dataset.geneId = geneId;

      // Extract the matched portion preserving internal structure
      appendTextRange(geneSpan, childMap, match.start, match.end);
      fragment.appendChild(geneSpan);

      lastPos = match.end;
    }

    // Add remaining content
    if (lastPos < text.length) {
      appendTextRange(fragment, childMap, lastPos, text.length);
    }

    // Replace element's children with the new fragment
    element.innerHTML = '';
    element.appendChild(fragment);
  } catch (error) {
    console.log('Error highlighting in element:', error);
    // Don't modify the element if there's an error
  }
}

// Helper to append text range to target, preserving structure
function appendTextRange(target, childMap, start, end) {
  for (const childInfo of childMap) {
    // Check if this child overlaps with our range
    const overlapStart = Math.max(start, childInfo.start);
    const overlapEnd = Math.min(end, childInfo.end);

    if (overlapStart < overlapEnd) {
      const relStart = overlapStart - childInfo.start;
      const relEnd = overlapEnd - childInfo.start;

      if (childInfo.node.nodeType === Node.TEXT_NODE) {
        // Add text node
        const textContent = childInfo.text.substring(relStart, relEnd);
        target.appendChild(document.createTextNode(textContent));
      } else if (childInfo.node.nodeType === Node.ELEMENT_NODE) {
        // Clone the element deeply to preserve nested structure
        const clone = childInfo.node.cloneNode(true);

        // If we need partial text, adjust it
        if (relStart > 0 || relEnd < childInfo.text.length) {
          const innerText = childInfo.text.substring(relStart, relEnd);
          clone.textContent = innerText;
        }

        target.appendChild(clone);
      }
    }
  }
}

// Build a trie (prefix tree) for efficient gene name matching
function buildGeneTrie() {
  geneTrie = {};
  geneMap = geneNamesData.gene_map;
  const geneNames = geneNamesData.gene_names;

  for (const name of geneNames) {
    const nameLower = name.toLowerCase();
    let node = geneTrie;

    for (const char of nameLower) {
      if (!node[char]) {
        node[char] = {};
      }
      node = node[char];
    }

    // Mark end of word and store original name
    node.$end = true;
    node.$name = name;
  }

  console.log(`Built trie for ${geneNames.length} gene names`);
}

// Check if character is a word boundary
function isWordBoundary(char) {
  // Word boundaries include: whitespace, punctuation, start/end of string
  return !char || /[\s\W]/.test(char);
}

// Check if a potential gene name has at least one uppercase, number, or special character
function hasGeneCharacteristics(text) {
  // Must contain at least one of: uppercase letter, number, parentheses, dash, underscore
  return /[A-Z0-9()\-_]/.test(text);
}

// Find gene names in text using trie
function findGeneNames(text) {
  const textLower = text.toLowerCase();
  const matches = [];

  for (let i = 0; i < textLower.length; i++) {
    // Check if current position is at a word boundary (start of word)
    const prevChar = i > 0 ? textLower[i - 1] : null;
    if (!isWordBoundary(prevChar)) {
      continue; // Not at start of a word, skip
    }

    let node = geneTrie;
    let matchLength = 0;
    let lastMatch = null;

    // Try to match from position i - collect ALL possible matches
    const possibleMatches = [];
    for (let j = i; j < textLower.length; j++) {
      const char = textLower[j];
      if (!node[char]) break;

      node = node[char];
      matchLength++;

      // If we found a complete gene name
      if (node.$end) {
        // Check if the character after the match is also a word boundary (end of word)
        const nextChar = j + 1 < textLower.length ? textLower[j + 1] : null;
        if (isWordBoundary(nextChar)) {
          // Get the actual matched text to check for gene characteristics
          const matchedText = text.substring(i, j + 1);
          if (hasGeneCharacteristics(matchedText)) {
            possibleMatches.push({
              start: i,
              end: j + 1,
              name: node.$name,
              length: matchLength
            });
          }
        }
      }
    }

    // Select the longest match from all possible matches (greedy matching)
    if (possibleMatches.length > 0) {
      lastMatch = possibleMatches[possibleMatches.length - 1]; // Last match is the longest
      matches.push(lastMatch);
      i = lastMatch.end - 1; // Skip past this match
    }
  }

  return matches;
}

// Find and highlight gene names in the document
function highlightGenes() {
  const startTime = performance.now();

  // Use the element-based approach to properly handle inline elements like <i>bla</i><sub>NDM</sub>
  highlightGenesInElement(document.body);

  const endTime = performance.now();
  console.log(`Gene highlighting complete in ${(endTime - startTime).toFixed(2)}ms`);
}

// Highlight genes in a specific text node
function highlightInNode(textNode) {
  const text = textNode.textContent;
  const matches = findGeneNames(text);

  if (matches.length === 0) return false;

  const fragment = document.createDocumentFragment();
  let lastIndex = 0;

  for (const match of matches) {
    // Add text before match
    if (match.start > lastIndex) {
      fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.start)));
    }

    // Add highlighted gene
    const matchedText = text.substring(match.start, match.end);
    const geneId = geneMap[match.name];

    if (geneId) {
      const span = document.createElement('span');
      span.className = 'gene-highlight';
      span.textContent = matchedText;
      span.dataset.geneId = geneId;
      fragment.appendChild(span);
    } else {
      fragment.appendChild(document.createTextNode(matchedText));
    }

    lastIndex = match.end;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
  }

  textNode.parentNode.replaceChild(fragment, textNode);
  return true;
}

// Setup tooltip for gene information
function setupTooltip() {
  tooltip = document.createElement('div');
  tooltip.className = 'gene-tooltip';
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);

  document.body.addEventListener('mouseover', (e) => {
    const geneHighlight = e.target.closest('.gene-highlight');
    if (geneHighlight) {
      showTooltip(geneHighlight, e);
    }
  });

  document.body.addEventListener('mouseout', (e) => {
    const geneHighlight = e.target.closest('.gene-highlight');
    if (geneHighlight) {
      hideTooltip();
    }
  });

  document.body.addEventListener('click', (e) => {
    const geneHighlight = e.target.closest('.gene-highlight');
    if (geneHighlight) {
      showDetailedInfo(geneHighlight);
    }
  });
}

// Show tooltip with basic gene info
function showTooltip(element, event) {
  const geneId = element.dataset.geneId;

  try {
    chrome.runtime.sendMessage({ action: 'getGeneInfo', geneId: geneId }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('Extension context invalidated - please reload the page');
        return;
      }

      if (!response || !response.data) return;

      const subject = response.data;

      let html = '';
      let hasContent = false;

      if (subject.properties['has_resistance_class']) {
        const classes = subject.properties['has_resistance_class']
          .map(c => c.value)
          .join(', ');
        html += `<strong>Resistance Class:</strong> ${classes}<br>`;
        hasContent = true;
      }

      if (subject.properties['has_predicted_phenotype']) {
        const phenotypes = subject.properties['has_predicted_phenotype']
          .map(p => p.value)
          .join(', ');
        html += `<strong>Phenotype:</strong> ${phenotypes}`;
        hasContent = true;
      }

      // Only show tooltip if there's relevant content
      if (!hasContent) {
        tooltip.style.display = 'none';
        return;
      }

      tooltip.innerHTML = html;
      tooltip.style.display = 'block';

      const rect = element.getBoundingClientRect();
      tooltip.style.left = `${rect.left + window.scrollX}px`;
      tooltip.style.top = `${rect.bottom + window.scrollY + 5}px`;
    });
  } catch (error) {
    console.log('Extension context invalidated - please reload the page');
  }
}

// Hide tooltip
function hideTooltip() {
  if (tooltip) {
    tooltip.style.display = 'none';
  }
}

// Format property names to be human-readable
function formatPropertyName(prop) {
  const nameMap = {
    'has_predicted_phenotype': 'Predicted Resistance Phenotype',
    'has_resistance_class': 'Resistance Class',
    'is_from_database': 'From Database',
    'accession': 'Accession',
    'original_fasta_header': 'Original FASTA Header',
    'has_mechanism_of_resistance': 'Mechanism of Resistance',
    'has_length': 'Length',
    'card_link': 'CARD Link',
    'member_of': 'Member Of',
    'translates_to': 'Translates To',
    'same_as': 'Same As'
  };
  return nameMap[prop] || prop.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// Fetch pan gene and related genes
async function getPanGeneInfo(geneId) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ action: 'getGeneInfo', geneId: geneId }, (response) => {
        if (chrome.runtime.lastError) {
          console.log('Extension context invalidated - please reload the page');
          resolve(null);
          return;
        }
        resolve(response?.data || null);
      });
    } catch (error) {
      console.log('Extension context invalidated - please reload the page');
      resolve(null);
    }
  });
}

// Show detailed information modal
function showDetailedInfo(element) {
  const geneId = element.dataset.geneId;

  try {
    chrome.runtime.sendMessage({ action: 'getGeneInfo', geneId: geneId }, async (response) => {
      if (chrome.runtime.lastError) {
        console.log('Extension context invalidated - please reload the page');
        return;
      }

      if (!response || !response.data) return;

      const subject = response.data;
      const isPanGene = subject.types.includes('PanGene');

      // First, find the pan gene to get unified information
      if (isPanGene) {
        // This is already a pan gene, use its info directly
        displayModalWithPanGene(subject, subject);
      } else {
        // This is an original gene - find its pan gene first
        chrome.runtime.sendMessage({
          action: 'findPanGene',
          geneId: subject.id
        }, async (panResponse) => {
          if (chrome.runtime.lastError) {
            console.log('Extension context invalidated - please reload the page');
            return;
          }

          if (panResponse?.panGeneId) {
            const panGene = await getPanGeneInfo(panResponse.panGeneId);
            if (panGene) {
              // Use pan gene's unified info
              displayModalWithPanGene(subject, panGene);
            } else {
              // Fallback to original gene info if pan gene not found
              displayModalWithPanGene(subject, subject);
            }
          } else {
            // No pan gene found, use original gene info
            displayModalWithPanGene(subject, subject);
          }
        });
      }
    });
  } catch (error) {
    console.log('Extension context invalidated - please reload the page');
  }
}

// Display modal with pan gene information
function displayModalWithPanGene(subject, panGene) {
  // Format title as "subject.label // pan_gene"
  const title = subject.id === panGene.id ? panGene.label : `${subject.label} // ${panGene.label}`;

  let html = `<div class="gene-modal-overlay">
    <div class="gene-modal">
      <div class="gene-modal-header">
        <div class="gene-modal-title-section">
          <div class="argus-branding">
            <img src="${chrome.runtime.getURL('argus_logo_transparent_new.png')}" alt="ARGus Logo" class="argus-logo">
            <div class="argus-text">ARGus</div>
          </div>
          <h2 class="gene-modal-title">${title}</h2>
        </div>
        <button class="gene-modal-close">&times;</button>
      </div>
      <div class="gene-modal-content">`;

  // Skip type badge - not needed

  // Main properties section - PRIORITY: Unified Resistance Class and Phenotype from pan gene
  html += '<div class="gene-properties">';

  // Resistance Class from pan gene
  if (panGene.properties['has_resistance_class']) {
    const classes = panGene.properties['has_resistance_class'].map(v => v.value).join(', ');
    html += `<div class="gene-prop-item"><span class="gene-prop-label">Resistance Class:</span> <span class="gene-prop-value">${classes}</span></div>`;
  }

  // Predicted Phenotype from pan gene
  if (panGene.properties['has_predicted_phenotype']) {
    const phenotypes = panGene.properties['has_predicted_phenotype'].map(v => v.value).join(', ');
    html += `<div class="gene-prop-item"><span class="gene-prop-label">Predicted Resistance Phenotype:</span> <span class="gene-prop-value">${phenotypes}</span></div>`;
  }

  html += '</div>'; // Close gene-properties

  // Show pan gene information for OriginalGene, or related genes for PanGene
  html += '<div id="pan-gene-section" class="gene-pan-section"><div class="loading">Loading database information...</div></div>';

  html += '</div></div></div>'; // Close modal

  const modal = document.createElement('div');
  modal.innerHTML = html;
  document.body.appendChild(modal);

  modal.querySelector('.gene-modal-close').addEventListener('click', () => {
    modal.remove();
  });

  modal.querySelector('.gene-modal-overlay').addEventListener('click', (e) => {
    if (e.target.classList.contains('gene-modal-overlay')) {
      modal.remove();
    }
  });

  // Load pan gene information
  loadPanGeneSection(modal, subject, panGene);
}

// Extract database name from original header
function extractDatabaseFromHeader(header) {
  if (!header) return null;

  // Check for database indicators in header
  if (header.includes('ResFinder')) return 'ResFinder';
  if (header.includes('AMRFinderPlus')) return 'AMRFinderPlus';
  if (header.includes('MegaRes')) return 'MegaRes';
  if (header.includes('ARGANNOT')) return 'ARGANNOT';

  return null;
}

// Extract CARD ARO from header
function extractCardARO(header) {
  if (!header) return null;

  const aroMatch = header.match(/ARO:(\d+)/);
  if (aroMatch) {
    return {
      aro: aroMatch[0],
      link: `https://card.mcmaster.ca/ontology/${aroMatch[1]}`
    };
  }
  return null;
}

// Load pan gene and related genes section
async function loadPanGeneSection(modal, subject, panGene) {
  const panSection = modal.querySelector('#pan-gene-section');

  try {
    let panGeneHtml = `<h3>${subject.label} in AMR Gene Databases</h3>`;

    if (!panGene.properties['same_as']) {
      panSection.innerHTML = '<p class="no-pan-gene">No related genes found</p>';
      return;
    }

    const relatedGenes = panGene.properties['same_as'].map(v => v.value);

    // Fetch all related genes and group by database
    const genesByDatabase = {};
    for (const relatedId of relatedGenes) {
      const relatedGene = await getPanGeneInfo(relatedId);
      if (relatedGene) {
        const databases = relatedGene.properties['is_from_database']?.map(v => v.value) || ['Unknown'];

        // Group genes by database
        for (const db of databases) {
          if (!genesByDatabase[db]) {
            genesByDatabase[db] = [];
          }
          genesByDatabase[db].push({
            gene: relatedGene,
            isCurrent: relatedId === subject.id
          });
        }
      }
    }

    // Display genes grouped by database
    panGeneHtml += '<div class="database-groups">';
    for (const [database, geneData] of Object.entries(genesByDatabase)) {
      panGeneHtml += `<div class="database-group">
        <div class="database-group-header">${database}</div>
        <div class="database-genes">`;

      for (const { gene, isCurrent } of geneData) {
        const currentClass = isCurrent ? ' current-gene' : '';
        const originalHeader = gene.properties['original_fasta_header']?.[0]?.value || '';

        let detailsHtml = '<div class="gene-detail-items">';

        // Original FASTA header
        if (originalHeader) {
          detailsHtml += `<div class="gene-detail-item">
            <span class="gene-detail-label">Original Header:</span>
            <span class="gene-detail-value gene-prop-header">${originalHeader}</span>
          </div>`;
        }

        // CARD ARO link ONLY if database is CARD
        if (database === 'CARD') {
          const cardInfo = extractCardARO(originalHeader);
          if (cardInfo) {
            detailsHtml += `<div class="gene-detail-item">
              <span class="gene-detail-label">CARD:</span>
              <span class="gene-detail-value"><a href="${cardInfo.link}" target="_blank" rel="noopener noreferrer">${cardInfo.aro}</a></span>
            </div>`;
          }
        }

        // Accession
        if (gene.properties['accession']) {
          detailsHtml += `<div class="gene-detail-item">
            <span class="gene-detail-label">Accession:</span>
            <span class="gene-detail-value">${gene.properties['accession'].map(v => v.value).join(', ')}</span>
          </div>`;
        }

        // Mechanism of resistance
        if (gene.properties['has_mechanism_of_resistance']) {
          detailsHtml += `<div class="gene-detail-item">
            <span class="gene-detail-label">Mechanism:</span>
            <span class="gene-detail-value">${gene.properties['has_mechanism_of_resistance'].map(v => v.value.replace(/_/g, ' ')).join(', ')}</span>
          </div>`;
        }

        // Database-specific phenotype
        if (gene.properties['has_predicted_phenotype']) {
          detailsHtml += `<div class="gene-detail-item">
            <span class="gene-detail-label">Phenotype:</span>
            <span class="gene-detail-value">${gene.properties['has_predicted_phenotype'].map(v => v.value).join(', ')}</span>
          </div>`;
        }

        detailsHtml += '</div>';

        panGeneHtml += `<div class="database-gene-item${currentClass}">
          <div class="database-gene-name">${gene.label}</div>
          ${detailsHtml}
        </div>`;
      }

      panGeneHtml += '</div></div>'; // Close database-genes and database-group
    }
    panGeneHtml += '</div>'; // Close database-groups

    panSection.innerHTML = panGeneHtml;
  } catch (error) {
    console.error('Error loading pan gene info:', error);
    panSection.innerHTML = '<p class="error">Error loading related genes</p>';
  }
}

// Start the extension
init();
