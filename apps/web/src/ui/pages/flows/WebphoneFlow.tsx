import { Boxes, Headphones } from "lucide-react";
import { FlowPanel, DetailPanel, DataRows } from "../../app/shared.js";
import type { DashboardController } from "../../app/useDashboardController.js";

export function WebphoneFlow({ ctx }: { ctx: DashboardController }) {
  const {
    data,
    handleSaveSipConfig,
    sipServerSettings,
  } = ctx;

  return (
    <FlowPanel title="Webphone" icon={<Headphones size={18} />} testId="webphone-flow">
            <div className="webphone-card">
              <Boxes size={22} aria-hidden="true" />
              <div>
                <strong>{data.webphone?.enabled ? "Santral aktif" : "Santral kapalı"}</strong>
                <span>{data.webphone?.sip_domain ?? "SIP domain yok"}</span>
              </div>
            </div>
            <DetailPanel title="Santral Sunucu Bilgileri" testId="sip-config-detail">
              <DataRows
                rows={[
                  ["WebSocket", sipServerSettings.ws_url || "-", "admin settings"],
                  ["Domain", sipServerSettings.domain || "-", "webphone API"],
                  ["STUN", sipServerSettings.stun, "browser WebRTC"],
                  ["Transport", data.webphone?.transport ?? "-", data.webphone?.enabled ? "aktif" : "kapalı"],
                ]}
              />
              <button className="primary-action" type="button" onClick={handleSaveSipConfig}>
                Santral ayarını kaydet
              </button>
            </DetailPanel>
          </FlowPanel>
  );
}

