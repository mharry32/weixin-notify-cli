import { getUpdates } from "./ilink-client.js";
import { getAccount, readSyncState, setContextToken, writeSyncState, withLock } from "./store.js";

export async function syncOnceCommand(options = {}) {
  return withLock("sync", async () => {
    const { account } = await getAccount(options.account);
    const sync = await readSyncState();
    const current = sync[account.accountId] || {};
    const resp = await getUpdates({
      baseUrl: account.baseUrl,
      token: account.token,
      syncBuffer: current.get_updates_buf || "",
      timeoutMs: Math.max(Number(options.timeoutSeconds || 35) * 1000, 1000),
    });

    let updatedTokens = 0;
    const messages = Array.isArray(resp.msgs) ? resp.msgs : Array.isArray(resp.messages) ? resp.messages : [];
    for (const msg of messages) {
      if (msg?.from_user_id && msg?.context_token) {
        await setContextToken(account.accountId, msg.from_user_id, msg.context_token);
        updatedTokens += 1;
      }
    }

    sync[account.accountId] = {
      get_updates_buf: resp.get_updates_buf || current.get_updates_buf || "",
      updatedAt: new Date().toISOString(),
    };
    await writeSyncState(sync);

    return {
      ok: true,
      account: account.accountId,
      messages: messages.length,
      updatedTokens,
      hasSyncBuffer: Boolean(sync[account.accountId].get_updates_buf),
    };
  });
}
