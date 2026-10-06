import { defineMessages } from "../index.js";

/** Cancellations flow (order review and cancellation confirmation). */
export const cancellationsMessages = defineMessages({
  tr: {
    title: "İptaller",
    reviewOrder: "{orderNumber} incele",
    reviewTitle: "İptal İncelemesi",
    orderRecords: "Sipariş kaydı",
    selectedOrder: "Seçili sipariş",
    status: "Durum",
    awaitingConfirmation: "teyit bekliyor",
    amount: "Tutar",
    note: "Not",
    confirmCancellation: "İptali onayla",
  },
  en: {
    title: "Cancellations",
    reviewOrder: "Review {orderNumber}",
    reviewTitle: "Cancellation Review",
    orderRecords: "Order records",
    selectedOrder: "Selected order",
    status: "Status",
    awaitingConfirmation: "awaiting confirmation",
    amount: "Amount",
    note: "Note",
    confirmCancellation: "Confirm cancellation",
  },
});
