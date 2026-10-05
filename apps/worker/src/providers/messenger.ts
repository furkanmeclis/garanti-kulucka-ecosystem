import {
  messengerMessageAdapterDefinition,
  MetaMessageLiveTransportError,
  sendMetaMessageLiveRequest,
  type MetaMessageFetchTransport,
  type MetaMessageLiveAdapterInput,
  type MetaMessageLiveAdapterResult,
  type MetaMessageTransportRequest,
  type MetaMessageTransportResponse,
} from "./meta-message.js";

export type MessengerTransportResponse = MetaMessageTransportResponse;
export type MessengerTransportRequest = MetaMessageTransportRequest;
export type MessengerFetchTransport = MetaMessageFetchTransport;
export type MessengerLiveAdapterInput = MetaMessageLiveAdapterInput;
export type MessengerLiveAdapterResult = MetaMessageLiveAdapterResult;

export class MessengerLiveTransportError extends MetaMessageLiveTransportError {
  constructor(message: string, attempt: MetaMessageLiveTransportError["attempt"]) {
    super(message, attempt);
    this.name = "MessengerLiveTransportError";
  }
}

export async function sendMessengerLiveRequest(
  input: MessengerLiveAdapterInput,
): Promise<MessengerLiveAdapterResult> {
  try {
    return await sendMetaMessageLiveRequest(messengerMessageAdapterDefinition, input);
  } catch (error) {
    if (error instanceof MetaMessageLiveTransportError) {
      throw new MessengerLiveTransportError(error.message, error.attempt);
    }
    throw error;
  }
}
