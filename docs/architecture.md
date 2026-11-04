# Architecture

Mermaid source in this file is the module map. When a use case, port, or adapter is added or removed, update the diagrams in the same change.

The process never launches Chrome. It attaches to the debugging port, and only `compose` knows about Stagehand, SQLite, Gemini, and Telegram.

```mermaid
flowchart LR
  main[main]
  compose[compose]
  loop[runAgentLoop]
  chrome[Chrome_CDP]
  sqlite[(SQLite_file)]
  gemini[Gemini_API]
  telegram[Telegram_Bot]
  profile[applicant_profile_json]

  main --> compose
  compose --> loop
  compose --> chrome
  compose --> sqlite
  compose --> gemini
  compose --> telegram
  compose --> profile
```

Arrows in the module diagram are source dependencies. They point inward. Adapters implement ports; they do not sit inside the use cases. Domain has no framework imports.

```mermaid
flowchart TB
  subgraph infrastructure [Infrastructure]
    mainNode[main]
    composeNode[compose]
    loggerImpl[stdout_logger]
  end

  subgraph adapters [Adapters]
    sqliteRepos[sqlite_listings_selectors_events]
    browser[stagehand_browser]
    rules[classify_by_rules]
    geminiClf[gemini_classifier]
    telegramAd[telegram_notifier]
    configAd[env_and_profile]
    clockAd[system_clock]
  end

  subgraph application [Application]
    runLoop[runAgentLoop]
    poll[pollSearch]
    inspect[inspectListing]
    apply[applyToListing]
    ports[ports]
  end

  subgraph domain [Domain]
    listing[Listing_and_status]
    profileDom[ApplicantProfile]
    template[message_blacklist_validation]
    recovery[recoveryPolicy]
    breaker[CaptchaBreaker_and_timing]
  end

  mainNode --> composeNode
  composeNode --> runLoop
  composeNode --> sqliteRepos
  composeNode --> browser
  composeNode --> geminiClf
  composeNode --> telegramAd
  composeNode --> configAd
  composeNode --> clockAd
  composeNode --> loggerImpl

  runLoop --> poll
  runLoop --> inspect
  runLoop --> apply
  poll --> ports
  inspect --> ports
  apply --> ports
  poll --> listing
  inspect --> listing
  inspect --> template
  apply --> listing
  apply --> template
  apply --> recovery
  runLoop --> breaker

  sqliteRepos -.-> ports
  browser -.-> ports
  geminiClf -.-> ports
  rules -.-> geminiClf
  telegramAd -.-> ports
  clockAd -.-> ports
```

Use cases in [src/application](../src/application): `poll-search`, `inspect-listing`, `apply-to-listing`, `run-agent-loop`. Ports live beside them: listings, selector cache, events, browser session, failure classifier, notifier, control channel, clock, logger.

Domain rules stay in [src/domain](../src/domain): listing transitions, message rendering, blacklist, validation-field matching, recovery policy, captcha breaker, active hours.

Concrete edges stay in [src/adapters](../src/adapters) and are wired only by [src/infrastructure/compose.ts](../src/infrastructure/compose.ts).
