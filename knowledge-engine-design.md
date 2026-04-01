# Athlete OS — Knowledge Engine Design
**Version:** 1.0  
**Status:** Design complete — ready for Claude Code implementation  
**Language:** Node.js (matches all other services)  
**Last updated:** 2026-03-31

---

## Overview

The knowledge engine is the athlete's personal sports science library. It gives athletes a low-friction way to discover, ingest, annotate, and act on sports science knowledge — from peer-reviewed research to bike maintenance guides to homemade energy bar recipes.

It operates through two interfaces:
- **Coach chat** — conversational ingestion and discovery via WhatsApp
- **Knowledge browser** — the dedicated frontend surface for reading, annotating, and managing the library

All content is stored as searchable vector embeddings. The coaching engine can query this library when answering athlete questions or making training recommendations.

---

## Core concepts

### Resource

A resource is any piece of content the athlete adds to their library. It is the parent record that holds metadata, status, and links to both content chunks and note sets.

A resource can be:
- A PDF (book, paper, study)
- A URL (article, blog post, research abstract)
- Pasted text (manual entry, video transcript)
- A book reference (title + author, content ingested from available sources)

### Knowledge chunks

A resource is split into chunks for embedding and semantic search. Chunks are stored in the existing `knowledge_chunk` table. Each chunk references its parent resource via `resource_id`.

### Note sets

Each resource has three independent note sets:
1. **Athlete notes** — freeform, private, no structure
2. **Coach summary** — AI-generated on explicit request only. Never automatic.
3. **Coach instructions** — actionable notes for the coaching engine. Created by athlete, by coach (only on request), or both.

### Status

| Status | Condition |
|---|---|
| `queued` | Resource added, all three note sets empty |
| `in_progress` | Any note set has content |
| `done` | Athlete manually marks complete |
| `for_revision` | Athlete manually flags to revisit |

Status transitions:
- Add resource → `queued`
- Any note added → `in_progress` (automatic)
- Athlete action only → `done` or `for_revision`

---

## Schema additions

### New table: `resource`

```sql
CREATE TABLE resource (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id          UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  author              TEXT,
  source_type         TEXT NOT NULL,    -- 'pdf' | 'url' | 'text' | 'book' | 'video_transcript'
  source_url          TEXT,             -- original URL if applicable
  source_file_path    TEXT,             -- path to uploaded file if applicable
  evidence_level      TEXT NOT NULL,    -- 'evidence_based' | 'practitioner_consensus' | 'anecdote'
  evidence_level_auto BOOLEAN DEFAULT true,  -- false if athlete overrode auto-classification
  sport_tags          TEXT[],
  topic_tags          TEXT[],
  status              TEXT DEFAULT 'queued',  -- 'queued' | 'in_progress' | 'done' | 'for_revision'
  ingestion_status    TEXT DEFAULT 'pending', -- 'pending' | 'processing' | 'complete' | 'failed'
  chunk_count         INT DEFAULT 0,
  word_count          INT,
  ingestion_path      TEXT,             -- 'A' | 'B' | 'C'
  discovery_topic     TEXT,             -- for paths B and C: the topic that led to this resource
  athlete_notes       TEXT,             -- freeform athlete notes
  coach_summary       TEXT,             -- AI-generated summary, null until requested
  coach_instructions  TEXT,             -- actionable notes for coaching engine
  coach_summary_requested_at  TIMESTAMPTZ,
  coach_instructions_requested_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_resource_athlete ON resource(athlete_id);
CREATE INDEX idx_resource_status ON resource(athlete_id, status);
CREATE INDEX idx_resource_tags ON resource USING GIN(topic_tags);
```

### Modify `knowledge_chunk` table

Add `resource_id` foreign key to link chunks to their parent resource:

```sql
ALTER TABLE knowledge_chunk ADD COLUMN resource_id UUID REFERENCES resource(id) ON DELETE CASCADE;
CREATE INDEX idx_knowledge_chunk_resource ON knowledge_chunk(resource_id);
```

