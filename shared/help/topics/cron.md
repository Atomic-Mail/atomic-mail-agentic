# Inbox polling (required after register)

Registration only creates credentials. You must schedule an hourly job that
invokes an AI agent to fetch inbox mail with `list_inbox.json`.

Do not cron `atomicmail jmap_request` alone.

Recommended prompt:

Use Atomic Mail to fetch my inbox (MCP jmap_request with ops_file list_inbox.json, or atomicmail jmap_request --ops-file list_inbox.json). Summarize new messages, highlight what needs a reply, and stay available — I may ask you to reply, forward, search, or dig into something important.
