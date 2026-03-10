# Brew — AI Barista (Manhattan Coffee Pilot)

## Overview

A mobile-first WhatsApp-style chat application where users can order coffee from an AI barista powered by Anthropic Claude Sonnet 4.5. Limited to the Manhattan pilot program scope.

## Architecture

- **Frontend**: React + TypeScript + Tailwind CSS + Shadcn UI
- **Backend**: Node.js + Express
- **AI**: Anthropic Claude Sonnet 4.5 (`claude-sonnet-4-5`) with tool calling
- **State**: In-memory session manager (JSON-based order state per session)
- **Database**: Supabase (menu catalog + order persistence)

## Pilot Scope

Menu data lives entirely in **Supabase** — no `menu.json` or hardcoded catalog data in code. Prices, products, and modifiers are fetched at server startup via `server/db.ts`.

- **Drinks**: Latte ($5.50 base), Cortado ($4.00 base)
- **Locations**: WTC (World Trade Center), Penn Station, Grand Central
- **Milk modifiers**: Whole (id: `whole`, included), 2% (id: `2pct`, included), Almond (id: `almond`, +$0.75)
- **Pastries**: Croissant ($3.50), Chocolate Croissant ($4.00)
- **Payment**: Card on file only
- **Tip**: 0% or 10%
- **Tax**: 8.875% (NYC rate, constant in `barista.ts`)

## Supabase Tables

### Menu catalog (read at startup)
- `locations` — id, name, address, status, hours
- `products` — id, category (drink/pastry), name, base_price
- `modifier_groups` — id, name
- `modifiers` — id, modifier_group_id, name, upcharge
- `product_modifier_groups` — product_id, modifier_group_id (links drinks to required milk choice)

### Order persistence (written on submit_order)
- `orders` — id, session_id, user_name, location_id, total_price, status, created_at
- `order_items` — id, order_id, product_id, total_price
- `order_item_modifiers` — order_item_id, modifier_id

### Observability
- `conversation_logs` — user_id, session_id, prompt, response, latency_ms, tools_used, validation_passed, environment

## Key Files

- `server/db.ts` — Supabase client, menu data loader (`loadMenuData`), order inserter (`insertOrder`)
- `server/barista.ts` — Claude integration; `initMenu()` called at startup; tool definitions built from DB data; tool execution including async `submit_order` DB write
- `server/guardrails.ts` — Prompt injection middleware
- `server/observability.ts` — Async Supabase conversation logging
- `server/rateLimit.ts` — In-memory rate limiter (10 req/min per IP+session)
- `server/routes.ts` — API endpoints (`/api/session`, `/api/chat`)
- `server/storage.ts` — In-memory session/order state manager
- `server/evaluate.ts` — Automated eval suite (15 golden test cases)
- `shared/schema.ts` — Shared types: `OrderState` (includes `userName`), `MilkType` uses `"2pct"` not `"2%"`
- `client/src/pages/chat.tsx` — WhatsApp-style chat UI with order state panel and Reset Session button

## Startup Sequence

`initMenu()` is called in `server/index.ts` before routes are registered. It fetches all 5 menu tables from Supabase in parallel and caches the result in memory. System prompt and tool schemas are built once from this cached data.

## API Endpoints

- `POST /api/session` — Create a new chat session
- `GET /api/session/:id` — Get session data
- `POST /api/session/:id/reset` — Reset session to fresh state
- `POST /api/chat` — Send a message and get AI barista response

## AI Tools (Claude tool-use)

1. `capture_user_name(name)` — Stores name in session; called as soon as user gives their name
2. `calculate_total(drink, milk_type, pastry, tip)` — Calculates exact price using DB pricing
3. `get_store_info(location_id)` — Returns location info + full product/modifier inventory
4. `submit_order(order_data)` — Writes to `orders`, `order_items`, `order_item_modifiers`

## Guardrails

- **Input**: Prompt injection detection middleware blocks ~17 patterns
- **Output**: Price validator ensures AI-quoted amounts match `calculate_total` results

## Order Flow Stages

`greeting` → name capture → location confirm → `configuring` → upsell → payment → `confirmed`

## Environment Variables / Secrets

- `ANTHROPIC_API_KEY` — Required. Stored as Replit secret.
- `SUPABASE_URL` — Required. Stored as Replit secret.
- `SUPABASE_SERVICE_ROLE_KEY` — Required. Stored as Replit secret.
- `SESSION_SECRET` — Stored as Replit secret.

## Running the Eval Suite

```bash
npx tsx server/evaluate.ts
```

Note: `initMenu()` is called at the top of `main()` so the suite works standalone.
