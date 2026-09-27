import type { ProviderChannel, ProviderName, ProviderOperation } from "@garanti-kulucka/shared";

export type WebhookProvider = Exclude<ProviderName, "sip">;

export interface ProviderCallbackRoute {
  provider: WebhookProvider;
  channel: ProviderChannel;
  operation: ProviderOperation;
  path: string;
}

export const providerWebhookRoutes: ProviderCallbackRoute[] = [
  { provider: "meta", channel: "whatsapp", operation: "message.webhook", path: "/meta" },
  { provider: "instagram", channel: "instagram", operation: "message.webhook", path: "/instagram" },
  { provider: "messenger", channel: "messenger", operation: "message.webhook", path: "/messenger" },
  { provider: "whatsapp", channel: "whatsapp", operation: "message.webhook", path: "/whatsapp" },
  { provider: "netgsm", channel: "sms", operation: "sms.send", path: "/netgsm" },
  { provider: "vapi", channel: "voice", operation: "call.webhook", path: "/vapi" },
  { provider: "ptt", channel: "cargo", operation: "shipment.track", path: "/ptt" },
  { provider: "surat", channel: "cargo", operation: "shipment.track", path: "/surat" },
  { provider: "kolaybi", channel: "accounting", operation: "invoice.create", path: "/kolaybi" },
];

export function getProviderCallbackRoute(provider: WebhookProvider): ProviderCallbackRoute {
  const route = providerWebhookRoutes.find((candidate) => candidate.provider === provider);
  if (!route) {
    throw new Error(`Unsupported webhook provider: ${provider}`);
  }

  return route;
}
