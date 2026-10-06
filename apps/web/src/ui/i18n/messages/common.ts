import { defineMessages } from "../index.js";

/** Labels shared across screens (status names, attachment types, generic actions). */
export const commonMessages = defineMessages({
  tr: {
    statusCreated: "Oluşturuldu",
    statusPendingConfirmation: "Teyit Bekliyor",
    statusConfirmed: "Teyit Edildi",
    statusPreparing: "Hazırlanıyor",
    statusShippedOrder: "Sevk Edildi",
    statusShipped: "Kargoya Verildi",
    statusInTransit: "Kargoda",
    statusOutForDelivery: "Dağıtımda",
    statusDelivered: "Teslim Edildi",
    statusReturned: "İade",
    statusCancelled: "İptal",
    attachmentImage: "Görsel",
    attachmentVideo: "Video",
    attachmentPdf: "PDF",
    attachmentFile: "Dosya",
  },
  en: {
    statusCreated: "Created",
    statusPendingConfirmation: "Awaiting Confirmation",
    statusConfirmed: "Confirmed",
    statusPreparing: "Preparing",
    statusShippedOrder: "Dispatched",
    statusShipped: "Handed to Carrier",
    statusInTransit: "In Transit",
    statusOutForDelivery: "Out for Delivery",
    statusDelivered: "Delivered",
    statusReturned: "Returned",
    statusCancelled: "Cancelled",
    attachmentImage: "Image",
    attachmentVideo: "Video",
    attachmentPdf: "PDF",
    attachmentFile: "File",
  },
});

export type CommonKey = keyof (typeof commonMessages)["tr"];
