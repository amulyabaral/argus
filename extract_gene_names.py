#!/usr/bin/env python3
"""
Extract only gene IDs and labels from panres2.json for efficient browser extension use.
Creates a compact lookup file.
"""

import json

INPUT_FILE = 'panres2.json'
OUTPUT_FILE = 'gene_names.json'

def extract_gene_names():
    print(f"Loading {INPUT_FILE}...")
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # Create compact structure: gene name -> gene ID mapping
    gene_lookup = {}

    # Get all genes from categories
    all_genes = set(data['categories']['PanGene'] + data['categories']['OriginalGene'])

    print(f"Processing {len(all_genes)} genes...")

    for gene_id in all_genes:
        subject = data['subjects'].get(gene_id)
        if not subject:
            continue

        # Add the gene ID itself
        gene_lookup[gene_id] = gene_id

        # Add the label if different from ID
        if subject['label'] and subject['label'] != gene_id:
            gene_lookup[subject['label']] = gene_id

    # Create output structure
    output = {
        'gene_names': list(gene_lookup.keys()),
        'gene_map': gene_lookup,
        'total_genes': len(all_genes),
        'total_searchable_names': len(gene_lookup)
    }

    print(f"\nExtracted {output['total_searchable_names']} searchable gene names")
    print(f"from {output['total_genes']} genes")

    # Write compact JSON
    print(f"\nWriting {OUTPUT_FILE}...")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f, separators=(',', ':'))

    import os
    size_mb = os.path.getsize(OUTPUT_FILE) / 1024 / 1024
    print(f"Done! File size: {size_mb:.2f} MB")

if __name__ == '__main__':
    extract_gene_names()
