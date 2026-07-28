---
description: OAuth 2.0 authorization-code + PKCE flow for third-party apps (Make, n8n, Zapier, remote MCP)—discovery, endpoints, scopes, and using the access token directly as the JMAP bearer.
---

# OAuth 2.0 for third-party apps

Atomic Mail runs a standards-compliant OAuth 2.0 authorization server at
`https://auth.atomicmail.ai`. Use it when a **human** authorizes an application
to act on the inboxes they own — integration platforms (Make, n8n, Zapier),
hosted connectors, and the remote MCP server.

This is a **different path** from the
[REST authentication flow](/rest-auth), which is the anonymous, proof-of-work
path an autonomous agent uses to register its own inbox with no human involved.
Both paths exist; they are not alternatives to one another.

## Which path do I want?

| | **OAuth 2.0** (this page) | **Proof of work** ([`/rest-auth`](/rest-auth)) |
| --- | --- | --- |
| Who owns the inbox | A human account (Google / GitHub sign-in) | The agent itself |
| Who authorizes | A human, in the browser, at a consent screen | Nobody — the agent solves a PoW challenge |
| Credential you store | Refresh token (rotating) | `apiKey` |
| JMAP bearer | The **OAuth access token**, used directly | A capability JWT you mint and rotate yourself |
| Typical caller | Make, n8n, Zapier, remote MCP, any third-party app | An autonomous agent, the local MCP server, AgentSkill |
| Inbox selection | Per request, via `X-Atomic-Account-Id` | Implicit — one inbox per credential |

## Discovery (RFC 8414)

Everything below is machine-discoverable. Start here:

```bash
curl -s https://auth.atomicmail.ai/.well-known/oauth-authorization-server
```

```json
{
  "issuer": "https://auth.atomicmail.ai",
  "authorization_endpoint": "https://auth.atomicmail.ai/oauth/authorize",
  "token_endpoint": "https://auth.atomicmail.ai/oauth/token",
  "revocation_endpoint": "https://auth.atomicmail.ai/oauth/revoke",
  "registration_endpoint": "https://auth.atomicmail.ai/oauth/register",
  "jwks_uri": "https://auth.atomicmail.ai/.well-known/jwks.json",
  "scopes_supported": ["mail.read", "mail.send"],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["client_secret_post", "none"],
  "authorization_response_iss_parameter_supported": true,
  "client_id_metadata_document_supported": true,
  "token_profiles_supported": ["at+jwt"]
}
```

MCP clients can instead start from the protected-resource metadata (RFC 9728) at
`https://mcp.atomicmail.ai/.well-known/oauth-protected-resource/mcp`, which names
the same authorization server.

## Endpoints

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/.well-known/oauth-authorization-server` | `GET` | RFC 8414 metadata (above) |
| `/.well-known/jwks.json` | `GET` | EdDSA public key — verify access tokens offline |
| `/oauth/authorize` | **`GET` only** | Start the flow. `POST` returns **404** |
| `/oauth/token` | `POST` | Code exchange and refresh |
| `/oauth/revoke` | `POST` | RFC 7009 revocation |
| `/oauth/register` | `POST` | RFC 7591 dynamic client registration |
| `/api/v1/agents` | `GET` | The inboxes this connection's owner has (public, bearer-authenticated) |

`/oauth/authorize` is a browser endpoint — it renders sign-in and consent, so it
answers to `GET` and nothing else. Sending `POST` to it is a `404`, not a `405`;
if you are seeing that, your client is treating it as a token-style endpoint.

## Grant type and client authentication

- **`authorization_code` + PKCE `S256`.** PKCE is **mandatory** and cannot be
  downgraded — `code_challenge` is required, and `code_challenge_method` must be
  the literal string `S256`. `plain` is rejected.
- **`refresh_token` with rotation.** Every refresh returns a new refresh token
  and invalidates the old one. Presenting a superseded refresh token revokes the
  whole grant (reuse detection).
- **Public clients are supported.** `token_endpoint_auth_methods_supported`
  includes `"none"`, so a client with no secret is first-class. Integration
  platforms whose connectors run in a browser-reachable context should register
  as public clients and send **no** `client_secret`.
- `state` is required, and responses carry `iss` so a client can verify which
  authorization server answered (`authorization_response_iss_parameter_supported`).

### Getting a `client_id`

Three ways, in order of preference:

1. **Dynamic client registration** (RFC 7591) — `POST /oauth/register` with your
   client metadata. Unauthenticated and open, but rate-limited per IP.
2. **A client-id metadata document (CIMD)** — use an `https://` URL as the
   `client_id`; the server fetches your metadata from it.
   `client_id_metadata_document_supported: true` advertises this.
