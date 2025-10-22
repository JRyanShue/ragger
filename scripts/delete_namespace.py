#!/usr/bin/env python3
"""
Script to delete a Turbopuffer namespace.
"""

import os
import argparse
from pathlib import Path
import turbopuffer as tpuf
from dotenv import load_dotenv


def main():
    # Load environment variables from frontend/.env.local
    script_dir = Path(__file__).parent
    env_path = script_dir.parent / 'frontend' / '.env.local'
    load_dotenv(dotenv_path=env_path)

    parser = argparse.ArgumentParser(
        description='Delete a Turbopuffer namespace'
    )
    parser.add_argument(
        'namespace',
        help='Namespace to delete (e.g., hoa_documents)'
    )
    parser.add_argument(
        '--turbopuffer-api-key',
        default=os.getenv('TURBOPUFFER_API_KEY'),
        help='Turbopuffer API key (or set TURBOPUFFER_API_KEY in frontend/.env.local)'
    )
    parser.add_argument(
        '--turbopuffer-region',
        default=os.getenv('TURBOPUFFER_REGION', 'gcp-us-central1'),
        help='Turbopuffer region (default: gcp-us-central1)'
    )
    parser.add_argument(
        '--confirm',
        action='store_true',
        help='Skip confirmation prompt'
    )

    args = parser.parse_args()

    if not args.turbopuffer_api_key:
        print("Error: Turbopuffer API key required (--turbopuffer-api-key or TURBOPUFFER_API_KEY in frontend/.env.local)")
        return 1

    # Confirm deletion
    if not args.confirm:
        response = input(f"Are you sure you want to delete namespace '{args.namespace}'? This cannot be undone. (yes/no): ")
        if response.lower() != 'yes':
            print("Deletion cancelled.")
            return 0

    # Initialize Turbopuffer client
    tpuf_client = tpuf.Turbopuffer(
        api_key=args.turbopuffer_api_key,
        region=args.turbopuffer_region
    )

    ns = tpuf_client.namespace(args.namespace)

    try:
        # Delete the namespace
        print(f"Deleting namespace '{args.namespace}'...")
        ns.delete_all()
        print(f"✓ Successfully deleted namespace '{args.namespace}'")
        return 0
    except Exception as e:
        print(f"Error deleting namespace: {e}")
        return 1


if __name__ == '__main__':
    exit(main())
