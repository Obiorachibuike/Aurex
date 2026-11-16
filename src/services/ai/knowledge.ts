import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { knowledgeDocuments } from "@/db/schema";

export type KnowledgeHit = { id: string; slug: string; title: string; type: string; content: string; rank: number; /** Share of the question's meaningful words found in the document (0–1). */ coverage: number };

const STOP = new Set("who whom whose yesterday today tomorrow a an the is are was do does did can could would will i you we they it my your our me to of in on for with and or what when where how which who why much many long about there their this that please tell know want need like get have has any some be am".split(" "));

/** Turns a customer question into an OR tsquery of meaningful words. */
export function queryWords(text: string): string[] {
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)))].slice(0, 12);
}
export function toTsQuery(text: string): string | null {
  const words = queryWords(text);
  return words.length ? words.map((w) => `${w}:*`).join(" | ") : null;
}

/** Retrieval for RAG: PostgreSQL full-text search over published knowledge documents. */
export async function searchKnowledge(query: string, limit = 3): Promise<KnowledgeHit[]> {
  const q = toTsQuery(query);
  if (!q) return [];
  const words = queryWords(query);
  const rank = sql<number>`ts_rank_cd(${knowledgeDocuments.searchVector}, to_tsquery('english', ${q}))`;
  const matched = sql<number>`(${sql.join(words.map((w) => sql`(${knowledgeDocuments.searchVector} @@ to_tsquery('english', ${`${w}:*`}))::int`), sql` + `)})`;
  const rows = await db
    .select({ id: knowledgeDocuments.id, slug: knowledgeDocuments.slug, title: knowledgeDocuments.title, type: knowledgeDocuments.type, content: knowledgeDocuments.content, rank, matched })
    .from(knowledgeDocuments)
    .where(and(eq(knowledgeDocuments.isPublished, true), sql`${knowledgeDocuments.searchVector} @@ to_tsquery('english', ${q})`))
    .orderBy(sql`${matched} desc`, sql`${rank} desc`)
    .limit(limit);
  return rows.map(({ matched: m, ...r }) => ({ ...r, rank: Number(r.rank), coverage: Number(m) / words.length }));
}

export async function getKnowledgeDoc(slug: string) {
  const [doc] = await db.select().from(knowledgeDocuments).where(and(eq(knowledgeDocuments.slug, slug), eq(knowledgeDocuments.isPublished, true))).limit(1);
  return doc ?? null;
}

export async function listKnowledge(type?: "FAQ" | "POLICY" | "BUSINESS" | "WHOLESALE") {
  return db.select().from(knowledgeDocuments).where(and(eq(knowledgeDocuments.isPublished, true), type ? eq(knowledgeDocuments.type, type) : undefined)).orderBy(asc(knowledgeDocuments.sortOrder));
}
