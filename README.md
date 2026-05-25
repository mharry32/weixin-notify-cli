# Weixin Notify CLI

Weixin Notify CLI is an unofficial, local-first command-line tool for sending outbound Weixin text messages through Tencent's iLink Bot API. It is built for Codex, Claude Code, shell scripts, cron jobs, CI runners, and other agent workflows that need a one-shot completion message without running a daemon, chatbot runtime, or inbound listener.

This project is not affiliated with Tencent or WeChat. The iLink API may change, rate-limit, or stop working at any time.

## Install

```bash
npm install -g @dev32/weixin-notify-cli
```

For development from a checkout:

```bash
npm install
npm link
```

## First-Time Setup

QR login saves local bot credentials, but some Weixin accounts do not allow the bot to send an outbound message until the user has first opened the conversation. After the first successful `login`, send any short message to the newly bound bot from Weixin, then refresh local sync state:

```bash
weixin-notify login
# In Weixin, send a short message such as "hi" to the bot.
weixin-notify sync-once --json
weixin-notify status --json
```

After that handshake, preview and send:

```bash
printf '%s' 'test from weixin-notify' | weixin-notify send --stdin --dry-run --json
printf '%s' 'test from weixin-notify' | weixin-notify send --stdin --json
```

## Commands

```bash
weixin-notify login
weixin-notify status
weixin-notify status --json
weixin-notify status --json --field ok
weixin-notify send --message "Task finished"
printf '%s' "$MESSAGE" | weixin-notify send --stdin --json
weixin-notify send --message "Preview only" --dry-run --json
weixin-notify sync-once --timeout 35 --json
weixin-notify logout
```

## Agent Workflows

The recommended agent path is stdin plus JSON:

```bash
printf '%s' "$MESSAGE" | weixin-notify send --stdin --json
```

This works well from Codex, Claude Code, shell scripts, cron jobs, and CI runners because the command is bounded, non-daemonized, and returns stable JSON. Use `--dry-run --json` for previews and `--no-input` or `WEIXIN_NOTIFY_PROMPT_DISABLED=1` in unattended runs.

If an automation reports that credentials are present but sending still fails after a fresh login, complete the first-time Weixin handshake above before retrying.

## Output

Human output is short and semantic by default. Use `--json` when another program or agent needs stable output.

JSON errors are redacted and use this shape:

```json
{"ok":false,"code":"NO_CREDENTIALS","message":"No Weixin credentials found. Run: weixin-notify login"}
```

Use `--field <path>` with `--json` to reduce output before it enters an automation context:

```bash
weixin-notify status --json --field credentialPresent
weixin-notify send --message "Preview" --dry-run --json --field chunks
```

Field paths are dot-separated object keys with numeric array indexes, such as `warnings.0`.

## Non-Interactive Mode

Use either form to disable prompts:

```bash
weixin-notify login --no-input --json
WEIXIN_NOTIFY_PROMPT_DISABLED=1 weixin-notify status --json
```

In no-input mode, commands do not wait for terminal prompts. Login exits with a structured error because QR confirmation is interactive. `send --stdin` remains safe for automation when stdin is piped.

## State

By default, local state is stored in:

```text
~/.codex-weixin-notify/
```

Files include:

- `config.json`
- `context-tokens.json`
- `sync.json`
- `send-log.jsonl`

Override the state directory for tests or isolated environments:

```bash
WEIXIN_NOTIFY_STATE_DIR=/path/to/state weixin-notify status --json
```

The state directory is created with mode `0700`; credential files are written with mode `0600`.

## Security And Redaction

The CLI is designed to avoid printing secrets in normal or JSON output. It does not print bot tokens, authorization headers, raw context tokens, sync buffers, or raw message bodies in dry-run payloads. Account IDs and targets are redacted in user-facing output.

Keep the state directory private. A copied `config.json` can contain active bot credentials.

## Exit Codes

- `0`: success
- `2`: bad CLI usage
- `10`: no credentials; run `weixin-notify login`
- `11`: credentials expired; run `weixin-notify login`
- `12`: no target configured
- `13`: target not in allowlist
- `20`: transient network failure
- `21`: iLink API returned non-success
- `30`: local state read/write failure
- `40`: unsupported or disabled interactive operation

## Limitations

This is a one-shot notification sender. It does not run a daemon, scheduler, inbound listener, model, agent runtime, OpenClaw, or Hermes. First-time sending may require the Weixin user to message the bot once after QR login before outbound sends succeed. Target management commands are planned future work; the first release keeps the login and send path small.
