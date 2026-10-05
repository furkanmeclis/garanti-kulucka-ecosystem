import { z } from "zod";

export const settingsChangedMessageSchema = z.object({
  scope: z.string().min(1),
  key: z.string().min(1),
  version: z.number().int().positive().nullable(),
  source: z.enum(["settings", "integration_settings"]),
});

export type SettingsChangedMessage = z.infer<typeof settingsChangedMessageSchema>;
