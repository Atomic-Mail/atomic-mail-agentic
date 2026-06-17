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

## Notes

- `jmap_request` enforces exactly one of `ops` or `ops_file`.
- `dry_run=True` with `attachments` is rejected.
- `vars` keys must match `^[A-Z][A-Z0-9_]*$`.
- `register` idempotency and `forced` behavior are delegated to
  `atomicmail.session.register`.
