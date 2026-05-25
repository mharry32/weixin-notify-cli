# Local Development

This document is intentionally not included in the npm package.

Use a separate executable and state directory when testing a development checkout beside an existing installation:

```bash
WEIXIN_NOTIFY_STATE_DIR=~/.codex-weixin-notify-open node bin/weixin-notify.js status --json
```

The `dev-bin/weixin-notify-open.js` wrapper sets this state directory automatically before delegating to the real CLI entrypoint:

```bash
weixin-notify-open status --json
printf '%s' "$MESSAGE" | weixin-notify-open send --stdin --json
```

The wrapper is for local side-by-side testing only and is not listed in `package.json` `bin`.
