# docs/architecture

How the system is put together and why each piece is where it is.

| Document | Contents |
| --- | --- |
| [overview.md](overview.md) | The system diagram, the end-to-end request path, the repository layout, the two Go modules, the environments. |
| [api.md](api.md) | Versioning, the five authorization tiers, the gateway's routing table, the error envelope and the conventions a new endpoint follows. |
| [data-model.md](data-model.md) | Tables, ownership columns, integrity triggers, indexes, storage buckets and the migration workflow. |
| [web-app.md](web-app.md) | The web app's stack, rendering, SEO/indexability rules, PWA state, data flow and performance notes. |

Security-specific documents live in [../security](../security), and the decisions
behind them in [../decisions](../decisions).

The one-line summary: **the UI is approved and frozen; the web app talks to a
versioned Go API; the API talks to Postgres through grants plus Row Level
Security; every service verifies tokens itself.**
