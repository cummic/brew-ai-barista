# Brew — AI Barista

> A conversational ordering assistant for a Manhattan coffee shop with multiple locations.
> Built as a portfolio proof-of-concept to demonstrate AI product management and system design.

![Demo placeholder — GIF coming soon]

---

## The Product Problem

Ordering coffee at a busy transit hub is a friction-filled experience — long lines,
inconsistent orders, no cross-location loyalty, and no way to order ahead without
navigating a multi-step app funnel. Brew replaces the funnel with a conversation.
Instead of tapping through menus, customers talk to Brew the same way they'd talk
to a real barista. The AI handles location confirmation, inventory awareness,
personalized suggestions, pricing, and order submission — in natural language,
in under two minutes.

The reason AI makes sense here specifically: the ordering domain is constrained
enough that a well-prompted model can be highly reliable, but complex enough
(per-location inventory, modifier pricing, ambiguity resolution) that a
rule-based system would be brittle. A conversational interface also opens the
product to users who struggle with traditional app funnels — low-vision customers,
hands-free ordering via CarPlay, or kiosk-based ordering in-store.

---

## AI System Design Decisions

This section explains the key architectural choices, what the alternatives were,
and why these tradeoffs were made. These were not defaults — each was evaluated
explicitly before implementation.

### Model: Claude Haiku over Sonnet, GPT-4, and Gemini

Claude Haiku was chosen after evaluating tool-calling reliability, API pricing,
prompt caching availability, and fit for this specific use case.

- **vs. Claude Sonnet**: Sonnet produces higher-quality responses but at ~5x the
  cost and meaningfully higher latency. For a constrained ordering domain with
  short, structured conversations, Haiku's quality is sufficient and the cost and
  speed difference is significant.
- **vs. GPT-4**: Claude's tool-calling behavior is more predictable and consistent
  in agentic multi-turn flows. For a use case where tool misuse (e.g. submitting
  an order before confirmation) has real consequences, reliability matters more
  than raw capability.
- **vs. Gemini**: Gemini's large context window is a meaningful advantage for
  document-heavy use cases. This is not one — conversations are short and
  structured. Claude's prompt caching and tool-calling maturity were the deciding
  factors.
- **vs. custom ML model**: Training a custom recommendation model was evaluated
  and ruled out at POC stage. The build time and data requirements don't justify
  the investment until there is real ordering history at scale. Claude API handles
  personalization well enough for a proof of concept.

### Tool-Calling Architecture

Brew uses Claude's native tool-calling rather than pure prompt-based ordering
for a specific reason: reliability. A prompt-only approach can produce
well-formatted responses most of the time, but "most of the time" isn't
acceptable when the output is a submitted order with pricing. Tool-calling
creates hard checkpoints — `calculate_total` must be called before any price
is quoted, `submit_order` can only fire after explicit customer confirmation —
that can't be bypassed by model drift or prompt injection.

Four tools in total: `capture_user_name`, `get_store_info`, `calculate_total`, and `submit_order`. Each has a single responsibility and clear pre-conditions defined in the system prompt. A fifth tool (`track_selection`) was removed after testing showed it added ~10 seconds of latency per order by triggering redundant API call cycles — the order summary UI was refactored to a lazy-load cart model instead.

### Prompt Caching

Anthropic's prompt caching is implemented on both the system prompt and the
tool list. Without caching, every API call in a multi-turn conversation pays
full input token cost for the entire system prompt — roughly 1,400 tokens
re-processed on every turn. With caching, turns after the first pay ~10% of
that cost on cache reads.

The key implementation detail: `cache_control` is pinned to the last tool in
the static tool list at build time rather than dynamically. Dynamic pinning
was the original implementation and it busted the cache on every turn by
changing the cache boundary as tools were filtered in and out.

### Inventory Enforcement: Two Layers

Inventory availability varies by location — Penn Station doesn't carry cortado
or almond milk, for example. Enforcement happens at two independent layers:

1. **Prompt layer**: After `get_store_info` fires, a `LOCATION LOCKED` block
   is appended to the system prompt listing only the items stocked at that
   location. Claude is instructed never to accept or suggest items outside
   this list.
2. **Server layer**: `calculate_total` validates the requested items against
   the cached `locationInventory` in `orderState` before computing anything.
   If an item isn't stocked, the tool returns an error rather than a price.

Both layers are necessary. The prompt layer prevents Claude from offering
unavailable items. The server layer prevents an order from being calculated —
and potentially submitted — even if the prompt layer is bypassed by an unusual
conversation path or adversarial input.

### Guardrails Design

