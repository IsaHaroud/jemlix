import { expect, test } from "bun:test";
import { forwardedChannelFromMessage } from "./telegram.ts";

test("reads a forwarded channel from the current Bot API format", () => {
  expect(forwardedChannelFromMessage({
    forward_origin: {
      type: "channel",
      chat: { id: -100123456, type: "channel", title: "Grossiste Casa" },
      message_id: 42,
    },
  })).toEqual({ id: "-100123456", title: "Grossiste Casa" });
});

test("keeps legacy forwarded channel support", () => {
  expect(forwardedChannelFromMessage({
    forward_from_chat: { id: -100999, type: "channel", title: "Old export" },
  })).toEqual({ id: "-100999", title: "Old export" });
});

test("does not treat user or hidden forwards as channels", () => {
  expect(forwardedChannelFromMessage({
    forward_origin: { type: "hidden_user", sender_user_name: "Someone" },
  })).toBeNull();
  expect(forwardedChannelFromMessage({
    forward_origin: { type: "user", sender_user: { id: 10 } },
  })).toBeNull();
});
