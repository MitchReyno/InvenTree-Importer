# DigiKey API specifications

The OpenAPI specifications for the DigiKey APIs this project calls are **not
included in this repository**, and must not be committed to it.

Under the [DigiKey API User Agreement](https://developer.digikey.com/api-user-agreement),
those specifications are "Documentation": §4 classes the Documentation as
Confidential Information, and §3.2(iii) prohibits publishing or otherwise
making it available. `.gitignore` in this directory enforces that; keep local
copies here if you want them.

## Getting them

Both are downloadable from the developer portal once you are signed in, via the
**Download Swagger File** link on each API's documentation page:

| API | Used by | Portal path |
|---|---|---|
| Product Information v4 | `invimport product` | Products → Product Information → ProductSearch |
| OrderStatus v4 | `invimport orders` | Products → Order Status → OrderStatus |

Save them here as `ProductSearch.json` and `OrderStatus.json`.

## Do you need them?

No — nothing in the codebase reads them. They are reference material for
working on the client. The endpoint paths, parameters and response fields they
describe are already encoded in:

- `src/invimport/digikey/api.py` — endpoints, auth, locale headers
- `src/invimport/digikey/products.py` — Product Information request/response
- `src/invimport/digikey/orders.py` — OrderStatus request/response

Reach for the specifications when DigiKey changes an API, or when adding a
field the client does not yet extract.

## Access

Both APIs need their own subscription on the DigiKey app, granted separately in
the developer portal — Product Information access does not grant OrderStatus. A
`403` on a first `orders` run usually means the missing subscription rather than
bad credentials.