The threat model for a coffee ordering app is narrow but real: prompt injection
attempts, off-topic requests that consume API budget, location ambiguity that
leads to wrong-location orders, and price hallucination. Guardrails address
each specifically:

- **Prompt injection**: `guardrails.ts` runs a pattern check on every user
  message before it reaches Claude
- **Off-topic redirection**: System prompt instructs Claude to redirect
  non-coffee requests warmly but immediately, with no tool calls fired
- **Location ambiguity**: A code-level regex check in `routes.ts` intercepts
  ambiguous location terms ("the station", "downtown") before the API call
  and returns a clarification request instantly — no API cost incurred
- **Price hallucination**: An output validator checks every dollar amount in
  Claude's response against the `calculate_total` result and flags mismatches
- **Bulk order interception**: A code-level check in `routes.ts` detects group or multi-item order language ("for my office", quantities > 1, numbered item lists) and redirects immediately before any API call is made — protecting against the math failures that occur when Claude attempts multi-item order calculations beyond the single-order schema

### Eval Suite: 17 Test Cases, 7 Categories

The eval suite was designed before any evaluation code was written — test cases
first, runner second. 17 cases across 7 categories — adding a bulk/group order redirect case (e.g. "4 lattes for my office" must be intercepted before any API call is made):

- **Happy path** (3 cases): Full order flow at each location
- **Inventory restriction** (4 cases): Items not stocked at a location must
  be declined, never submitted
- **Location ambiguity** (2 cases): Vague location terms must not trigger
  `get_store_info`
- **Price validation** (1 case): Prices must come from `calculate_total`,
  never invented
- **Menu requests** (5 cases): Menu display rules — location must be confirmed
  first, one location at a time
- **Guardrails** (1 case): Off-topic requests must be redirected with no tools
  called
- **Bulk order redirect** (1 case): Multi-item or group orders intercepted before any API call

The eval runner uses a concurrency-controlled parallel executor and a golden
dataset (`golden_dataset.json`) that defines expected tool sequences and
constraint violations for each case. Run with:
```bash
EVAL_MODE=true npx tsx server/evaluate.ts
```

---

## Observability & Analytics

One of the core beliefs behind Brew is that an AI product you can't measure is
a product you can't improve. Observability was designed into the system from
the start, not added as an afterthought.

### Application-Level Logging

Every API call logs stop reason, latency, tool usage, prompt cache hit/miss,
and output validation result in real time. If something goes wrong
mid-conversation, the full interaction can be reconstructed within seconds.

### Supabase Analytics Dashboard (13 Saved Queries)

A custom SQL analytics layer built in Supabase covering three tiers:

**Business metrics**
- Order Summaries — volume and completion rates by location
- User Orders with Product Modifiers — what customers order and how they
  customize it
- User Activity Summary — repeat usage patterns across sessions

**Conversation & funnel metrics**
- User Session Turn Summary — turns to order completion (a proxy for UX
  friction)
- Conversation Session Summary — session-level conversation progression
- Recent Short or Failed Conversations — the most important debug view;
  short sessions almost always mean something went wrong
- Conversation Performance Summary — latency and tool call counts across
  sessions

**AI behavior metrics**
- Tool Usage Counts — which tools Claude calls and how often; unexpected
  patterns signal prompt drift
- Modifier Groups and Order Item Modifiers — how inventory and customization
  choices are used in practice
- Conversation Transcript Retrieval — full session replay for qualitative
  review when a metric looks off

### Diagnostic Approach

If a user reports something felt off: read the conversation transcript first
to understand qualitatively what happened, then check whether the order
completed, then look at turn count and tool usage to identify where the flow
broke down. Quantitative metrics confirm the pattern; the transcript tells
you why.

---

## What I Built vs. What AI Generated

I came into this project as a non-technical PM. Every line of code was
generated by Replit Agent or Claude — but the product decisions, architecture
tradeoffs, and system design were mine.

**What I designed and directed:**
- The end-to-end conversation flow — how Brew sequences questions, handles
  ambiguity, enforces location confirmation before inventory lookup, and
  recovers from edge cases
- The system prompt — I defined the behavioral rules (ask for name first,
  never invent a price, redirect off-topic questions, confirm location before
  any inventory lookup), then directed AI to translate those rules into a
  prompt. The distinction matters: the rules reflect product decisions, the
  prompt is implementation.
- The eval suite — 16 test cases across 6 categories written before a single
  line of evaluation code existed
- The two-layer inventory enforcement architecture — I identified that relying
  on Claude alone to enforce inventory wasn't safe enough for order accuracy
  and directed Replit to add a server-side validation layer in `calculate_total`
  as a backstop. Prompt-only enforcement can be bypassed by unusual conversation
  paths; the server layer catches what the prompt misses.
