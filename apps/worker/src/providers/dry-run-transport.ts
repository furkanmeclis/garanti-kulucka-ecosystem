import type { ProviderName, ProviderRequestEnvelope } from "@garanti-kulucka/shared";
import { buildProviderTransportPayload } from "./payloads.js";
import { providerTransportPolicyFor } from "./transport-policy.js";

export type ProviderDryRunMethod = "GET" | "POST";

export interface ProviderDryRunRequest {
  provider: ProviderName;
  operation: ProviderRequestEnvelope["operation"];
  request_id: string;
  method: ProviderDryRunMethod;
  path: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | null;
  live_call_performed: false;
}

const redactedSecret = "[redacted:admin-managed]";

function providerPath(envelope: ProviderRequestEnvelope): string {
  switch (`${envelope.provider}:${envelope.operation}`) {
    case "ptt:shipment.create":
      return "/ptt/shipments";
    case "ptt:shipment.track":
      return "/ptt/shipments/track";
    case "surat:shipment.create":
      return "/surat/shipments";
    case "surat:shipment.track":
      return "/surat/shipments/track";
    case "kolaybi:invoice.create":
      return "/kolaybi/invoices";
    case "kolaybi:invoice.get":
      return "/kolaybi/invoices/show";
    case "kolaybi:invoice.e_document.create":
      return "/kolaybi/invoices/e-document/create";
    case "kolaybi:invoice.e_document.cancel":
      return "/kolaybi/invoices/e-document/cancel";
    case "kolaybi:contact.find":
      return "/kolaybi/associates/find";
    case "kolaybi:contact.create":
      return "/kolaybi/associates";
    case "kolaybi:contact.update":
      return "/kolaybi/associates/update";
    case "kolaybi:invoice.payment.create":
      return "/kolaybi/invoices/proceed";
    case "kolaybi:product.list":
      return "/kolaybi/products";
    case "netgsm:call.confirmation.create":
      return "/netgsm/voicesms/send";
    case "netgsm:call.confirmation.status":
    case "netgsm:voice.message.report":
      return "/netgsm/voicesms/report";
    case "netgsm:voice.message.send":
      return "/netgsm/voicesms/send";
    case "whatsapp:message.send":
      return "/meta/whatsapp/messages";
    case "instagram:message.send":
      return "/meta/instagram/messages";
    case "messenger:message.send":
      return "/meta/messenger/messages";
    case "instagram:media.publish":
      return "/meta/instagram/media_publish";
    case "instagram:comment.reply":
      return "/meta/instagram/comments/replies";
    case "instagram:comment.private_reply":
      return "/meta/instagram/comments/private_replies";
    case "instagram:comment.hide":
      return "/meta/instagram/comments/hide";
    case "instagram:comment.delete":
      return "/meta/instagram/comments/delete";
    case "netgsm:sms.send":
      return "/netgsm/sms";
    case "vapi:call.create":
      return "/vapi/calls";
    case "vapi:call.get":
      return "/vapi/calls/show";
    case "netgsm:call.report":
      return "/netgsm/netsantral/report";
    case "sip:sip.config.sync":
      return "/sip/config/sync";
    case "meta:message.webhook":
    case "whatsapp:message.webhook":
    case "instagram:message.webhook":
    case "messenger:message.webhook":
    case "vapi:call.webhook":
      return `/webhooks/${envelope.provider}`;
  }

  throw new Error(`Provider dry-run route is not registered: ${envelope.provider}.${envelope.operation}`);
}

function providerHeaders(provider: ProviderName): Record<string, string> {
  switch (provider) {
    case "ptt":
    case "surat":
    case "kolaybi":
    case "netgsm":
      return {
        "content-type": "application/json",
        "x-provider-credential": redactedSecret,
      };
    case "meta":
    case "whatsapp":
    case "instagram":
    case "messenger":
      return {
        "content-type": "application/json",
        authorization: redactedSecret,
      };
    case "vapi":
      return {
        "content-type": "application/json",
        "x-vapi-signature": redactedSecret,
      };
    case "sip":
      return {
        "content-type": "application/json",
      };
  }
}

export function buildProviderDryRunRequest(envelope: ProviderRequestEnvelope): ProviderDryRunRequest {
  const policy = providerTransportPolicyFor(envelope);
  if (policy.live_call_permitted) {
    throw new Error(`Provider dry-run cannot represent live transport for ${envelope.provider}`);
  }

  const transportPayload = buildProviderTransportPayload(envelope);

  return {
    provider: envelope.provider,
    operation: envelope.operation,
    request_id: envelope.request_id,
    method: envelope.direction === "inbound" ? "POST" : "POST",
    path: providerPath(envelope),
    headers: providerHeaders(envelope.provider),
    body: transportPayload.body,
    live_call_performed: false,
  };
}