### New API endpoints required

```
POST   /knowledge/resources              ← create resource record, trigger ingestion
GET    /knowledge/resources              ← list resources with filters
GET    /knowledge/resources/:id          ← single resource with chunks and notes
PATCH  /knowledge/resources/:id          ← update notes, status, tags
DELETE /knowledge/resources/:id          ← soft delete
POST   /knowledge/resources/:id/summary  ← request coach summary (triggers AI call)
POST   /knowledge/resources/:id/instruct ← request coach instruction (triggers AI call)
POST   /knowledge/discover               ← paths B and C: find resources on a topic
GET    /knowledge/topics                 ← path C: get suggested topics from coaching engine
```

---

## The three ingestion paths

### Path A — Bring your own resource

**Chat flow:**
1. Athlete sends resource to coach (URL, file, or pasted text) with or without a request
2. Coach acknowledges and asks: "Got it. Would you like me to add this to your library? I can ingest it and save it for later, or ingest it now and you can add notes when ready."
3. On confirmation: coach creates the resource record, triggers ingestion job
4. Coach confirms: "Added to your library under [title]. Status: queued. Let me know if you'd like a summary or have specific questions about it."
5. Summary only generated if athlete explicitly asks: "Can you summarise it?" or "What are the key points?"

**Interface flow:**
1. Athlete clicks "Add resource" button in knowledge browser
2. Upload area appears: drag-and-drop for PDF, text box for URL or paste, text field for book title
3. Evidence level selector (auto-classified by default, athlete can override)
4. Optional: topic tags
5. Submit → resource created → ingestion starts → status shows `queued`

**For video content:**
Coach prompts: "Paste the transcript and I'll ingest it." Athlete pastes. Coach ingests as `source_type: 'video_transcript'`. No automatic transcription in V1.

---

### Path B — Targeted search

**Chat flow:**
1. Athlete: "Find me resources on heat training for cycling"
2. Coach: "What level of evidence are you looking for? Evidence-based (peer-reviewed research), practitioner consensus (experienced coaches and books), or anecdote (blogs and personal accounts)?"
3. Athlete selects level
4. Coach searches, evaluates quality, returns exactly 3 options:

```
Here are 3 resources on heat training for cycling:

1. "Heat Acclimatization for Endurance Athletes" — Lorenzo et al. (2010)
   Type: Peer-reviewed paper | Evidence: evidence-based
   Why relevant: Foundational study on heat training protocols for cyclists. 
   Shows 10-day heat acclimation increases plasma volume and VO2max.
   → journals.physiology.org/...

2. "Training in the Heat" — Joe Friel, Fast After 50
   Type: Book chapter | Evidence: practitioner consensus  
   Why relevant: Practical protocols from a coach who has worked with masters athletes.
   → Available on Amazon

3. "My 4-Week Heat Training Block" — Dylan Johnson (YouTube)
   Type: Video | Evidence: anecdote
   Why relevant: Practical implementation with power data from a real training block.
   → youtube.com/...

Which would you like to add to your library? (Reply 1, 2, 3, or any combination)
```

5. Athlete selects → coach ingests selected resources → confirms added to library

**Interface flow:**
1. Athlete clicks "Find resources" button
2. Text box: "What topic are you interested in?"
3. Evidence level selector: three options with brief descriptions
4. Submit → engine searches → returns 3 resource cards with title, type, evidence badge, relevance sentence, link
5. Each card has an "Add to library" button
6. Selected resources ingested on click

---

### Path C — Proactive suggestion

**Chat flow:**
1. Athlete: "What should I be reading about right now?" or "Suggest something interesting"
2. Coach selects a topic based on current context (training period, limiters, recent metrics, upcoming race) and can also be creative — nutrition, equipment, physiology, mental performance, race logistics, anything
3. Coach: "Given that you're in week 6 of base and your sleep scores have been averaging 68, I'd suggest exploring sleep optimisation for endurance athletes. Want me to find resources on that?"
4. Athlete confirms → coach asks evidence level preference → returns 3 resources (same format as Path B)
5. Athlete selects → ingested

