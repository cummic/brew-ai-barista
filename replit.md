# Brew — AI Barista (Manhattan Coffee Pilot)

## Overview

A mobile-first WhatsApp-style chat application where users can order lattes from an AI barista powered by Anthropic Claude 3.5 Sonnet. Limited to the Manhattan pilot program scope.

## Architecture

- **Frontend**: React + TypeScript + Tailwind CSS + Shadcn UI
- **Backend**: Node.js + Express
- **AI**: Anthropic Claude Sonnet 4.5 (`claude-sonnet-4-5`) with tool calling
- **State**: In-memory session manager (JSON-based order state)

## Pilot Scope

All pricing, locations, and menu items are defined in **`menu.json`** at the project root — the single source of truth. No prices or location data are hardcoded elsewhere.

- **Drink**: Latte only ($5.50 base)
- **Locations**: WTC (World Trade Center), Penn Station, Grand Central
- **Milk**: Whole (included), 2% (included), Almond (+$0.75)
- **Upsells**: Croissant ($3.50), Chocolate Croissant ($4.00)
- **Payment**: Card on file only
- **Tip**: 0% or 10%
- **Tax**: 8.875% (NYC rate)

## Key Files

- `server/barista.ts` — Claude integration, tool definitions, tool execution, output validator
- `server/guardrails.ts` — Prompt injection middleware
- `server/routes.ts` — API endpoints (`/api/session`, `/api/chat`)
- `server/storage.ts` — In-memory session/order state manager
- `shared/schema.ts` — Shared types, pricing constants, location data
- `client/src/pages/chat.tsx` — WhatsApp-style chat UI with order state panel

## API Endpoints

- `POST /api/session` — Create a new chat session
- `GET /api/session/:id` — Get session data
- `POST /api/session/:id/reset` — Reset session to fresh state
- `POST /api/chat` — Send a message and get AI barista response

## AI Tools

1. `calculate_total(milk_type, pastry, tip)` — Calculates exact price with tax/tip
2. `get_store_info(location_id)` — Returns address & status for a location
3. `submit_order(order_data)` — Finalizes and confirms the order

## Guardrails

- **Input**: Prompt injection detection middleware blocks ~17 patterns
- **Output**: Price validator ensures AI-quoted amounts match `calculate_total` results

## Order Flow Stages

`greeting` → `identifying` → `configuring` → `upselling` → `payment` → `confirmed`

## Environment Variables

- `ANTHROPIC_API_KEY` — Required. Stored as a Replit secret.
