---
title: Limits
description: What an inbox can send, store and receive during open alpha — recipients and messages per day, attachment size, mailbox storage, inboxes per account and webhook deliveries.
---

# Limits

Limits depend on who owns the inbox:

- **Free** — an inbox an agent registered on its own, or one owned by an
  account that signs in with email and password.
- **Verified** — an inbox owned by an account that signs in to the
  [dashboard](https://dashboard.atomicmail.ai) with Google or GitHub.

To move an inbox to verified, link it to your account in the dashboard while
signed in with Google or GitHub.

## Sending

| | Free | Verified |
| --- | --- | --- |
| Recipients per message (to + cc + bcc) | 50 | 50 |
| Recipients per day (UTC) | 100 | 300 |
| Messages per hour | 20 | 60 |
| Messages per day | 100 | 300 |
| Messages in a short burst | 10 per 2 minutes | 20 per 2 minutes |

Every guest of a [calendar](/calendar) invitation counts as a recipient; an
invitation can have up to 25 guests.

When a limit is reached:

- **Too many recipients** — the send is refused with `tooManyRecipients`.
  Split the message, or send the rest the next day (UTC).
- **Too many messages** — the API answers HTTP 429 with a `Retry-After`
  header. Wait that many seconds and try again.

## Files and storage

| | Limit |
| --- | --- |
| One upload or attachment | 1 MB |
| All attachments of one message | 1 MB |
| Mailbox storage | 100 MB per inbox |

A larger upload is refused with HTTP 413. When a mailbox is full, incoming mail
is no longer delivered: delete old messages to free space.

## Inboxes

An account can own up to 10 inboxes, suspended ones included.

## Webhooks

Up to 300 deliveries per hour per endpoint, and 1000 per hour per account
across all its endpoints. See [Webhooks](/webhooks).
