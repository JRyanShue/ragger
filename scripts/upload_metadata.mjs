#!/usr/bin/env node
/**
 * Node.js script to upload HOA document metadata to Supabase using Drizzle ORM.
 * Takes a JSON file path as argument containing metadata records.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { readFileSync } from 'fs';

// Define the table inline since importing TS from .mjs is complex
const { pgTable, text, timestamp, integer } = await import('drizzle-orm/pg-core');

const hoaDocMetadata = pgTable('hoa_doc_metadata', {
  id: integer('id').primaryKey(),
  vectorId: text('vector_id').notNull().unique(),
  contentHash: text('content_hash').notNull(),
  communitySlug: text('community_slug').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  filePath: text('file_path').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: node upload_metadata.mjs <json_file_path>');
    process.exit(1);
  }

  const jsonFilePath = args[0];
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('Error: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  // Read metadata from JSON file
  const metadataRecords = JSON.parse(readFileSync(jsonFilePath, 'utf-8'));
  console.log(`Loaded ${metadataRecords.length} metadata records`);

  // Connect to database
  const client = postgres(databaseUrl);
  const db = drizzle(client, { schema: { hoaDocMetadata } });

  try {
    // Insert records in batches
    const batchSize = 100;
    for (let i = 0; i < metadataRecords.length; i += batchSize) {
      const batch = metadataRecords.slice(i, i + batchSize);
      const values = batch.map(record => ({
        id: record.id,
        vectorId: record.vector_id,
        contentHash: record.content_hash,
        communitySlug: record.community_slug,
        type: record.type,
        title: record.title,
        filePath: record.file_path,
      }));

      await db.insert(hoaDocMetadata)
        .values(values)
        .onConflictDoUpdate({
          target: hoaDocMetadata.id,
          set: {
            vectorId: sql`excluded.vector_id`,
            contentHash: sql`excluded.content_hash`,
            communitySlug: sql`excluded.community_slug`,
            type: sql`excluded.type`,
            title: sql`excluded.title`,
            filePath: sql`excluded.file_path`,
          }
        });
      console.log(`Upserted batch ${Math.floor(i / batchSize) + 1} (${values.length} records)`);
    }

    console.log(`✓ Successfully uploaded ${metadataRecords.length} metadata records to Supabase`);
  } catch (error) {
    console.error('Error uploading metadata:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
