#!/usr/bin/env python3
"""
Orchestration script to process CSV metadata, migrate documents to vector DB,
and sync metadata to Supabase using Drizzle ORM.
"""

import os
import sys
import csv
import argparse
from pathlib import Path
from typing import List, Dict, Any
import subprocess
import json
from dotenv import load_dotenv

# Import the migration function
from migrate_to_vectordb import migrate_documents


def read_csv_metadata(csv_path: str) -> List[Dict[str, str]]:
    """
    Read CSV file and return list of row dictionaries.
    """
    rows = []
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get('path'):  # Skip empty rows
                rows.append(row)
    return rows


def upload_metadata_to_supabase(
    metadata_records: List[Dict[str, Any]],
    database_url: str
):
    """
    Upload metadata to Supabase using a Node.js script with Drizzle ORM.
    """
    script_dir = Path(__file__).parent
    upload_script = script_dir / 'upload_metadata.mjs'

    # Create a temporary JSON file with the data
    temp_data_file = script_dir / 'temp_metadata.json'
    with open(temp_data_file, 'w') as f:
        json.dump(metadata_records, f)

    try:
        # Run the Node.js upload script
        result = subprocess.run(
            ['node', str(upload_script), str(temp_data_file)],
            env={**os.environ, 'DATABASE_URL': database_url},
            capture_output=True,
            text=True,
            check=True
        )
        print(result.stdout)
    except subprocess.CalledProcessError as e:
        print(f"Error uploading metadata: {e.stderr}")
        raise
    finally:
        # Clean up temp file
        if temp_data_file.exists():
            temp_data_file.unlink()


def main():
    # Load environment variables from frontend/.env.local
    script_dir = Path(__file__).parent
    env_path = script_dir.parent / 'frontend' / '.env.local'
    load_dotenv(dotenv_path=env_path)

    parser = argparse.ArgumentParser(
        description='Migrate CSV metadata and documents to vector DB and Supabase'
    )
    parser.add_argument(
        'csv_file',
        help='Path to CSV file with metadata (community_slug,type,title,path)'
    )
    parser.add_argument(
        '--namespace',
        '-n',
        default='hoa_documents',
        help='Turbopuffer namespace (default: hoa_documents)'
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
    parser.add_argument(
        '--database-url',
        default=os.getenv('DATABASE_URL'),
        help='Database URL (or set DATABASE_URL in frontend/.env.local)'
    )

    args = parser.parse_args()

    # Validate required arguments
    if not args.openai_api_key:
        print("Error: OpenAI API key required (--openai-api-key or OPENAI_API_KEY in frontend/.env.local)")
        return 1

    if not args.turbopuffer_api_key:
        print("Error: Turbopuffer API key required (--turbopuffer-api-key or TURBOPUFFER_API_KEY in frontend/.env.local)")
        return 1

    if not args.database_url:
        print("Error: Database URL required (--database-url or DATABASE_URL in frontend/.env.local)")
        return 1

    # Read CSV metadata
    print(f"Reading CSV from {args.csv_file}...")
    csv_data = read_csv_metadata(args.csv_file)
    print(f"Found {len(csv_data)} documents in CSV")

    # Extract file paths
    file_paths = [row['path'] for row in csv_data]

    # Migrate documents to vector DB
    print("\n" + "=" * 60)
    print("STEP 1: Migrating documents to Turbopuffer")
    print("=" * 60 + "\n")

    file_to_vector_ids = migrate_documents(
        file_paths=file_paths,
        namespace=args.namespace,
        openai_api_key=args.openai_api_key,
        turbopuffer_api_key=args.turbopuffer_api_key,
        batch_size=args.batch_size
    )

    # Prepare metadata records for Supabase
    print("\n" + "=" * 60)
    print("STEP 2: Uploading metadata to Supabase")
    print("=" * 60 + "\n")

    metadata_records = []
    record_id = 1  # Sequential ID starting from 1
    for row in csv_data:
        file_path = row['path']
        vector_data = file_to_vector_ids.get(file_path, [])

        # Create a metadata record for each vector ID
        for vector_id, content_hash in vector_data:
            metadata_records.append({
                'id': record_id,
                'vector_id': vector_id,
                'content_hash': content_hash,
                'community_slug': row['community_slug'],
                'type': row['type'],
                'title': row['title'],
                'file_path': file_path
            })
            record_id += 1

    print(f"Uploading {len(metadata_records)} metadata records to Supabase...")
    upload_metadata_to_supabase(metadata_records, args.database_url)

    print("\n" + "=" * 60)
    print("✓ Migration complete!")
    print("=" * 60)
    print(f"- Vector DB records: {len(metadata_records)}")
    print(f"- Supabase metadata records: {len(metadata_records)}")

    return 0


if __name__ == '__main__':
    sys.exit(main())
