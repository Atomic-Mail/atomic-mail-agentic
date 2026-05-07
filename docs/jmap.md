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
