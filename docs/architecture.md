# Architecture

Mermaid source in this file is the module map. When a use case, port, or adapter is added or removed, update the diagrams in the same change.

The apply process never launches Chrome. It attaches to the debugging port, and only `compose` knows about Stagehand, SQLite, Gemini, and the notify service. That service is the Worker `wohn-notify`, outside this repo, at `https://wohn-notify.shinnenkara.workers.dev`. `compose` calls it over HTTP when `data/notify.json` exists.

Mail and calendar sync is a separate process. Only `compose-sync` knows about Gmail, Calendar, and the OAuth token. The progress page only reads SQLite. A later slice can add `MailSender` and `CalendarWriter` behind a confirmation step, with broader OAuth scopes and a new login. Those ports are not in this tree.

```mermaid
flowchart LR
  main[main]
  compose[compose]
  loop[runAgentLoop]
  syncMain[sync]
  composeSync[composeSync]
  ui[ui]
  chrome[Chrome_CDP]
  sqlite[(SQLite_file)]
  gemini[Gemini_API]
  gmail[Gmail_readonly]
  calendar[Calendar_readonly]
  relay[Notify_relay]
  profile[applicant_profile_json]

  main --> compose
  compose --> loop
  compose --> chrome
  compose --> sqlite
  compose --> gemini
  compose --> relay
  compose --> profile
  syncMain --> composeSync
  composeSync --> sqlite
  composeSync --> gmail
  composeSync --> calendar
  composeSync --> gemini
  ui --> sqlite
```

Arrows in the module diagram are source dependencies. They point inward. Adapters implement ports; they do not sit inside the use cases. Domain has no framework imports.

```mermaid
flowchart TB
  subgraph infrastructure [Infrastructure]
    mainNode[main]
    composeNode[compose]
    syncNode[sync_and_login]
    uiNode[ui]
    loggerImpl[stdout_logger]
  end

  subgraph adapters [Adapters]
    sqliteRepos[sqlite_listings_progress_mail]
    browser[stagehand_browser]
    googleAd[gmail_calendar_oauth]
    rules[classify_by_rules]
    geminiClf[gemini_classifier]
    notifyAd[notify_notifiers]
    configAd[env_and_profile]
    clockAd[system_clock]
  end

  subgraph application [Application]
    runLoop[runAgentLoop]
    poll[pollSearch]
    inspect[inspectListing]
    apply[applyToListing]
    syncInbox[syncInbox]
    ports[ports]
  end

  subgraph domain [Domain]
    listing[Listing_and_status]
    progress[Funnel_progress]
    scoutMail[Scout_mail_and_citations]
    profileDom[ApplicantProfile]
    template[message_blacklist_validation]
    recovery[recoveryPolicy]
    breaker[CaptchaBreaker_and_timing]
  end

  mainNode --> composeNode
  syncNode --> googleAd
  syncNode --> sqliteRepos
  uiNode --> sqliteRepos
  composeNode --> runLoop
  composeNode --> sqliteRepos
  composeNode --> browser
  composeNode --> geminiClf
  composeNode --> notifyAd
  composeNode --> configAd
  composeNode --> clockAd
  composeNode --> loggerImpl

  runLoop --> poll
  runLoop --> inspect
  runLoop --> apply
  poll --> ports
  inspect --> ports
  apply --> ports
  syncInbox --> ports
  poll --> listing
  poll --> progress
  inspect --> listing
  inspect --> template
  inspect --> progress
  apply --> listing
  apply --> template
  apply --> recovery
  apply --> progress
  syncInbox --> progress
  syncInbox --> scoutMail
  runLoop --> breaker

  sqliteRepos -.-> ports
  browser -.-> ports
  googleAd -.-> ports
  geminiClf -.-> ports
  rules -.-> geminiClf
  notifyAd -.-> ports
  clockAd -.-> ports
```

Use cases in [src/application](../src/application): `poll-search`, `inspect-listing`, `apply-to-listing`, `run-agent-loop`, `sync-inbox`. Ports live beside them: listings, progress, mail, mailbox, agenda, account, selector cache, events, browser session, failure classifier, mail reader, notifier, control channel, clock, logger.

Domain rules stay in [src/domain](../src/domain): listing transitions, funnel stages, scout mail parsing, citation checks, message rendering, blacklist, validation-field matching, recovery policy, captcha breaker, active hours.

Concrete edges stay in [src/adapters](../src/adapters) and are wired only by [src/infrastructure/compose.ts](../src/infrastructure/compose.ts) and [src/infrastructure/compose-sync.ts](../src/infrastructure/compose-sync.ts). The progress page is [src/infrastructure/ui-main.ts](../src/infrastructure/ui-main.ts).
