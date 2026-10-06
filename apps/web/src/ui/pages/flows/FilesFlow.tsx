import { FileUp, Trash2 } from "lucide-react";
import { FlowPanel, DetailPanel, DataRows } from "../../app/shared.js";
import type { DashboardController } from "../../app/useDashboardController.js";
import { useT } from "../../i18n/index.js";
import { filesMessages } from "../../i18n/messages/files.js";

export function FilesFlow({ ctx }: { ctx: DashboardController }) {
  const {
    data,
    downloadInstruction,
    handlePrepareOrphanCleanupDryRun,
    handleUpload,
    orphanCleanupPreview,
    orphanCleanupPreviewing,
    uploadedFile,
    user,
  } = ctx;
  const t = useT(filesMessages);

  return (
    <FlowPanel title={t("title")} icon={<FileUp size={18} />} testId="file-upload-flow">
            <button className="primary-action" type="button" onClick={handleUpload}>
              {t("presignedUploadTest")}
            </button>
            {uploadedFile && <p className="result-line">{t("fileSaved", { name: uploadedFile.original_name ?? "" })}</p>}
            {uploadedFile && (
              <DetailPanel title={t("verificationTitle")} testId="file-metadata-detail">
                <DataRows
                  rows={[
                    ["Bucket", uploadedFile.bucket, "files API"],
                    ["Object key", uploadedFile.object_key, uploadedFile.mime_type ?? "-"],
                    [t("size"), uploadedFile.byte_size === null ? "-" : t("sizeBytes", { size: uploadedFile.byte_size }), uploadedFile.checksum ?? "-"],
                    [t("record"), uploadedFile.public_id, uploadedFile.updated_at],
                  ]}
                />
              </DetailPanel>
            )}
            {downloadInstruction && (
              <DetailPanel title={t("downloadTitle")} testId="file-download-detail">
                <DataRows
                  rows={[
                    ["Method", downloadInstruction.method, "presigned download"],
                    ["Bucket", downloadInstruction.bucket, downloadInstruction.object_key],
                    ["URL", downloadInstruction.presigned_url ? t("urlReady") : t("urlClosed"), downloadInstruction.expires_at ?? "-"],
                  ]}
                />
              </DetailPanel>
            )}
            {user?.role === "admin" && (
              <DetailPanel title={t("orphansTitle")} testId="file-orphans-detail">
                <button
                  className="primary-action"
                  type="button"
                  disabled={orphanCleanupPreviewing || data.fileOrphans.length === 0}
                  onClick={() => void handlePrepareOrphanCleanupDryRun()}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {orphanCleanupPreviewing ? t("dryRunPreparing") : t("dryRunPrepare")}
                </button>
                <DataRows
                  rows={[
                    [t("candidate"), String(data.fileOrphanSummary.total_count), "files orphan summary"],
                    ...data.fileOrphans.map((file) => [
                      file.original_name ?? file.public_id,
                      file.object_key,
                      file.byte_size === null ? t("noSize") : t("sizeBytes", { size: file.byte_size }),
                    ]),
                  ]}
                />
                {orphanCleanupPreview && (
                  <DataRows
                    rows={[
                      [t("lastDryRun"), orphanCleanupPreview.request_id, orphanCleanupPreview.mode],
                      [t("deletion"), orphanCleanupPreview.deletion_performed ? t("deletionPerformed") : t("deletionNotPerformed"), orphanCleanupPreview.reason ?? "-"],
                      [
                        "Storage",
                        orphanCleanupPreview.storage_action.bucket,
                        `${orphanCleanupPreview.storage_action.operation} ${orphanCleanupPreview.storage_action.object_key}`,
                      ],
                    ]}
                  />
                )}
              </DetailPanel>
            )}
          </FlowPanel>
  );
}

