export type ForwardedChannel = {
  id: string;
  title: string;
};

// Bot API 7+ uses message.forward_origin. Keep the legacy field as a fallback
// for older fixtures/servers, but never treat a forward as proof of ownership.
export function forwardedChannelFromMessage(message: unknown): ForwardedChannel | null {
  if (!message || typeof message !== "object") return null;
  const msg = message as any;
  const origin = msg.forward_origin;
  if (origin?.type === "channel" && origin.chat?.type === "channel" && origin.chat.id != null) {
    return { id: String(origin.chat.id), title: String(origin.chat.title || "") };
  }
  const legacy = msg.forward_from_chat;
  if (legacy?.type === "channel" && legacy.id != null) {
    return { id: String(legacy.id), title: String(legacy.title || "") };
  }
  return null;
}