**Context the engine uses for topic selection:**
- Current period type and week
- Athlete's identified limiters
- Recent readiness and HRV trends
- Upcoming race and distance
- Topics already in the library (avoid repetition)
- Time of season (base → aerobic physiology, build → intensity and performance, peak/race → race execution and nutrition)
- Creative expansion: equipment, recovery tools, biomechanics, sports psychology, nutrition, physiology, anything that could make the athlete better or smarter

**Interface flow:**
1. Athlete clicks "Explore topics" button
2. Engine generates 5-8 topic suggestions based on athlete context, displayed as clickable cards
3. Each card shows: topic name, why it was suggested (one sentence), recommended evidence level
4. Athlete clicks a topic → evidence level selector appears → returns 3 resources
5. Same "Add to library" flow as Path B

---

## Ingestion pipeline

### Step 1 — Content extraction

| Source type | Extraction method |
|---|---|
| PDF | `pdf-parse` npm library — extracts raw text |
| URL | `axios` fetch + `cheerio` HTML parser — strips navigation, ads, extracts main content |
| Text paste | Direct — no extraction needed |
| Video transcript | Direct — athlete provides text |
| Book reference | Web search for available previews, abstracts, or summaries |

### Step 2 — Chunking

Split extracted text into overlapping chunks for embedding:

```javascript
const CHUNK_CONFIG = {
  chunk_size: 500,      // words per chunk
  chunk_overlap: 50,    // words of overlap between chunks
  min_chunk_size: 100   // discard chunks smaller than this
}
```

Each chunk gets: `resource_id`, `source_title`, `source_author`, `source_type`, `evidence_level`, `sport_tags`, `topic_tags`, `chunk_index`, `content`.

### Step 3 — Auto-classification

Before embedding, classify the resource:

```javascript
// Evidence level auto-classification
function classifyEvidence(resource) {
  if (source_type === 'pdf' && hasDOI(content)) return 'evidence_based'
  if (source_type === 'url' && isJournalDomain(url)) return 'evidence_based'
  if (author matches known coaches/researchers) return 'practitioner_consensus'
  return 'anecdote'  // default
}

// Topic tag auto-classification
// Send first 500 words to AI with a short classification prompt
// Returns: sport_tags[], topic_tags[]
// Uses Haiku — cheap classification call
```

### Step 4 — Embedding

Each chunk is embedded using the Anthropic API (or OpenAI text-embedding-3-small — whichever is configured). Embedding stored in `knowledge_chunk.embedding` as a `vector(1536)`.

```javascript
// Batch embedding to reduce API calls
// Process chunks in batches of 20
// Store immediately — resume on failure
```

### Step 5 — Update resource record

```javascript
await api.patch(`/knowledge/resources/${resourceId}`, {
  ingestion_status: 'complete',
  chunk_count: chunks.length,
  word_count: totalWords,
  sport_tags: autoTags.sport,
  topic_tags: autoTags.topic,
  evidence_level: autoClassified
})
```

---

## Coach summary generation

Triggered only by explicit athlete request: "Can you summarise this?" in chat, or "Generate summary" button in interface.

```javascript
async function generateCoachSummary(resourceId) {
  // Fetch all chunks for this resource
  const chunks = await api.get(`/knowledge/resources/${resourceId}/chunks`)
  const fullText = chunks.map(c => c.content).join('\n\n')

  // Truncate to fit context if very long resource
  const truncated = fullText.slice(0, 8000)  // ~6000 words

  const summary = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',  // cheap — summaries are routine
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `You are summarising a sports science resource for an endurance athlete.
        Produce a concise summary (300-400 words) covering:
        1. Main argument or finding
        2. Key practical takeaways for training
        3. Evidence quality and any limitations
        4. Relevance to endurance sport

        Resource: ${fullText.slice(0, 8000)}`
    }]
  })

  await api.patch(`/knowledge/resources/${resourceId}`, {
    coach_summary: summary.content[0].text,
    coach_summary_requested_at: new Date().toISOString()
  })
}
```