3. **Ask us to register one** for a published connector.

## Resource indicator (RFC 8707)

Every authorization request must carry a `resource` parameter naming what the
token is for. For direct JMAP access that value is exactly:

```
https://api.atomicmail.ai/jmap
```

It must match **byte for byte** — no trailing slash, no `http://`, no host
variation. A mismatch fails the authorize request with `invalid_request`. The
resulting access token is audience-bound (`aud`) to that value, and the JMAP API
rejects a token minted for any other audience — including a token minted for the
MCP server.

The other accepted values are the MCP resource
(`https://mcp.atomicmail.ai/mcp`, for MCP connections) and a single-agent URN
`urn:atomicmail:agent:{accountId}`.

## Scopes

| Scope | Grants |
| --- | --- |
| `mail.read` | Read access — every JMAP method that does not send mail |
| `mail.send` | Sending — `EmailSubmission/set` |

At least one is required. `mail.send` is not forced: a read-only connection is a
supported, first-class configuration. A read-only token that attempts a send is
rejected with **403** and `error: "insufficient_scope"`.

The consent screen lets the human narrow the grant to read-only even when the
client asked for both, so treat `mail.send` as requested-not-guaranteed and read
the `scope` field of the token response.

## The flow

### 1. Authorize

Send the user's browser to:

```
https://auth.atomicmail.ai/oauth/authorize
  ?response_type=code
  &client_id=<your client_id>
  &redirect_uri=<exactly one of your registered URIs>
  &scope=mail.read%20mail.send
  &resource=https%3A%2F%2Fapi.atomicmail.ai%2Fjmap
  &state=<opaque>
  &code_challenge=<BASE64URL(SHA256(verifier))>
  &code_challenge_method=S256
```

The user signs in with Google or GitHub, picks (or creates) the inbox this
connection defaults to, and approves the scopes. You get a redirect back with
`code`, `state`, and `iss`.

`redirect_uri` is matched by **exact string equality** against your registered
values — not by prefix or origin.

### 2. Exchange the code

```bash
curl -X POST https://auth.atomicmail.ai/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d grant_type=authorization_code \
  -d code=<code> \
  -d redirect_uri=<same redirect_uri> \
  -d client_id=<your client_id> \
  -d code_verifier=<the PKCE verifier>
```

```json
{
  "access_token": "<JWT, typ=at+jwt>",
  "token_type": "Bearer",
  "expires_in": 900,
  "refresh_token": "<rotating>",
  "scope": "mail.read mail.send"
}
```

Authorization codes are single-use and short-lived.

### 3. Refresh

```bash
curl -X POST https://auth.atomicmail.ai/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d grant_type=refresh_token \
  -d refresh_token=<current refresh token> \
  -d client_id=<your client_id>
```

Store the **new** `refresh_token` from every response. The old one is dead the
moment the new one is issued.

**Lifetimes.** Access tokens live **900 seconds** (`expires_in` in the token
response). Refresh tokens live **90 days**, and the window slides — each
rotation issues one good for another 90 days from that moment. A connection used
regularly therefore never expires; one left idle for 90 days must be
re-authorized.

### 4. Revoke

```bash
curl -X POST https://auth.atomicmail.ai/oauth/revoke \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d client_id=<your client_id> \
  -d token=<access or refresh token>
```

Per RFC 7009 this returns `200` even for a token it does not recognise. Humans
can also revoke any grant from the dashboard.

## The access token *is* the JMAP bearer

This is the part most integrations get wrong, so it is worth stating flatly:

**Send the OAuth access token directly as the `Authorization: Bearer` header on
JMAP requests.** There is no second token exchange on the client side.

```
Authorization: Bearer <OAuth access token>
```

Internally the API verifies the token's signature, issuer, and audience,
re-verifies that the requested inbox is owned by the token's grant, and mints a
short-lived (~2-minute) capability token **server-side** for the downstream mail
store. Clients on this path never see, store, or rotate a capability JWT — that
is deliberate, because a 2-minute credential cannot survive on a stored
integration-platform connection.

::: tip Contrast with the PoW path
On the [proof-of-work path](/rest-auth) the capability JWT *is* the client's
concern: you mint it from a session JWT and rotate it every two minutes. On the
OAuth path that machinery is entirely server-side.
:::

## X-Atomic-Account-Id is required on every JMAP request

An OAuth grant is **user-scoped**: it covers every inbox its owner has, not one
pinned inbox. So each request must say which inbox it is for.

```
POST https://api.atomicmail.ai/jmap
Authorization: Bearer <OAuth access token>
X-Atomic-Account-Id: 1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed
Content-Type: application/json
```

