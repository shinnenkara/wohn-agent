# Wohn-Agent

Local ImmoScout24 auto-apply loop. It attaches to a headed Chrome window you already logged into, polls a saved search, and sends your application through the contact form.

The domain and use cases own listing status, blacklist filtering, recovery limits, and the captcha circuit breaker. Stagehand, SQLite, and the shared notify service sit behind those ports. Applicant values are passed to Stagehand as variables and the message is filled locally, so they are not placed in observe instructions.

The module map is in [docs/architecture.md](docs/architecture.md).

## Run

1. Copy `.env.example` to `.env` and set `GOOGLE_GENERATIVE_AI_API_KEY`.
2. Copy `applicant_profile.example.json` to `applicant_profile.json` and replace the sample applicant.
3. Start Chrome with the persistent profile:

```powershell
npm run chrome
```

4. Log in to ImmoScout24 in that window, including MieterPlus. The agent never types your password.
5. Start the loop:

```powershell
npm run dev
```

Set `DRY_RUN=true` for a dry run. The agent still polls, opens each listing, and fills the contact form, then prints the application in the terminal instead of clicking send. Nothing is marked applied, so a later run with `DRY_RUN=false` can send those listings. Each listing is printed once per process.

`APP_ENV=prod` is the default. Phone, income, application text, tokens, and error causes are left out of the JSON log, and the log sentence stays. `APP_ENV=dev` prints those fields. Dry-run previews still print the full application in either mode.

Ctrl+C disconnects Stagehand and leaves Chrome open. The process does not call `browser.close()`, because that CDP command shuts the logged-in window.

Active hours are 07:00–23:00 Europe/Berlin. Outside that window the loop logs the night state and sleeps until 07:00. Set `OVERNIGHT_RUN=true` to keep polling through the night. The default is `false`. Polls are about a minute apart, with jitter. Each cycle applies to at most five listings.

## Telegram

Alerts always print in the terminal. To also receive them in Telegram, link this machine to the shared bot. The bot is already running. You do not deploy anything.

```powershell
npm run link
```

Open the printed link in Telegram (the app or the web client) and press Start. The command writes `data/notify.json` and waits a few minutes. Run it again to replace the chat. Until you link, the log says `Telegram is off. Run npm run link.`

A different bot, or a different notify URL, is a later version. This prototype always uses `https://wohn-notify.shinnenkara.workers.dev`.

## Captcha and resume

A page-level challenge, such as a title or heading `Ich bin kein Roboter`, or the AWS puzzle in `#captcha-container`, pauses on the first sight, writes the alert to the console, and sends it to Telegram when this machine is linked. It does not reload.

The in-form rate-limit check is different. Visible text `Sicherheitsabfrage` or `Zeichen aus dem Bild eingeben` pauses the loop on the first sight, sends the same alert, and does not reload or send another application. Solving the dialog in the open window clears the breaker.

## Success text

A send counts only when the page shows one of these: `Nachricht gesendet`, `Interesse bekundet`, `Anfrage wurde gesendet`, `erfolgreich gesendet`, or `abgeschickt`. `Interesse bekunden` is the button, not the confirmation. Extend `textIndicatesApplicationSent` and `textIndicatesSendCaptcha` in `src/domain/captcha-signal.ts` when ImmoScout changes the copy. The contact click and the `Abschicken` button are handled in `src/adapters/stagehand/form-page.ts` and `contact-opener.ts`. Leave that path in place. Stagehand observe is the fallback, and a cached absolute xpath will not match the next listing.

## Working on the loop

This is an operator tool. It uses one logged-in Chrome profile and a personal applicant file. `npm test` does not call ImmoScout24, Gemini, or Telegram.

Stop the process with Ctrl+C. That asks Stagehand to disconnect and leaves Chrome open. Killing the Node process skips that disconnect. The next start then logs `A Stagehand instance is already initialized` until you close that Chrome and run `npm run chrome` again.

`MODEL_NAME` must start with `google/`. The same model fills forms and classifies failures. A lite model is cheaper and misses controls more often.

`data/wohn-agent.db` is the memory. `DISCOVERED` is still eligible. `APPLIED` is not retried. `FAILED` is not retried either. Do not flip a row back to `DISCOVERED` after the success dialog was on screen, or the next run contacts that listing again. A dry run does not set `APPLIED`.

## Manual smoke

- CDP preflight: stop Chrome and confirm the log says the debugging port is unavailable, then start it again.
- Session pause: log out and confirm the log contains `SESSION_EXPIRED`. Log in again and confirm polling resumes. A linked Telegram chat receives the same text.
- Filtered listing: include a blacklist keyword in a test expose and confirm status `FILTERED_OUT`.
- Cached apply: run one real contact flow and confirm `selector_cache` gains `open_contact_drawer`.
- Stale selector: change that cached selector to a missing CSS id, process another listing, and confirm the row is replaced.
- Captcha pause: open a tab whose title contains `Ich bin kein Roboter` and confirm the alert in the log. Clear the title and confirm the breaker closes.
- Send captcha: while a contact dialog is open, the page text `Sicherheitsabfrage` should log `captcha paused the loop` and send the alert without another submit.

`npm test` covers the state machine, recovery caps, repositories, and loop with fakes. It does not call ImmoScout24 or Gemini.
