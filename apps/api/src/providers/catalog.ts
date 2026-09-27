import type { ProviderChannel, ProviderName, ProviderOperation } from "@garanti-kulucka/shared";

export interface ApiProviderCatalogItem {
  provider: ProviderName;
  channels: ProviderChannel[];
  supported_operations: ProviderOperation[];
  contract_mode: "fixture_only";
}

export const apiProviderCatalog: ApiProviderCatalogItem[] = [
  {
    provider: "ptt",
    channels: ["cargo"],
    supported_operations: ["shipment.create", "shipment.track"],
    contract_mode: "fixture_only",
  },
  {
    provider: "surat",
    channels: ["cargo"],
    supported_operations: ["shipment.create", "shipment.track"],
    contract_mode: "fixture_only",
  },
  {
    provider: "kolaybi",
    channels: ["accounting"],
    supported_operations: ["invoice.create"],
    contract_mode: "fixture_only",
  },
  {
    provider: "meta",
    channels: ["whatsapp", "instagram", "messenger"],
    supported_operations: ["message.webhook"],
    contract_mode: "fixture_only",
  },
  {
    provider: "whatsapp",
    channels: ["whatsapp"],
    supported_operations: ["message.webhook", "message.send"],
    contract_mode: "fixture_only",
  },
  {
    provider: "instagram",
    channels: ["instagram"],
    supported_operations: ["message.webhook", "message.send"],
    contract_mode: "fixture_only",
  },
  {
    provider: "messenger",
    channels: ["messenger"],
    supported_operations: ["message.webhook", "message.send"],
    contract_mode: "fixture_only",
  },
  {
    provider: "netgsm",
    channels: ["sms"],
    supported_operations: ["sms.send"],
    contract_mode: "fixture_only",
  },
  {
    provider: "vapi",
    channels: ["voice"],
    supported_operations: ["call.webhook"],
    contract_mode: "fixture_only",
  },
  {
    provider: "sip",
    channels: ["sip"],
    supported_operations: ["sip.config.sync"],
    contract_mode: "fixture_only",
  },
];

export function getApiProviderCatalogItem(provider: ProviderName): ApiProviderCatalogItem {
  const item = apiProviderCatalog.find((candidate) => candidate.provider === provider);
  if (!item) {
    throw new Error(`Provider is not exposed by the API catalog: ${provider}`);
  }

  return item;
}
