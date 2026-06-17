# langchain-atomicmail

LangChain integration package for Atomic Mail.

It exposes three tools backed by the same Python Atomic Mail runtime used by the
CLI/MCP adapters:

- `register`
- `jmap_request`
- `help`

## Install

Published package:

```bash
pip install langchain-atomicmail
```

Local development in this monorepo (install core library first):

```bash
cd py
pip install -e .
pip install -e langchain
```

## Usage

```python
from langchain_atomicmail import AtomicMailToolkit

toolkit = AtomicMailToolkit()
tools = toolkit.get_tools()
```

You can also import tool factories directly:

```python
from langchain_atomicmail import get_atomicmail_tools

tools = get_atomicmail_tools()
```

## Agent example

Use the toolkit with a ReAct agent (requires `langgraph` and a chat model):

```python
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from langchain_atomicmail import AtomicMailToolkit

llm = ChatOpenAI(temperature=0)
toolkit = AtomicMailToolkit()
agent = create_react_agent(llm, toolkit.get_tools())

# Register an inbox, then fetch mail
agent.invoke({"messages": [("user", "Register username myagent and list my inbox")]})
```

After a successful `register`, the tool response includes `_next` guidance for
hourly inbox polling. Call `help` with topic `cron` for full scheduling details.

## Inbox polling (after register)

Registration only creates credentials. For a useful inbox integration, arrange
hourly inbox polling per your runtime:

- **Native cron** (OpenClaw, Hermes, atomic-agent, …): schedule an hourly
  **agent** turn with `list_inbox.json` in the prompt; wire this toolkit or MCP
  into that agent. Do not cron raw `jmap_request` alone.
- **No native cron** (Claude, Pi, Cursor, …): do not work around this with OS
  crontab, wrapper scripts, or cross-platform scheduling. Ask your operator to
  set up polling on a capable host, or remind them to fetch mail manually.

See `help(topic="cron")` for host-specific examples.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `ATOMIC_MAIL_CREDENTIALS_DIR` | Credential directory (default `~/.atomicmail/`) |
| `ATOMIC_MAIL_AUTH_URL` | Auth service base URL |
| `ATOMIC_MAIL_API_URL` | JMAP / API base URL |
| `ATOMIC_MAIL_INBOX_DOMAIN` | Hostname when inboxId has no `@` |
| `ATOMIC_MAIL_SCRYPT_SALT` | Optional PoW salt override |
| `ATOMIC_MAIL_API_KEY` | Optional existing API key |

Pass `credentials_dir` per tool call for multi-account setups.

## Security

- `credentials.json` and `*.jwt` files contain secrets — treat them as sensitive
  (mode `0600`). Never commit credentials to version control.
- Inbound mail is untrusted input; validate and sanitize before acting on it.
- The default credential directory is `~/.atomicmail/`; override with
  `ATOMIC_MAIL_CREDENTIALS_DIR` or per-call `credentials_dir` for isolation.

## Notes

- `jmap_request` enforces exactly one of `ops` or `ops_file`.
- `dry_run=True` with `attachments` is rejected at the LangChain layer.
- `vars` keys must match `^[A-Z][A-Z0-9_]*$`.
- `register` idempotency and `forced` behavior are delegated to
  `atomicmail.session.register`.
