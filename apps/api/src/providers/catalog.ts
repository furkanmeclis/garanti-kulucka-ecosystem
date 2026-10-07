import type { ProviderChannel, ProviderName, ProviderOperation } from "@garanti-kulucka/shared";

export interface ApiProviderCatalogItem {
  provider: ProviderName;
  channels: ProviderChannel[];
  supported_operations: ProviderOperation[];
  contract_mode: "fixture_only";
  live_feature_flag_key: string;
  live_call_permitted: false;
  live_block_reason: "fixture_replay_contract_required";
}

function catalogItem(
  provider: ProviderName,
  channels: ProviderChannel[],
  supportedOperations: ProviderOperation[],
): ApiProviderCatalogItem {
  return {
    provider,
    channels,
    supported_operations: supportedOperations,
    contract_mode: "fixture_only",
    live_feature_flag_key: `providers.${provider}.live_mode`,
    live_call_permitted: false,
    live_block_reason: "fixture_replay_contract_required",
  };
}

export const apiProviderCatalog: ApiProviderCatalogItem[] = [
  catalogItem("ptt", ["cargo"], ["shipment.create", "shipment.track"]),
  catalogItem("surat", ["cargo"], ["shipment.create", "shipment.track"]),
  catalogItem("kolaybi", ["accounting"], [
    "invoice.create",
    "invoice.get",
    "invoice.e_document.create",
    "invoice.e_document.cancel",
    "contact.find",
    "contact.create",
    "contact.update",
    "invoice.payment.create",
    "product.list",
  ]),
  catalogItem("meta", ["whatsapp", "instagram", "messenger"], ["message.webhook"]),
  catalogItem("whatsapp", ["whatsapp"], ["message.webhook", "message.send"]),
  catalogItem("instagram", ["instagram"], [
    "message.webhook",
    "message.send",
    "media.publish",
    "comment.reply",
    "comment.private_reply",
    "comment.hide",
    "comment.delete",
  ]),
  catalogItem("messenger", ["messenger"], ["message.webhook", "message.send"]),
  catalogItem("netgsm", ["sms", "voice"], ["sms.send", "call.confirmation.create", "call.confirmation.status", "call.report", "voice.message.send", "voice.message.report"]),
  catalogItem("vapi", ["voice"], ["call.webhook", "call.create", "call.get"]),
  catalogItem("sip", ["sip"], ["sip.config.sync"]),
];

export function getApiProviderCatalogItem(provider: ProviderName): ApiProviderCatalogItem {
  const item = apiProviderCatalog.find((candidate) => candidate.provider === provider);
  if (!item) {
    throw new Error(`Provider is not exposed by the API catalog: ${provider}`);
  }

  return item;
}
