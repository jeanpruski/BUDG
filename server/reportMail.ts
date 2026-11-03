import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import nodemailer from "nodemailer";
import { z } from "zod";
import type { ServerConfig } from "./config";
import type { ServerSnapshot } from "./jobs";
import { renderMonthlyReport, type MonthlyReport, type ReportEvent } from "./monthlyReport";

const email = z.string().trim().email().max(254);
const enabledSchema = z.object({
  enabled: z.literal(true),
  from: email,
  to: email,
  transport: z.enum(["sendmail", "smtp"]).default("sendmail"),
  sendmailPath: z.string().default("/usr/sbin/sendmail"),
  smtp: z.object({
    host: z.string().min(1).max(254).regex(/^[a-z0-9.-]+$/i),
    port: z.union([z.literal(465), z.literal(587)]),
    user: z.string().min(1).max(254),
    password: z.string().min(1).max(1024),
  }).optional(),
}).superRefine((value, context) => {
  if (value.transport === "smtp" && !value.smtp)
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Les paramètres SMTP sont obligatoires." });
  if (value.transport === "sendmail" && (!isAbsolute(value.sendmailPath) || /[\r\n\0]/.test(value.sendmailPath)))
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Le programme d’envoi doit être un chemin absolu." });
});
export type ReportEmailSettings = { enabled: false } | z.infer<typeof enabledSchema>;
type RuntimeConfig = Pick<ServerConfig, "backupDir" | "distDir" | "timeZone" | "appOrigin">;

/** A private file shared by Passenger and Cron avoids duplicating SMTP secrets in N0C. */
export function readReportEmailSettings(config: Pick<RuntimeConfig, "backupDir" | "distDir">, env: NodeJS.ProcessEnv = process.env): ReportEmailSettings {
  if (env.BUDG_REPORT_EMAIL_ENABLED === "false") return { enabled: false };
  const file = env.BUDG_REPORT_EMAIL_CONFIG || resolve(config.backupDir, "..", "budg-report-email.json");
  if (!isAbsolute(file)) throw new Error("La configuration email doit être un fichier privé absolu.");
  const publicRelative = relative(config.distDir, file);
  if (publicRelative === "" || (!publicRelative.startsWith(`..${sep}`) && publicRelative !== ".." && !isAbsolute(publicRelative)))
    throw new Error("La configuration email doit rester hors du dossier public.");
  let value: unknown;
  try { value = JSON.parse(readFileSync(file, "utf8")); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !env.BUDG_REPORT_EMAIL_CONFIG && env.BUDG_REPORT_EMAIL_ENABLED !== "true") return { enabled: false };
    throw new Error("La configuration privée des emails est illisible.");
  }
  if (!value || typeof value !== "object" || !("enabled" in value)) throw new Error("Configuration des emails invalide.");
  if (value.enabled === false && env.BUDG_REPORT_EMAIL_ENABLED !== "true") return { enabled: false };
  try { return enabledSchema.parse({ ...value, ...(env.BUDG_REPORT_EMAIL_ENABLED === "true" ? { enabled: true } : {}) }); }
  catch { throw new Error("Vérifiez l’expéditeur, le destinataire et le mode d’envoi des rapports."); }
}

async function sendmailMessage(program: string, from: string, to: string, content: Buffer) {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(program, ["-i", "-f", from, to], { stdio: ["pipe", "ignore", "ignore"], shell: false });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Le service d’envoi local ne répond pas.")); }, 60_000);
    child.once("error", () => { clearTimeout(timer); reject(new Error("Le service d’envoi local est indisponible.")); });
    child.once("close", (code) => { clearTimeout(timer); code === 0 ? resolvePromise() : reject(new Error("Le service d’envoi local a refusé le rapport.")); });
    child.stdin.once("error", () => {
      clearTimeout(timer);
      child.kill("SIGKILL");
      reject(new Error("Le message complet n’a pas pu être transmis au service d’envoi."));
    });
    child.stdin.end(content);
  });
}

/** Only in-memory attachments are accepted; no URL or arbitrary file can be sent. */
export async function deliverReportMessage(settings: ReportEmailSettings, report: MonthlyReport, messageId: string) {
  if (!settings.enabled) throw new Error("L’envoi des rapports est désactivé.");
  if (!/^<[^\r\n<>]+@[^\r\n<>]+>$/.test(messageId)) throw new Error("Identifiant d’email invalide.");
  const message = {
    from: { name: "BUDG", address: settings.from },
    to: [{ address: settings.to }],
    messageId,
    subject: report.subject,
    text: report.text,
    html: report.html,
    attachments: report.attachments.map((attachment) => ({ ...attachment, contentDisposition: attachment.cid ? "inline" : "attachment" })),
    disableFileAccess: true,
    disableUrlAccess: true,
  };
  try {
    if (settings.transport === "sendmail") {
      const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
      const result = await transport.sendMail(message);
      if (!Buffer.isBuffer(result.message)) throw new Error("Message email invalide.");
      await sendmailMessage(settings.sendmailPath, settings.from, settings.to, result.message);
    } else {
      const smtp = settings.smtp!;
      const transport = nodemailer.createTransport({
        host: smtp.host, port: smtp.port, secure: smtp.port === 465, requireTLS: smtp.port === 587,
        auth: { user: smtp.user, pass: smtp.password },
        tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
        connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 60_000,
        disableFileAccess: true, disableUrlAccess: true,
      });
      try {
        const result = await transport.sendMail(message);
        if (!result.accepted.some((recipient) => String(recipient).toLowerCase() === settings.to.toLowerCase()) || result.rejected.length)
          throw new Error("Destinataire refusé.");
      } finally { transport.close(); }
    }
  } catch { throw new Error("Le rapport n’a pas pu être remis au service d’envoi."); }
}

export async function sendReportEmail(settings: ReportEmailSettings, snapshot: ServerSnapshot, event: ReportEvent, messageId: string) {
  await deliverReportMessage(settings, await renderMonthlyReport(snapshot, event), messageId);
}
