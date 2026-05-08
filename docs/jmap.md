# Raw JMAP Requests

After obtaining `capabilityJwt`, run JMAP directly:

- Session discovery: `GET /.well-known/jmap`
- Method calls: `POST /jmap`

## Agent hints on authorization failures

For authorization/authentication failures (for example expired or invalid bearer
token), JMAP responses may include agent-oriented hints:

- `error.message`
- `error.hint`
- `error.docs_url`

This hint behavior applies to authorization errors only. Standard JMAP method
errors (business/data validation errors inside `methodResponses`) should be
handled as regular JMAP errors and are not guaranteed to carry agent hint
fields.

## Discover accountId

```bash
curl https://api.atomicmail.ai/.well-known/jmap \
  -H "Authorization: Bearer <capabilityJwt>"
```

Use `primaryAccounts["urn:ietf:params:jmap:mail"]` as your `accountId`.

Session also provides RFC 8620 blob templates:

- `uploadUrl` (contains `{accountId}`)
- `downloadUrl` (contains `{accountId}`, `{blobId}`, `{name}`, `{type}`)

## Send email (JMAP batch)

```json
{
  "using": [
    "urn:ietf:params:jmap:core",
    "urn:ietf:params:jmap:mail",
    "urn:ietf:params:jmap:submission"
  ],
  "methodCalls": [
    ["Email/set", { "accountId": "<accountId>", "create": { "d1": { "subject": "Hi" } } }, "c0"],
    ["EmailSubmission/set", { "accountId": "<accountId>", "create": { "s1": { "emailId": "#d1" } } }, "c1"]
  ]
}
```

## Read inbox (query + get)

```json
{
  "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
  "methodCalls": [
    ["Email/query", { "accountId": "<accountId>", "filter": { "inMailbox": "INBOX" }, "limit": 20 }, "q0"],
    ["Email/get", { "accountId": "<accountId>", "#ids": { "resultOf": "q0", "name": "Email/query", "path": "/ids" } }, "g0"]
  ]
}
```

For direct HTTP clients, keep request bodies as standard JSON payloads and send
them unchanged to `POST /jmap` with a capability bearer token.

## Attachments: RFC 9404 inline blob flow

Use `Blob/upload` and `Blob/get` through `/jmap` by adding
`urn:ietf:params:jmap:blob`:

```json
{
  "using": [
    "urn:ietf:params:jmap:core",
    "urn:ietf:params:jmap:mail",
    "urn:ietf:params:jmap:submission",
    "urn:ietf:params:jmap:blob"
  ],
  "methodCalls": [
    [
      "Blob/upload",
      {
        "accountId": "<accountId>",
        "create": {
          "b1": {
            "data:asBase64": "SGVsbG8gYXR0YWNobWVudA==",
            "type": "text/plain"
          }
        }
      },
      "b0"
    ],
    [
      "Email/set",
      {
        "accountId": "<accountId>",
        "create": {
          "e1": {
            "subject": "Inline blob",
            "bodyValues": { "t1": { "value": "See attachment." } },
            "textBody": [{ "partId": "t1", "type": "text/plain" }],
            "attachments": [
              { "blobId": "#b1", "type": "text/plain", "name": "note.txt" }
            ]
          }
        }
      },
      "e0"
    ],
    [
      "EmailSubmission/set",
      {
        "accountId": "<accountId>",
        "create": { "s1": { "emailId": "#e1" } }
      },
      "s0"
    ]
  ]
}
```

Blob retrieval in-band:

```json
{
  "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:blob"],
  "methodCalls": [
    [
      "Blob/get",
      {
        "accountId": "<accountId>",
        "ids": ["<blobId>"],
        "properties": ["id", "data:asBase64", "size", "type"]
      },
      "g0"
    ]
  ]
}
```

## Attachments: RFC 8620 upload/download endpoints

For out-of-band blob transfer:

1. Resolve `uploadUrl` / `downloadUrl` from session.
2. Expand URI-template variables (`accountId`, and for download: `blobId`, `name`, `type`).
3. Use capability bearer auth for upload/download HTTP requests.
4. Use returned `blobId` in normal JMAP mail methods (`Email/set`, etc.).

This path is useful when a client/tool needs direct binary transport outside
JMAP method calls.