---

## Coach instruction generation

Triggered only by explicit athlete request: "What should I do with this?" or "Add instructions for my coach" in chat, or "Ask coach for instructions" button in interface.

The coach reads the resource summary and the athlete's current training context, then produces specific actionable instructions:

```javascript
async function generateCoachInstructions(resourceId, athleteContext) {
  const resource = await api.get(`/knowledge/resources/${resourceId}`)
  const context = athleteContext  // current period, limiters, upcoming race

  const instructions = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',  // Sonnet for nuanced coaching reasoning
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `You are a sports coach reviewing a resource your athlete has added to their library.
        Based on their current training context, produce specific actionable instructions.

        Resource: ${resource.title} by ${resource.author}
        Summary: ${resource.coach_summary}

        Athlete context:
        - Current period: ${context.period_type} week ${context.week_number}
        - Primary limiter: ${context.limiter}
        - Upcoming race: ${context.event_name} in ${context.weeks_to_race} weeks

        Produce 2-3 specific, actionable instructions for how to apply this knowledge 
        to the athlete's current training. Be specific and practical.`
    }]
  })

  await api.patch(`/knowledge/resources/${resourceId}`, {
    coach_instructions: instructions.content[0].text,
    coach_instructions_requested_at: new Date().toISOString()
  })
}
```

---

## Web search for resource discovery (Paths B and C)

Uses the Anthropic API with web search tool enabled:

```javascript
async function discoverResources(topic, evidenceLevel) {
  const evidencePrompt = {
    'evidence_based': 'Find peer-reviewed research papers, meta-analyses, or systematic reviews',
    'practitioner_consensus': 'Find books, articles, or content from established coaches and practitioners',
    'anecdote': 'Find blog posts, video content, or first-person accounts from athletes or coaches'
  }[evidenceLevel]

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{
      role: 'user',
      content: `Find exactly 3 high-quality resources about "${topic}" for endurance athletes.
        ${evidencePrompt}.
        
        For each resource return:
        - title
        - author or creator
        - source_type (paper/book/article/video)
        - evidence_level (evidence_based/practitioner_consensus/anecdote)
        - relevance_sentence (one sentence on why this is valuable)
        - url or reference
        
        Return as JSON array only.`
    }]
  })

  return parseDiscoveryResults(response)
}
```

---

## Semantic search

The existing `GET /knowledge/search` endpoint handles semantic search. The knowledge engine also supports:

**Filtered search** — search within a specific status, evidence level, or tag:
```
GET /knowledge/search?q=recovery+sleep&evidence=evidence_based&status=done
```

**Related resources** — given a resource, find similar chunks across the library:
```
GET /knowledge/resources/:id/related
```

**Coach-triggered search** — when the coaching engine needs context for a question, it searches the knowledge base and injects relevant chunks into the AI context window (already part of the `full` context mode).

---

## Knowledge browser interface requirements

The knowledge browser frontend needs to support these views. Passed to frontend design phase — this is the spec:

### Library view
- List of all resources with: title, author, source type badge, evidence level badge, status badge, topic tags, date added
- Filter bar: by status, evidence level, sport tag, topic tag
- Sort: by date added, status, title
- Three action buttons prominently displayed: "Add resource" (A), "Find resources" (B), "Explore topics" (C)

### Resource detail view
- Header: title, author, source type, evidence level, status selector
- Tab 1 — Content: paginated chunk display, in-chunk text search
- Tab 2 — Athlete notes: freeform text editor, autosave
- Tab 3 — Coach summary: displays generated summary or "Request summary" button
- Tab 4 — Coach instructions: displays instructions, "Request instructions" button, athlete can also type their own
- Tags editor: sport tags, topic tags, freeform tags
- Related resources panel (sidebar)

### Status workflow
Status displayed as a pill the athlete can click to advance:
`queued` → `in_progress` → `done` ↔ `for_revision`

The `queued` → `in_progress` transition also happens automatically when any note is added.

---

## Service folder structure

```
knowledge-engine/
  src/
    ingestion/
      contentExtractor.js    ← PDF, URL, text extraction
      chunker.js             ← text splitting with overlap
      embedder.js            ← embedding API calls, batched
      classifier.js          ← evidence level + tag auto-classification
      ingestionPipeline.js   ← orchestrates extract→chunk→classify→embed→store
    discovery/
      resourceFinder.js      ← web search + result parsing (paths B and C)
      topicSuggester.js      ← generates contextual topic suggestions (path C)
    notes/
      summaryGenerator.js    ← coach summary on request
      instructionGenerator.js ← coach instructions on request
    search/
      semanticSearch.js      ← vector similarity search
      relatedFinder.js       ← find similar resources
    api/
      client.js              ← Athlete OS API HTTP client
    index.js                 ← entry point, starts ingestion job queue
  package.json
  .env.template
