# Live native session qualification

`driver.ts` runs one scripted operator flow per provider against an isolated development app and writes evidence outside the repository. It sends real provider requests on the operator's subscription, so run it only with explicit authorization for live provider use. It never starts an inventory stage or approves anything, and the development app uses the fake inventory target.

`chat.ts` decides whether a chat was handled. A reply counts when it names the chat. A question or status counts only when the same session posts it after reading the chat and it shares a specific word or number with the chat. Observations, proposals and lots never count. `tests/qualification-chat.test.ts` covers both the missed-question case from the previous qualification and unrelated activity.

## Running it

Start an isolated app from this checkout on a free port, with its own state directory, so another running app is not disturbed:

```sh
INTAKE_ENV_FILE='' INTAKE_PROCESSING_PROFILE=native-agent/2 INTAKE_DEV_PORT=4331 \
  INTAKE_APP_STATE="$HOME/.local/state/bench-intake/<private-name>" pnpm dev
```

Sign Codex in for that state with `INTAKE_ENV_FILE='' INTAKE_APP_STATE=<same> pnpm codex:login`. Claude uses the host CLI login. Then, from `intake-server/`:

```sh
npx tsx scripts/native-session-qualification/driver.ts --origin http://127.0.0.1:4331 \
  --provider claude --model claude-haiku-5-5 --state "$INTAKE_APP_STATE" --out <evidence-dir>
```

Run providers one at a time, since agent settings are shared. For a dry run of the driver itself, point `INTAKE_CLAUDE_EXECUTABLE` at an executable copy of `tests/fixtures/session-agent.cjs` and pass `--timeout-scale 0.1`; that run makes no provider requests.

## The flow and what it records

1. Saves the subscription model, creates a batch and uploads two synthetic label-card photos.
2. Chats with the Examine lead while it runs.
3. Chats with one running per-lot session and cancels another.
4. After everything settles, uploads a "Reel back" photo: the lead should resume, and lot sessions may cite the new version.
5. Chats with a finished per-lot session.
6. Replaces the cancelled session under an unknown model name and reads the retained failure details.

`<provider>-results.json` summarizes jobs, questions, chat outcomes, status counts and gaps, citations of the new photo, resume observations, cancellation, failure details and the tools named in provider transcripts (Claude project transcripts or Codex rollouts). Timelines and the event log sit beside it. Transcripts and rollouts can contain prompts and evidence text: review them, and attach only redacted summaries to the PR. Never commit evidence.
