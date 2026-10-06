import { defineMessages } from "../index.js";

/** Webphone flow (PBX status and SIP server settings). */
export const webphoneMessages = defineMessages({
  tr: {
    pbxActive: "Santral aktif",
    pbxDisabled: "Santral kapalı",
    noSipDomain: "SIP domain yok",
    serverTitle: "Santral Sunucu Bilgileri",
    active: "aktif",
    disabled: "kapalı",
    savePbxSettings: "Santral ayarını kaydet",
  },
  en: {
    pbxActive: "PBX active",
    pbxDisabled: "PBX disabled",
    noSipDomain: "No SIP domain",
    serverTitle: "PBX Server Details",
    active: "active",
    disabled: "disabled",
    savePbxSettings: "Save PBX settings",
  },
});
