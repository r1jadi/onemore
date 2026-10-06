# 0005 — RaiAccept for payments, behind a service boundary that does not exist yet

* Status: accepted
* Date: 2026-10-05

## Context

Payments will be needed (creator payouts, premium features, possibly entry fees),
and RaiAccept is the chosen provider. Nothing about payments may be implemented in
this phase: no fake checkout, no placeholder webhook, no Stripe, no price in the
UI.

What this phase can do is make the later integration boring: decide where the
money boundary is, and never let it blur.

## Decision

Payments will be a **separate service** (`services/payments`) with its own
database schema, its own credentials and no dependency from the game or social
services on it. Requirements fixed now:

1. **The server owns amounts, currency and product identity.** Nothing about a
   price is read from a client request; the client sends a product or plan id, and
   the server resolves the amount. `docs/security/threat-model.md` lists the same
   rule as "never trust client-provided prices".
2. **Order state is server state.** A `payments.orders` table (later task) is the
   source of truth, written inside a transaction with an idempotency key from the
   caller. A redirect response is a hint to the client, never proof of payment.
3. **Webhooks are verified.** RaiAccept's signature is verified against the raw
   request body with the shared secret; the handler is idempotent by event id, and
   it is the only place that transitions an order to paid.
4. **No card data.** RaiAccept's hosted flow means card details never touch this
   system; nothing in the codebase stores or logs payment instruments.
5. **Secrets are server-only.** `RAIACCEPT_API_KEY` and `RAIACCEPT_WEBHOOK_SECRET`
   are already declared in `.env.example` under *Deferred* and are read by nothing
   today. They never get a `VITE_` name.
6. **Auditability.** Every state change records who or what caused it, with the
   provider's event id, so a dispute can be reconstructed.
7. **Entitlements are separate from payment.** Whatever a purchase grants
   (credits, premium flags) is written as an entitlement row the rest of the system
   reads; no feature checks a payment provider directly.

Until the service exists, `/api/v1` documents no payment endpoints, and no UI
element pretends to purchase anything.

## Consequences

* The web app can be built against the API contract without knowing anything about
  RaiAccept, and swapping a provider later touches one service.
* Two teams of concerns stay separate: money and gameplay. A bug in a game can
  never spend money; a payment outage never blocks playing.
* The deferred environment variables exist but are inert, which is why they are
  grouped under a "Deferred" heading with this ADR as the explanation.
* Reversing the provider choice costs the payments service only, which is the
  point of the boundary.