- Key technical decisions made after evaluating options with explicit pros/cons
  and cost analysis:
  - Model selection (Haiku over Sonnet, GPT-4, Gemini) after evaluating
    tool-calling reliability, pricing, and use case fit
  - Database selection — started with Replit static JSON to get the demo
    running quickly. As soon as per-location inventory became a requirement,
    it became clear the static file would break — menu updates would require
    code changes and cross-location queries weren't feasible. Evaluated
    Supabase vs. Clerk: ruled out Clerk because it's primarily built for
    authentication and would have added unnecessary complexity for a POC
    not requiring user auth. Chose Supabase for cost, ease of setup, and
    API-based database performance. Within Supabase, chose a relational
    model because inventory, modifiers, locations, and orders have real
    relationships that a flat structure would make brittle to query and extend.
  - Prompt caching implementation after identifying it as the highest-leverage
    cost and latency reduction available
  - Cart model for order summary — replaced live `track_selection` updates
    with a lazy-load pattern (summary only fetches when the user opens the
    cart), saving 2+ seconds on 3–4 turns per order

**What AI generated under my direction:**
- All application code — frontend, backend, database schema, API routes
- Evaluation runner, concurrency logic, and rate limiting
- Prompt caching optimization, SSE streaming setup, and Supabase integration

The skill this project demonstrates isn't coding — it's knowing what to
build, why to build it that way, how to evaluate whether it's working, and
how to make principled tradeoffs under constraints.

---

## What I Would Do With More Time

**Solve the latency problem properly.**
Every tool-use turn requires two sequential API calls, causing 3–6 seconds
of blank screen before text appears. In e-commerce, small latency differences
directly impact conversion — this is the metric I'd watch most closely in
beta. The real fix is speculative tool execution: prefetch store inventory
the moment a location name appears in the user's message, before Claude's
first API call completes. I know exactly what to build — I ran out of time
to validate the tradeoff against eval regression risk.

**Authentication, payment, and real POS integration.**
The POC uses a "card on file" placeholder. A production version needs real
payment processing and bidirectional POS integration — either native Supabase
if the operator already uses it, or a clean API layer that any chain (Square,
Toast, custom) can integrate against. Nutritional labeling requirements would
also need to be addressed, which vary by jurisdiction and chain size.

**Repeat customer intelligence and proactive ordering.**
Brew currently treats every session as a first interaction. A smarter version
remembers that you always order an almond latte on weekday mornings and
prompts you before you open the app — flipping from pull (user initiates)
to push (app anticipates). GPS-based location awareness would also eliminate
the location confirmation step and make the architecture viable for chains
with hundreds of locations.

**A larger, fully customizable menu.**
Brew is currently designed around one drink plus a pastry. A real deployment
needs Starbucks-level customization — size, shots, sweeteners, milk,
temperature, food, merch, tea. The conversation architecture supports this
but the menu data model and system prompt would need significant rework.

**The bigger vision.**
Brew is a proof of concept for a conversational ordering layer that any food
and beverage brand could license as a replacement for funnel-based ordering.
The same architecture works for in-store kiosks, CarPlay/Android Auto
hands-free ordering, and accessibility use cases for low-vision customers.
Extended to more complex menus, it becomes viable for fast casual chains —
a customer saying "I want something healthy, I'm lactose intolerant, what
do you recommend?" and getting a real personalized answer. The conversational
data generated at scale is also a compounding asset: it can train
client-specific models that embed brand voice, improve recommendation quality
over time, and surface product development insights from real ordering
behavior. None of that is in this repo — but the core architecture is
designed with it in mind.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, TypeScript, Tailwind CSS |
| Backend | Node.js, Express |
| AI | Claude Haiku (Anthropic) via tool-calling API |
| Database | Supabase (PostgreSQL) |
| Streaming | Server-Sent Events (SSE) |
| Eval | Custom parallel test runner, golden dataset |

---

## Local Setup
```bash
# 1. Clone the repo
git clone https://github.com/your-username/brew-ai-barista.git
cd brew-ai-barista

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp .env.example .env
# Edit .env and add your API keys (see Environment Variables below)

# 4. Start the dev server
npm run dev

# 5. Run the eval suite
EVAL_MODE=true npx tsx server/evaluate.ts
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key — get one at console.anthropic.com |
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key — required for server-side writes to orders, order_items, and conversation_logs |
| `SESSION_SECRET` | Any random string used to sign session cookies |

---

## Demo Note

This is a portfolio proof-of-concept. No real orders are placed and no
real charges are processed. Conversations are logged for development
purposes.
