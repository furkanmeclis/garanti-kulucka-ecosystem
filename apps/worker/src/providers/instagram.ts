import {
  instagramMessageAdapterDefinition,
  MetaMessageLiveTransportError,
  sendMetaMessageLiveRequest,
  type MetaMessageFetchTransport,
  type MetaMessageLiveAdapterInput,
  type MetaMessageLiveAdapterResult,
  type MetaMessageTransportRequest,
  type MetaMessageTransportResponse,
} from "./meta-message.js";

export type InstagramTransportResponse = MetaMessageTransportResponse;
export type InstagramTransportRequest = MetaMessageTransportRequest;
export type InstagramFetchTransport = MetaMessageFetchTransport;
export type InstagramLiveAdapterInput = MetaMessageLiveAdapterInput;
export type InstagramLiveAdapterResult = MetaMessageLiveAdapterResult;

export class InstagramLiveTransportError extends MetaMessageLiveTransportError {
  constructor(message: string, attempt: MetaMessageLiveTransportError["attempt"]) {
    super(message, attempt);
    this.name = "InstagramLiveTransportError";
  }
}

export async function sendInstagramLiveRequest(
  input: InstagramLiveAdapterInput,
): Promise<InstagramLiveAdapterResult> {
  try {
    return await sendMetaMessageLiveRequest(instagramMessageAdapterDefinition, input);
  } catch (error) {
    if (error instanceof MetaMessageLiveTransportError) {
      throw new InstagramLiveTransportError(error.message, error.attempt);
    }
    throw error;
  }
}
