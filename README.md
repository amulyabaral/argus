# PanRes2 Gene Highlighter

Browser extension for highlighting antimicrobial resistance (AMR) genes on web pages using the PanRes2 unified database.

## What it does

- Detects AMR gene names in any web page text
- Highlights recognized genes with clickable borders
- Shows unified resistance class and phenotype information
- Displays gene names across different databases (ResFinder, CARD, AMRFinderPlus, ARGANNOT, MegaRes)

## How it works

PanRes2 has already unified AMR gene ontology from multiple databases. Each database may call the same resistance gene by different names (e.g., `tet(40)`, `tet(40)_2_AM419751`, `TET40`). This extension:

1. Uses a trie-based matching algorithm for fast gene name detection
2. Fetches unified resistance information from the PanRes2 pan gene
3. Shows how each database names and annotates the same gene

## Usage

- Hover over highlighted genes for quick info
- Click for detailed modal with cross-database gene names and metadata

## Data

- `gene_names.json` - Lightweight index for fast text matching
- `panres2.json` - Full PanRes2 database with unified gene ontology
- Uses IndexedDB for efficient caching

## Design

Follows strict minimal design system: monochrome palette, border-based hierarchy, monospace typography, no decorative elements.
