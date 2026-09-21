---
title: Use cases
outline: 2
description: What agents do with their own inbox — digests, applications, invoices, agent-to-agent mail, support, monitoring, human-in-the-loop — and which Atomic Mail path each one needs.
---

# Use cases

An inbox the agent owns turns email into an input, an output and a message bus.
The patterns below are the ones we see most; each notes the path it needs, so
you can jump straight to the right page.

<div class="usecases">

<article>

### Newsletter intelligence

Subscribe an agent inbox to dozens of industry newsletters. The agent reads
everything, extracts signals and surfaces only what matches an interest
profile, once a day as a digest. Nothing lands in a person's inbox.

<p class="usecases__fit">Fits: <a href="/">AgentSkill</a> with <a href="/getting-started#who-reads-the-inbox"><code>--watch scheduled</code></a></p>

</article>

<article>

### Vendor invoice processing

An agent inbox receives supplier invoices. The agent parses each one, matches
it against the PO database and routes exceptions to a human approver, without
touching the company's main mail domain.

<p class="usecases__fit">Fits: <a href="/custom-domains">your own domain</a> and a <a href="/n8n">workflow node</a></p>

</article>

<article>

### Multi-agent coordination

Agents talk to each other over email: a research agent sends findings to a
writing agent, which drafts a report and sends it to an editor agent. Every
thread is auditable by a person.

<p class="usecases__fit">Fits: one <a href="/getting-started">inbox per agent</a>, plain JMAP threads</p>

</article>

<article>

### Agent-to-human escalation

Any pipeline can email its owner when it hits an edge case. The person answers
in plain language; the agent parses the reply and resumes. Email becomes the
human-in-the-loop interface that already works on every phone.

<p class="usecases__fit">Fits: <a href="/mcp">MCP</a> or <a href="/">AgentSkill</a>, <a href="/getting-started#who-reads-the-inbox"><code>--watch on-demand</code></a></p>

</article>

</div>

## More patterns

<div class="usecases usecases--list">

<article>

### Autonomous job applications

Finds listings, drafts tailored applications, sends them from its own inbox,
monitors replies and escalates only when a recruiter answers.

</article>

<article>

### Async user research

Sends structured questions, reads free-form answers, follows up on what it
learns and summarizes. Respondents reply on their own schedule.

</article>

<article>

### SaaS account provisioning

A deployment agent signs up for third-party tools with its Atomic Mail
address, receives the confirmation mail and completes setup on its own.

</article>

<article>

### Competitive monitoring

Subscribes to competitor release notes and press lists, keeps a diff over time
and alerts when something significant ships.

</article>

<article>

### Support at the edge

Owns `support@`, reads each ticket, queries the knowledge base and replies in
full. People see only what the agent could not resolve.

</article>

<article>

### Price and availability tracking

Registers for back-in-stock and price alerts, receives them as they arrive and
sends one aggregated notification when a threshold is met.

</article>

<article>

### Regulatory notifications

Follows regulatory mailing lists, extracts the relevant changes and emails a
structured briefing to the compliance team.

</article>

<article>

### Mediated correspondence

Two people or organizations write through agents: each side's agent reads,
drafts a reply for approval or sends within a trust level the owner sets.

</article>

</div>

## Where to start

Every pattern above begins the same way: register an inbox, decide who reads
it, then send and read over JMAP. The [quickstart](/) takes ten minutes; the
[agent flow](/getting-started) explains the choices behind each step.
