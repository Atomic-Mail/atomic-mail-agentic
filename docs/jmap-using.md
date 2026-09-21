---
description: How the JMAP envelope `using` array interacts with MCP/CLI defaults and bare methodCalls arrays (RFC 8620).
---

# JMAP using & inline ops

RFC 8620 requires each JMAP request to include a `using` array: the capability
URNs that apply to every method call in the batch. If a method
belongs to a URN you did not declare, the request is not valid for a
standards-following server.

## Full envelope vs bare `methodCalls`

Clients may send either:

1. **Full envelope:** `{ "using": ["urn:ietf:params:jmap:core", ...], "methodCalls": [...] }`
2. **Bare array:** `[["Email/query", {...}, "q0"], ...]` — the host then supplies
   a default `using` for the envelope it builds.

Atomic Mail **MCP** (`jmap_request`) and **AgentSkill / CLI** use the same
default `using` when you pass only a bare `methodCalls` array:

- `urn:ietf:params:jmap:core`
- `urn:ietf:params:jmap:mail`

That pair covers **Mailbox/***, **Email/***, **Thread/***, **SearchSnippet/***,
and other types declared under the mail capability. For built-in recipes and
when to add more URNs, use **`help --topic jmap_cheatsheet`** (CLI) or the MCP
`help` tool with topic **`jmap_cheatsheet`**.

## Pitfall: submission, identity, and blob methods

If you pass a bare `methodCalls` array and rely on the default `using`, extend
it whenever the batch uses methods from other URNs, for example:

| Methods (examples) | Add to `using` |
| -------------------- | -------------- |
| `EmailSubmission/*`, `Identity/*` | `urn:ietf:params:jmap:submission` |
| `Blob/upload`, `Blob/get`, `Blob/lookup` | `urn:ietf:params:jmap:blob` |

Ways to do that:

- Put a full **`{ "using": [...], "methodCalls": [...] }`** object in `ops` /
  your JSON file, with every URN you need; or
- **MCP:** set the tool’s **`using`** input array so it includes `submission`
  and/or `blob` in addition to core and mail when your inline ops need them; or
- Use **bundled presets** (for example `send_mail.json`), which already embed the
  correct `using` for their method calls.

For a narrative send/read example, see [Raw JMAP requests](/jmap).

## Related

<LinkRows columns="1" :items="[
  { title: 'Raw JMAP requests', desc: 'Narrative send and read examples', link: '/jmap' },
  { title: 'Code examples', desc: 'End-to-end HTTP in Python, Node.js and curl', link: '/examples' },
  { title: 'Local MCP server', desc: 'ops, ops_file and using in the MCP tool', link: '/mcp' },
]" />
