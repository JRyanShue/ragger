import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { db } from '@/db';
import { queries, conversations } from '@/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import type { CreateQueryRequest, GetQueriesResponse } from '@/types/api';

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const conversationId = searchParams.get('conversationId');

    let queryBuilder = db
      .select()
      .from(queries)
      .where(eq(queries.userId, userId))
      .orderBy(desc(queries.createdAt))
      .limit(limit)
      .offset(offset);

    if (conversationId) {
      queryBuilder = db
        .select()
        .from(queries)
        .where(
          and(
            eq(queries.userId, userId),
            eq(queries.conversationId, conversationId)
          )
        )
        .orderBy(desc(queries.createdAt))
        .limit(limit)
        .offset(offset);
    }

    const userQueries = await queryBuilder;

    // Get total count
    const [countResult] = await db
      .select({ count: queries.id })
      .from(queries)
      .where(
        conversationId
          ? and(eq(queries.userId, userId), eq(queries.conversationId, conversationId))
          : eq(queries.userId, userId)
      );

    return NextResponse.json({
      queries: userQueries,
      total: userQueries.length,
    } satisfies GetQueriesResponse);
  } catch (error) {
    console.error('Error fetching queries:', error);
    return NextResponse.json(
      { error: 'Failed to fetch queries' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as CreateQueryRequest;

    // If conversationId is provided, verify it belongs to the user
    if (body.conversationId) {
      const [conversation] = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.id, body.conversationId),
            eq(conversations.userId, userId)
          )
        )
        .limit(1);

      if (!conversation) {
        return NextResponse.json(
          { error: 'Conversation not found' },
          { status: 404 }
        );
      }
    }

    const [query] = await db
      .insert(queries)
      .values({
        userId,
        conversationId: body.conversationId,
        query: body.query,
        response: body.response,
        tokensUsed: body.tokensUsed,
      })
      .returning();

    return NextResponse.json(query, { status: 201 });
  } catch (error) {
    console.error('Error creating query:', error);
    return NextResponse.json(
      { error: 'Failed to create query' },
      { status: 500 }
    );
  }
}
