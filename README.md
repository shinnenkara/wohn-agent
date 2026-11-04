# Wohn-Agent

Local ImmoScout24 auto-apply loop. It attaches to a headed Chrome window you already logged into, polls a saved search, and sends your application through the contact form.

The domain and use cases own listing status, blacklist filtering, recovery limits, and the captcha circuit breaker. Stagehand, SQLite, and Telegram sit behind those ports. Applicant values are passed to Stagehand as variables and the message is filled locally, so they are not placed in observe instructions.

The module map is in [docs/architecture.md](docs/architecture.md).

## Run

1. Copy `.env.example` to `.env` and set `GOOGLE_GENERATIVE_AI_API_KEY`, `TELEGRAM_BOT_TOKEN`, and `TELEGRAM_CHAT_ID`.
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

## Captcha and resume

The first captcha waits 90–120 seconds and reloads once. A single click is used only for a plain checkbox challenge. A second captcha opens the breaker, sends the Telegram alert, and reads `document.title` every 15 seconds without navigating. Solving the challenge in the open window resumes the loop. `/resume` is accepted only after that title is clear.

## Manual smoke

- CDP preflight: stop Chrome and confirm the log says the debugging port is unavailable, then start it again.
- Session pause: log out and confirm the `SESSION_EXPIRED` Telegram message. Log in again and confirm polling resumes.
- Filtered listing: include a blacklist keyword in a test expose and confirm status `FILTERED_OUT`.
- Cached apply: run one real contact flow and confirm `selector_cache` gains `open_contact_drawer`.
- Stale selector: change that cached selector to a missing CSS id, process another listing, and confirm the row is replaced.
- Captcha pause: open a tab whose title contains `Ich bin kein Roboter` and confirm the Telegram alert. Clear the title, or send `/resume` after it is clear, and confirm the breaker closes.

`npm test` covers the state machine, recovery caps, repositories, and loop with fakes. It does not call ImmoScout24 or Gemini.
