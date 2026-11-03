import type { Pool } from "pg";
import type { ServerConfig } from "./config";
import { captureScheduledReport, flushReportEmails } from "./reportQueue";
import { readReportEmailSettings, sendReportEmail } from "./reportMail";

type RuntimeConfig = Pick<ServerConfig, "backupDir" | "distDir" | "timeZone" | "appOrigin">;

export async function runReportEmails(config: RuntimeConfig, pool: Pool, options: { now?: Date } = {}) {
  const settings = readReportEmailSettings(config);
  if (!settings.enabled) return { status: "disabled" as const, sent: [], failed: [], pending: 0 };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await captureScheduledReport(client, {
      now: options.now ?? new Date(), timeZone: config.timeZone,
      messageIdDomain: new URL(config.appOrigin).hostname,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
  return flushReportEmails(settings, pool, (snapshot, event, messageId) => sendReportEmail(settings, snapshot, event, messageId), options);
}
