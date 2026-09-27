import type {
  ProviderChannel,
  ProviderName,
  ProviderOperation,
  ProviderRequestEnvelope,
} from "@garanti-kulucka/shared";

export interface ProviderAdapterDefinition {
  provider: ProviderName;
  display_name: string;
  channels: ProviderChannel[];
  webhook_operations: ProviderOperation[];
  delivery_operations: ProviderOperation[];
  live_calls_enabled: false;
}

export const providerAdapters: ProviderAdapterDefinition[] = [
  {
    provider: "ptt",
    display_name: "PTT Kargo",
    channels: ["cargo"],
    webhook_operations: [],
    delivery_operations: ["shipment.create", "shipment.track"],
    live_calls_enabled: false,
  },
  {
    provider: "surat",
    display_name: "Surat Kargo",
    channels: ["cargo"],
    webhook_operations: [],
    delivery_operations: ["shipment.create", "shipment.track"],
    live_calls_enabled: false,
  },
  {
    provider: "kolaybi",
    display_name: "KolayBi",
    channels: ["accounting"],
    webhook_operations: [],
    delivery_operations: ["invoice.create"],
    live_calls_enabled: false,
  },
  {
    provider: "meta",
    display_name: "Meta Webhooks",
    channels: ["whatsapp", "instagram", "messenger"],
    webhook_operations: ["message.webhook"],
    delivery_operations: [],
    live_calls_enabled: false,
  },
  {
    provider: "whatsapp",
    display_name: "WhatsApp Cloud API",
    channels: ["whatsapp"],
    webhook_operations: ["message.webhook"],
    delivery_operations: ["message.send"],
    live_calls_enabled: false,
  },
  {
    provider: "instagram",
    display_name: "Instagram Graph API",
    channels: ["instagram"],
    webhook_operations: ["message.webhook"],
    delivery_operations: ["message.send"],
    live_calls_enabled: false,
  },
  {
    provider: "messenger",
    display_name: "Messenger Graph API",
    channels: ["messenger"],
    webhook_operations: ["message.webhook"],
    delivery_operations: ["message.send"],
    live_calls_enabled: false,
  },
  {
    provider: "netgsm",
    display_name: "NetGSM",
    channels: ["sms"],
    webhook_operations: [],
    delivery_operations: ["sms.send"],
    live_calls_enabled: false,
  },
  {
    provider: "vapi",
    display_name: "Vapi",
    channels: ["voice"],
    webhook_operations: ["call.webhook"],
    delivery_operations: [],
    live_calls_enabled: false,
  },
  {
    provider: "sip",
    display_name: "SIP Webphone",
    channels: ["sip"],
    webhook_operations: [],
    delivery_operations: ["sip.config.sync"],
    live_calls_enabled: false,
  },
];

export function findProviderAdapter(provider: ProviderName): ProviderAdapterDefinition {
  const adapter = providerAdapters.find((candidate) => candidate.provider === provider);
  if (!adapter) {
    throw new Error(`Provider adapter is not registered: ${provider}`);
  }

  return adapter;
}

export function assertProviderOperation(
  provider: ProviderName,
  operation: ProviderOperation,
  direction: "webhook" | "delivery",
): ProviderAdapterDefinition {
  const adapter = findProviderAdapter(provider);
  const allowed =
    direction === "webhook" ? adapter.webhook_operations : adapter.delivery_operations;

  if (!allowed.includes(operation)) {
    throw new Error(`Provider operation is not registered: ${provider}.${operation}`);
  }

  return adapter;
}

export function assertProviderEnvelope(
  envelope: Pick<ProviderRequestEnvelope, "provider" | "operation" | "channel">,
  direction: "webhook" | "delivery",
): ProviderAdapterDefinition {
  const adapter = assertProviderOperation(envelope.provider, envelope.operation, direction);

  if (!adapter.channels.includes(envelope.channel)) {
    throw new Error(`Provider channel is not registered: ${envelope.provider}.${envelope.channel}`);
  }

  return adapter;
}
