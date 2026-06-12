REQUIRED AFTER REGISTER
  Setup is not complete until an hourly job invokes your AGENT to fetch inbox mail
  (preset list_inbox.json). Do NOT cron atomicmail jmap_request alone — that only
  logs JSON and never starts an agent. See help topic "cron" for workflow options.
