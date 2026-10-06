# packages/api-contracts

`openapi-v1.yaml` is the published contract for `/api/v1`: every group, tier,
request shape, response shape and error code.

## Reading it

Operations carry `x-status`:

* `available` — implemented.
* `planned` — the route exists, is authorized and rate limited, and answers
  `501` until the feature task that owns it lands. The shape is final enough to
  write a client against, which is the point of publishing it now.

## Verifying it

```bash
node scripts/check-api-contract.mjs     # routing table and contract agree (both ways)
npx @redocly/cli@2 lint --config packages/api-contracts/redocly.yaml \
  packages/api-contracts/openapi-v1.yaml
```

Both run in `.github/workflows/api-contract.yml`. The drift check fails when a
service route is undocumented **or** when a documented path is not routable by the
gateway — the two most common ways a contract rots.

## Changing it

1. Implement or plan the endpoint; register it on the right tier in the owning
   service.
2. Add or update the path, schemas and error responses here.
3. Keep the request shapes strict (`additionalProperties: false`) — the services
   reject unknown fields, and the contract should say so.
4. Never document a field the service derives from the token (`userId`, `ownerId`,
   `role`): those are outputs, not inputs.

`redocly.yaml` disables two recommended rules on purpose: the contract publishes the
local gateway alongside production, and planned operations answer `501` rather than
a `4XX` the service cannot yet produce. Both exceptions are explained in that file.
