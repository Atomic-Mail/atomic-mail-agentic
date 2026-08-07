AFTER REGISTER — WHO READS THE INBOX
  register takes a required `watch` value. It is your operator's decision, not yours — ask them.
  • scheduled — a recurring job on this machine wakes an agent once a day to read the inbox and report what arrived.
  • on-demand — no such job; mail is read only when a human asks, and anything arriving in between sits unread with nobody told.
  On "scheduled", register prints the exact setup step for your runtime — use your host's OWN scheduler (openclaw cron, hermes cron, atomic-agent task, a Claude Code routine, …).
  Never schedule at the OS level: no crontab, launchd, systemd or wrapper scripts. They run outside your host's permission model and break in practice.
  Never register in one runtime and schedule in another.
  See help topic "cron".
