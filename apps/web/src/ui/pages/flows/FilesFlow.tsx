import { FileUp, Trash2 } from "lucide-react";
import { FlowPanel, DetailPanel, DataRows } from "../../app/shared.js";
import type { DashboardController } from "../../app/useDashboardController.js";

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

  return (
    <FlowPanel title="Dosya Upload" icon={<FileUp size={18} />} testId="file-upload-flow">
            <button className="primary-action" type="button" onClick={handleUpload}>
              Presigned Upload Testi
            </button>
            {uploadedFile && <p className="result-line">{uploadedFile.original_name} kaydedildi</p>}
            {uploadedFile && (
              <DetailPanel title="Dosya Doğrulama" testId="file-metadata-detail">
                <DataRows
                  rows={[
                    ["Bucket", uploadedFile.bucket, "files API"],
                    ["Object key", uploadedFile.object_key, uploadedFile.mime_type ?? "-"],
                    ["Boyut", uploadedFile.byte_size === null ? "-" : `${uploadedFile.byte_size} byte`, uploadedFile.checksum ?? "-"],
                    ["Kayıt", uploadedFile.public_id, uploadedFile.updated_at],
                  ]}
                />
              </DetailPanel>
            )}
            {downloadInstruction && (
              <DetailPanel title="Dosya İndirme" testId="file-download-detail">
                <DataRows
                  rows={[
                    ["Method", downloadInstruction.method, "presigned download"],
                    ["Bucket", downloadInstruction.bucket, downloadInstruction.object_key],
                    ["URL", downloadInstruction.presigned_url ? "hazır" : "kapalı", downloadInstruction.expires_at ?? "-"],
                  ]}
                />
              </DetailPanel>
            )}
            {user?.role === "admin" && (
              <DetailPanel title="Orphan Dosya Adayları" testId="file-orphans-detail">
                <button
                  className="primary-action"
                  type="button"
                  disabled={orphanCleanupPreviewing || data.fileOrphans.length === 0}
                  onClick={() => void handlePrepareOrphanCleanupDryRun()}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  {orphanCleanupPreviewing ? "Lifecycle dry-run hazırlanıyor" : "Orphan cleanup dry-run hazırla"}
                </button>
                <DataRows
                  rows={[
                    ["Aday", String(data.fileOrphanSummary.total_count), "files orphan summary"],
                    ...data.fileOrphans.map((file) => [
                      file.original_name ?? file.public_id,
                      file.object_key,
                      file.byte_size === null ? "boyut yok" : `${file.byte_size} byte`,
                    ]),
                  ]}
                />
                {orphanCleanupPreview && (
                  <DataRows
                    rows={[
                      ["Son dry-run", orphanCleanupPreview.request_id, orphanCleanupPreview.mode],
                      ["Silme", orphanCleanupPreview.deletion_performed ? "yapıldı" : "yapılmadı", orphanCleanupPreview.reason ?? "-"],
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

