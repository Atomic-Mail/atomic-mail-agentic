# pydantic-ai-atomicmail

[Pydantic AI](https://ai.pydantic.dev/) integration for Atomic Mail: give your
agent a real email inbox.

It exposes three tools backed by the same Python Atomic Mail runtime used by the
CLI and MCP adapters:

- `register` — proof-of-work signup that provisions an inbox and stores credentials
- `jmap_request` — authenticated JMAP method-call batches (read, send, search, ...)
- `help` — the built-in Atomic Mail docs

## Install

```bash
pip install pydantic-ai-atomicmail
```

The published wheel bundles the Atomic Mail Python runtime and shared presets; no
separate PyPI package is required.

Local development in this monorepo (install the core library first):

```bash
cd py
pip install -e .
pip install -e pydantic_ai
```

## Usage

As a [capability](https://ai.pydantic.dev/capabilities/overview/) — recommended,
since it bundles the tools with instructions telling the model how to use them:

```python
from pydantic_ai import Agent
from pydantic_ai_atomicmail import AtomicMailCapability

agent = Agent('openai:gpt-5.2', capabilities=[AtomicMailCapability()])
result = agent.run_sync('Check my inbox and summarise anything from today.')
```

As a plain [toolset](https://ai.pydantic.dev/toolsets/), when you want the tools
without the instructions:

```python
from pydantic_ai import Agent
from pydantic_ai_atomicmail import AtomicMailToolset

agent = Agent('openai:gpt-5.2', toolsets=[AtomicMailToolset()])
```

Both accept `credentials_dir` to point at a specific credentials directory,
which is useful when one process drives several inboxes:

```python
toolset = AtomicMailToolset(credentials_dir='/srv/agents/support/.atomicmail')
```

The model can still override `credentials_dir` per call; the constructor value is
the default.

## Tool functions

The underlying functions are importable and callable on their own:

```python
from pydantic_ai_atomicmail import help_tool, jmap_request_tool, register_tool

register_tool(username='support-bot')
print(help_tool(topic='cron'))
```

## Tests

```bash
cd py
pip install -e . -e pydantic_ai pytest
pytest tests/test_pydantic_ai_atomicmail.py
```
