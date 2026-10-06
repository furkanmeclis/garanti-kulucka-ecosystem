import { Boxes, Headphones } from "lucide-react";
import { FlowPanel, DetailPanel, DataRows } from "../../app/shared.js";
import type { DashboardController } from "../../app/useDashboardController.js";
import { useT } from "../../i18n/index.js";
import { webphoneMessages } from "../../i18n/messages/webphone.js";

export function WebphoneFlow({ ctx }: { ctx: DashboardController }) {
  const {
    data,
    handleSaveSipConfig,
    sipServerSettings,
  } = ctx;
  const t = useT(webphoneMessages);

  return (
    <FlowPanel title="Webphone" icon={<Headphones size={18} />} testId="webphone-flow">
            <div className="webphone-card">
              <Boxes size={22} aria-hidden="true" />
              <div>
                <strong>{data.webphone?.enabled ? t("pbxActive") : t("pbxDisabled")}</strong>
                <span>{data.webphone?.sip_domain ?? t("noSipDomain")}</span>
              </div>
            </div>
            <DetailPanel title={t("serverTitle")} testId="sip-config-detail">
              <DataRows
                rows={[
                  ["WebSocket", sipServerSettings.ws_url || "-", "admin settings"],
                  ["Domain", sipServerSettings.domain || "-", "webphone API"],
                  ["STUN", sipServerSettings.stun, "browser WebRTC"],
                  ["Transport", data.webphone?.transport ?? "-", data.webphone?.enabled ? t("active") : t("disabled")],
                ]}
              />
              <button className="primary-action" type="button" onClick={handleSaveSipConfig}>
                {t("savePbxSettings")}
              </button>
            </DetailPanel>
          </FlowPanel>
  );
}