```

---

## Build order for Claude Code

1. **Schema migration** — add `resource` table, add `resource_id` to `knowledge_chunk`
2. **New API endpoints** — 9 endpoints listed above added to API layer
3. **Scaffolding** — package.json, folder structure
4. **Content extractor** — PDF, URL, text
5. **Chunker** — text splitting
6. **Classifier** — evidence level and tag auto-classification
7. **Embedder** — batched embedding calls
8. **Ingestion pipeline** — orchestrates all above, called by API on resource creation
9. **Summary generator** — on-request coach summary
10. **Instruction generator** — on-request coach instructions
11. **Resource finder** — web search for paths B and C
12. **Topic suggester** — path C proactive suggestions
13. **Semantic search** — vector similarity, filtered search, related resources
14. **Index.js** — entry point

---

## Opening prompt for Claude Code

```
Read CLAUDE.md then read knowledge-engine-design.md.

Before writing any code, run these migrations on the athleteos database:

CREATE TABLE resource (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id          UUID NOT NULL REFERENCES athlete(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  author              TEXT,
  source_type         TEXT NOT NULL,
  source_url          TEXT,
  source_file_path    TEXT,
  evidence_level      TEXT NOT NULL,
  evidence_level_auto BOOLEAN DEFAULT true,
  sport_tags          TEXT[],
  topic_tags          TEXT[],
  status              TEXT DEFAULT 'queued',
  ingestion_status    TEXT DEFAULT 'pending',
  chunk_count         INT DEFAULT 0,
  word_count          INT,
  ingestion_path      TEXT,
  discovery_topic     TEXT,
  athlete_notes       TEXT,
  coach_summary       TEXT,
  coach_instructions  TEXT,
  coach_summary_requested_at  TIMESTAMPTZ,
  coach_instructions_requested_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX idx_resource_athlete ON resource(athlete_id);
CREATE INDEX idx_resource_status ON resource(athlete_id, status);
CREATE INDEX idx_resource_tags ON resource USING GIN(topic_tags);

ALTER TABLE knowledge_chunk ADD COLUMN resource_id UUID REFERENCES resource(id) ON DELETE CASCADE;
CREATE INDEX idx_knowledge_chunk_resource ON knowledge_chunk(resource_id);

Then add the 9 new knowledge endpoints to the existing API layer 
(api/src/routes/knowledge.js). Show me the endpoint list before 
adding any code.

Important: every Anthropic API call in this service must write to 
api_usage_log via POST /usage/log (or directly via the db client if 
the endpoint is not available). Use the same logUsage pattern 
established in the coaching engine's conversationSummary.js.
```

---

*End of knowledge engine design. Ready for Claude Code implementation.*
