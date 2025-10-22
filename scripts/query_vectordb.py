#!/usr/bin/env python3
"""
Script to query the Turbopuffer vector database.
Supports querying by vector ID, vector search, BM25, and hybrid search.
"""

import os
import argparse
from pathlib import Path
from typing import List
from openai import OpenAI
import turbopuffer as tpuf
from dotenv import load_dotenv


def openai_embed(text: str, openai_api_key: str) -> List[float]:
    """Generate embedding using OpenAI."""
    client = OpenAI(api_key=openai_api_key)
    return client.embeddings.create(
        model="text-embedding-3-large",
        input=text
    ).data[0].embedding


def reciprocal_rank_fusion(result_lists, k=60):
    """Simple rank fusion based on position."""
    scores = {}
    all_results = {}
    for results in result_lists:
        for rank, item in enumerate(results, start=1):
            scores[item.id] = scores.get(item.id, 0) + 1.0 / (k + rank)
            all_results[item.id] = item
    return [
        setattr(all_results[doc_id], 'dist', score) or all_results[doc_id]
        for doc_id, score in sorted(scores.items(), key=lambda x: x[1], reverse=True)
    ]


def main():
    # Load environment variables
    script_dir = Path(__file__).parent
    env_path = script_dir.parent / 'frontend' / '.env.local'
    load_dotenv(dotenv_path=env_path)

    parser = argparse.ArgumentParser(description='Query Turbopuffer vector database')

    query_group = parser.add_mutually_exclusive_group(required=True)
    query_group.add_argument('--id', help='Query by vector ID')
    query_group.add_argument('--search', help='Query by search term')

    parser.add_argument('--namespace', '-n', default='hoa_documents', help='Namespace')
    parser.add_argument('--top-k', '-k', type=int, default=5, help='Number of results')
    parser.add_argument('--method', choices=['vector', 'bm25', 'hybrid'], default='vector',
                       help='Search method: vector (ANN), bm25 (full-text), or hybrid (both with RRF)')
    parser.add_argument('--text-field', default='text', help='Field to use for BM25 search')
    parser.add_argument('--turbopuffer-api-key', default=os.getenv('TURBOPUFFER_API_KEY'))
    parser.add_argument('--turbopuffer-region', default=os.getenv('TURBOPUFFER_REGION', 'gcp-us-central1'))
    parser.add_argument('--openai-api-key', default=os.getenv('OPENAI_API_KEY'))

    args = parser.parse_args()

    if not args.turbopuffer_api_key:
        print("Error: TURBOPUFFER_API_KEY required")
        return 1

    # Initialize Turbopuffer
    tpuf_client = tpuf.Turbopuffer(
        api_key=args.turbopuffer_api_key,
        region=args.turbopuffer_region
    )
    ns = tpuf_client.namespace(args.namespace)

    try:
        if args.id:
            # Query by ID
            print(f"Querying by ID: {args.id}\n")
            result = ns.query(
                top_k=1,
                filters=('id', 'Eq', args.id),
                include_attributes=['text', 'content_hash', 'source', 'header', 'level']
            )
            print(result.rows)

        else:
            # Query by search term
            print(f"Searching for: '{args.search}'")
            print(f"Method: {args.method}\n")

            if args.method == 'bm25':
                # BM25 full-text search
                result = ns.query(
                    rank_by=(args.text_field, "BM25", args.search),
                    top_k=args.top_k,
                    include_attributes=['text', 'content_hash', 'source', 'header', 'level']
                )
                print(result.rows)

            elif args.method == 'vector':
                # Vector search
                if not args.openai_api_key:
                    print("Error: OPENAI_API_KEY required for vector search")
                    return 1

                embedding = openai_embed(args.search, args.openai_api_key)
                result = ns.query(
                    rank_by=("vector", "ANN", embedding),
                    top_k=args.top_k,
                    include_attributes=['text', 'content_hash', 'source', 'header', 'level']
                )
                print(result.rows)

            elif args.method == 'hybrid':
                # Hybrid search: Vector + BM25 with reciprocal rank fusion
                if not args.openai_api_key:
                    print("Error: OPENAI_API_KEY required for hybrid search")
                    return 1

                embedding = openai_embed(args.search, args.openai_api_key)

                # Multi-query: both vector and BM25
                response = ns.multi_query(
                    queries=[
                        {
                            "rank_by": ("vector", "ANN", embedding),
                            "top_k": args.top_k,
                            "include_attributes": ['text', 'content_hash', 'source', 'header', 'level'],
                        },
                        {
                            "rank_by": (args.text_field, "BM25", args.search),
                            "top_k": args.top_k,
                            "include_attributes": ['text', 'content_hash', 'source', 'header', 'level'],
                        },
                    ]
                )

                vector_result = response.results[0].rows
                bm25_result = response.results[1].rows

                print("Vector results:", [item.id for item in vector_result])
                print("BM25 results:", [item.id for item in bm25_result])
                print()

                # Fuse results
                fused_results = reciprocal_rank_fusion([vector_result, bm25_result])
                print("Fused results:", [item.id for item in fused_results])
                print()
                print(fused_results)

        return 0

    except Exception as e:
        print(f"Error: {e}")
        return 1


if __name__ == '__main__':
    exit(main())