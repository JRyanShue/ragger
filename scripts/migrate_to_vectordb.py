#!/usr/bin/env python3
"""
Script to migrate markdown documents to Turbopuffer vector database.
Chunks documents by markdown headers and embeds using OpenAI text-embedding-3-large.
"""

import os
import argparse
from pathlib import Path
from typing import List, Dict, Any, Tuple
import re
import hashlib
from openai import OpenAI
import turbopuffer as tpuf
from dotenv import load_dotenv


def chunk_markdown_by_headers(content: str, file_path: str) -> List[Dict[str, Any]]:
    """
    Chunk markdown content by headers (h1, h2, h3, etc.).
    Returns a list of chunks with metadata.
    """
    chunks = []

    # Split by headers while keeping the header with the content
    header_pattern = r'^(#{1,6})\s+(.+)$'
    lines = content.split('\n')

    current_chunk = []
    current_header = None
    current_level = 0

    for line in lines:
        match = re.match(header_pattern, line, re.MULTILINE)

        if match:
            # Save previous chunk if it exists
            if current_chunk:
                chunk_text = '\n'.join(current_chunk).strip()
                if chunk_text:
                    chunks.append({
                        'text': chunk_text,
                        'metadata': {
                            'source': file_path,
                            'header': current_header,
                            'level': current_level
                        }
                    })

            # Start new chunk
            current_level = len(match.group(1))
            current_header = match.group(2)
            current_chunk = [line]
        else:
            current_chunk.append(line)

    # Add final chunk
    if current_chunk:
        chunk_text = '\n'.join(current_chunk).strip()
        if chunk_text:
            chunks.append({
                'text': chunk_text,
                'metadata': {
                    'source': file_path,
                    'header': current_header,
                    'level': current_level
                }
            })

    return chunks


def normalize_text(text: str) -> str:
    """
    Normalize text for consistent hashing by:
    - Stripping leading/trailing whitespace
    - Normalizing line endings to \n
    - Removing extra spaces
    """
    return ' '.join(text.strip().replace('\r\n', '\n').split())


def compute_content_hash(text: str) -> str:
    """
    Compute SHA-256 hash of normalized text for versioning.
    """
    normalized = normalize_text(text)
    return hashlib.sha256(normalized.encode('utf-8')).hexdigest()


def embed_texts(texts: List[str], openai_client: OpenAI) -> List[List[float]]:
    """
    Generate embeddings for a list of texts using OpenAI text-embedding-3-large.
    """
    response = openai_client.embeddings.create(
        model="text-embedding-3-large",
        input=texts
    )
    return [item.embedding for item in response.data]


def migrate_documents(
    file_paths: List[str],
    namespace: str,
    openai_api_key: str,
    turbopuffer_api_key: str,
    batch_size: int = 100
) -> Dict[str, List[Tuple[str, str]]]:
    """
    Migrate markdown documents to Turbopuffer vector database.
    Returns a mapping of file_path -> list of (vector_id, content_hash) tuples.
    """
    # Initialize clients
    openai_client = OpenAI(api_key=openai_api_key)
    tpuf.api_key = turbopuffer_api_key
    ns = tpuf.Namespace(namespace)

    all_chunks = []

    # Process each file
    for file_path in file_paths:
        print(f"Processing {file_path}...")

        if not os.path.exists(file_path):
            print(f"Warning: {file_path} does not exist, skipping...")
            continue

        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()

        chunks = chunk_markdown_by_headers(content, file_path)
        all_chunks.extend(chunks)
        print(f"  Created {len(chunks)} chunks")

    print(f"\nTotal chunks to process: {len(all_chunks)}")

    # Track vector IDs by file path
    file_to_vector_ids = {}

    # Process in batches
    for i in range(0, len(all_chunks), batch_size):
        batch = all_chunks[i:i + batch_size]
        batch_texts = [chunk['text'] for chunk in batch]

        print(f"Embedding batch {i // batch_size + 1} ({len(batch)} chunks)...")
        embeddings = embed_texts(batch_texts, openai_client)

        # Prepare data for Turbopuffer
        vectors = []
        for j, (chunk, embedding) in enumerate(zip(batch, embeddings)):
            vector_id = f"{chunk['metadata']['source']}_{i+j}"
            content_hash = compute_content_hash(chunk['text'])

            vectors.append({
                'id': vector_id,
                'vector': embedding,
                'attributes': {
                    'text': chunk['text'],
                    'content_hash': content_hash,
                    'source': chunk['metadata']['source'],
                    'header': chunk['metadata']['header'] or '',
                    'level': chunk['metadata']['level']
                }
            })

            # Track vector IDs and content hashes by file
            source_file = chunk['metadata']['source']
            if source_file not in file_to_vector_ids:
                file_to_vector_ids[source_file] = []
            file_to_vector_ids[source_file].append((vector_id, content_hash))

        # Upsert to Turbopuffer
        print(f"Upserting batch to Turbopuffer...")
        ns.upsert(vectors)

    print(f"\n✓ Successfully migrated {len(all_chunks)} chunks to Turbopuffer namespace '{namespace}'")
    return file_to_vector_ids


def main():
    # Load environment variables from frontend/.env.local
    script_dir = Path(__file__).parent
    env_path = script_dir.parent / 'frontend' / '.env.local'
    load_dotenv(dotenv_path=env_path)

    parser = argparse.ArgumentParser(
        description='Migrate markdown documents to Turbopuffer vector database'
    )
    parser.add_argument(
        'files',
        nargs='+',
        help='Markdown file paths to migrate'
    )
    parser.add_argument(
        '--namespace',
        '-n',
        default='documents',
        help='Turbopuffer namespace (default: documents)'
    )
    parser.add_argument(
        '--batch-size',
        '-b',
        type=int,
        default=100,
        help='Batch size for processing (default: 100)'
    )
    parser.add_argument(
        '--openai-api-key',
        default=os.getenv('OPENAI_API_KEY'),
        help='OpenAI API key (or set OPENAI_API_KEY in frontend/.env.local)'
    )
    parser.add_argument(
        '--turbopuffer-api-key',
        default=os.getenv('TURBOPUFFER_API_KEY'),
        help='Turbopuffer API key (or set TURBOPUFFER_API_KEY in frontend/.env.local)'
    )

    args = parser.parse_args()

    if not args.openai_api_key:
        print("Error: OpenAI API key required (--openai-api-key or OPENAI_API_KEY in frontend/.env.local)")
        return 1

    if not args.turbopuffer_api_key:
        print("Error: Turbopuffer API key required (--turbopuffer-api-key or TURBOPUFFER_API_KEY in frontend/.env.local)")
        return 1

    migrate_documents(
        file_paths=args.files,
        namespace=args.namespace,
        openai_api_key=args.openai_api_key,
        turbopuffer_api_key=args.turbopuffer_api_key,
        batch_size=args.batch_size
    )

    return 0


if __name__ == '__main__':
    exit(main())