The contract, exactly as implemented:

- **Required.** Every `/jmap` request authenticated with an OAuth access token
  must carry it.
- **Must be a UUID.** The value is validated against the UUID format.
- **There is no token-derived default.** The server will not fall back to "the
  connection's inbox" or "the only inbox". A missing header and a malformed
  header are both a hard **400**.
- **Source it from `GET /api/v1/agents`** — use the `accountId` field of an
  entry in the response.
- **Ownership is re-verified on every request.** An `accountId` the grant's
  owner does not own is **403**, not a silent empty result.

This header does *not* apply to the proof-of-work path, where the inbox is
already pinned by the capability JWT.

### `accountId` in JMAP method arguments

Because the account is pinned server-side from this header, you may **omit**
`accountId` from JMAP method arguments — the mail store defaults it to the
account the request authenticated as. The published Make modules rely on this.

The security consequence is worth stating: an `accountId` placed in the request
**body cannot redirect the request to another account**. The downstream
credential is derived solely from the header-selected, ownership-checked inbox.
The API proxy is deliberately JMAP-blind and never rewrites your body.

## Listing the inboxes a connection can use

```bash
curl https://auth.atomicmail.ai/api/v1/agents \
  -H "Authorization: Bearer <OAuth access token>"
```

```json
{
  "agents": [
    {
      "accountId": "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed",
      "inboxId": "myagent",
      "status": "active",
      "reputation": 0.5,
      "linkedAt": "2026-07-01T09:14:22.000Z",
      "activatedAt": "2026-07-01T09:20:03.000Z"
    }
  ],
  "_next": ["…"]
}
```

This endpoint is **public** — reachable from the internet, authenticated by the
bearer token alone. It accepts a token minted for either the MCP resource or the
JMAP resource, and it only ever returns inboxes owned by the token's own user.

Use it to populate an inbox picker, and to obtain the `accountId` values for
`X-Atomic-Account-Id`.

## Worked example

```bash
ACCESS_TOKEN="<from POST /oauth/token>"

# 1. Which inboxes can this connection act as?
ACCOUNT_ID=$(curl -s https://auth.atomicmail.ai/api/v1/agents \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["agents"][0]["accountId"])')

# 2. Read the inbox — note: no accountId in the method args
curl -s -X POST https://api.atomicmail.ai/jmap \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "X-Atomic-Account-Id: $ACCOUNT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
    "methodCalls": [
      ["Email/query", { "limit": 10 }, "q0"],
      ["Email/get", {
        "#ids": { "resultOf": "q0", "name": "Email/query", "path": "/ids" },
        "properties": ["subject", "from", "receivedAt", "preview"]
      }, "g0"]
    ]
  }'
```

Everything after authentication is ordinary JMAP — see
[Raw JMAP requests](/jmap) and [JMAP `using` and inline ops](/jmap-using).

## Error responses

The OAuth endpoints and the OAuth-authenticated JMAP path return the standard
OAuth error shape, **not** the `{ error: { message, hint, docs_url } }` shape the
proof-of-work endpoints use:

```json
{ "error": "invalid_grant", "error_description": "Authorization code has expired." }
```

Read `error_description` for the human-readable reason. Common cases:

| Status | `error` | Usual cause |
| --- | --- | --- |
| 400 | `invalid_request` | Missing `resource`/`state`/`code_challenge`, or `code_challenge_method` ≠ `S256` |
| 400 | `invalid_client` | Unknown or disabled `client_id` |
| 400 | `invalid_grant` | Code reused, expired, or `redirect_uri` mismatch |
| 400 | `invalid_scope` | Requested scope exceeds what the client is allowed |
| 400 | *(agent error shape)* | `X-Atomic-Account-Id` missing or not a UUID |
| 401 | `invalid_token` | Expired access token, or the grant was revoked |
| 403 | `insufficient_scope` | Send attempted on a `mail.read`-only grant |
| 403 | `access_denied` | The requested inbox is not owned by this connection |

## Not publicly reachable

For completeness, since integrators sometimes find these named in transcripts:
the delegated capability mints (`/api/v1/capability/mcp-delegated` and
`/api/v1/capability/make-delegated`) are **service-to-service only** and return
`404` from the internet. They are an internal implementation detail of the
server-side capability minting described above; no client calls them.

## See also

- [Make.com](/make) — the connection this flow was built for
- [Remote MCP server](/mcp-remote) — same authorization server, MCP resource
- [REST authentication flow](/rest-auth) — the anonymous proof-of-work path
- [Raw JMAP requests](/jmap)
