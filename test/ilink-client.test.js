import test from "node:test";
import assert from "node:assert/strict";
import { assertApiSuccess, buildClientVersion, buildHeaders, buildTextMessageBody, validateBaseUrl } from "../src/ilink-client.js";

test("buildClientVersion encodes semantic version", () => {
  assert.equal(buildClientVersion("2.4.3"), 132099);
  assert.equal(buildClientVersion("1.0.11"), 65547);
});

test("validateBaseUrl requires https", () => {
  assert.equal(validateBaseUrl("https://ilinkai.weixin.qq.com/"), "https://ilinkai.weixin.qq.com");
  assert.throws(() => validateBaseUrl("http://example.test"), /HTTPS/);
});

test("buildHeaders redaction-sensitive values are generated only as headers", () => {
  const headers = buildHeaders({ token: "secret-token" });
  assert.equal(headers.Authorization, "Bearer secret-token");
  assert.equal(headers.AuthorizationType, "ilink_bot_token");
  assert.equal(headers["iLink-App-Id"], "bot");
  assert.ok(headers["X-WECHAT-UIN"]);
});

test("buildTextMessageBody builds text send payload", () => {
  const payload = buildTextMessageBody({
    target: "target@im.wechat",
    text: "hello",
    contextToken: "ctx",
    clientId: "client-1",
  });
  assert.equal(payload.msg.to_user_id, "target@im.wechat");
  assert.equal(payload.msg.message_type, 2);
  assert.equal(payload.msg.message_state, 2);
  assert.equal(payload.msg.context_token, "ctx");
  assert.equal(payload.msg.item_list[0].text_item.text, "hello");
});

test("assertApiSuccess includes non-secret iLink error details", () => {
  assert.throws(
    () => assertApiSuccess({ ret: 123, errmsg: "bad context" }, "Send message"),
    /Send message failed; ret=123; message=bad context/,
  );
});
