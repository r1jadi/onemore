# docs/security

What is defended, how, and — just as importantly — what is not yet.

| Document | Contents |
| --- | --- |
| [threat-model.md](threat-model.md) | Assets, actors, 23 threats with the control that answers each, and an honest gap list. |
| [data-access.md](data-access.md) | The authorization matrix per table and bucket, the roles, the rules the matrix encodes, and how to change the model. |
| [api-hardening.md](api-hardening.md) | The middleware chain in execution order, request validation, token verification, rate limiting, CORS and gateway specifics. |
| [env-and-secrets.md](env-and-secrets.md) | The public/secret rule, where secrets live, the exposure-response procedure and how to add a configuration value. |
| [testing.md](testing.md) | Every automated security check, where it runs, the results of this phase, and what is not covered. |

Related: [../decisions](../decisions) for why the model is shaped this way
(0003 authentication, 0004 rate limiting, 0006 dependencies, 0007 database
authorization, 0008 browser data access).

Two sentences that describe the current posture: **every exposed table is guarded
by both grants and RLS, and the denied cases are asserted in CI**; **what is not
yet defended — a document CSP, upload scanning, alerting, load testing — is listed
as a gap rather than implied to be done.**
