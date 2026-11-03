import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodemailer from "nodemailer";
import { deliverReportMessage, readReportEmailSettings } from "./reportMail";
import type { MonthlyReport } from "./monthlyReport";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "budg-mail-")); });
afterEach(async () => { vi.restoreAllMocks(); await rm(directory, { recursive: true, force: true }); });
const settings = () => ({ backupDir: join(directory, "backups"), distDir: join(directory, "public") });
const configuration = () => join(directory, "budg-report-email.json");
const enabled = { enabled: true, from: "budg@example.test", to: "recipient@example.test", transport: "sendmail" };
const report: MonthlyReport = {
  subject: "Bilan définitif — novembre 2026", text: "Résumé lisible : 200 € prévus.", html: "<p>Votre bilan</p>",
  attachments: [{ filename: "budget-2026-11.json", content: Buffer.from('{"version":5}'), contentType: "application/json" }],
};

describe("configuration privée et remise des emails", () => {
  it("reste désactivé sans configuration et accepte l’arrêt d’urgence", async () => {
    expect(readReportEmailSettings(settings(), {})).toEqual({ enabled: false });
    await writeFile(configuration(), JSON.stringify(enabled));
    expect(readReportEmailSettings(settings(), { BUDG_REPORT_EMAIL_ENABLED: "false" })).toEqual({ enabled: false });
  });
  it("charge un expéditeur et un destinataire uniques depuis le fichier privé", async () => {
    await writeFile(configuration(), JSON.stringify(enabled), { mode: 0o600 });
    expect(readReportEmailSettings(settings(), {})).toMatchObject({ ...enabled, sendmailPath: "/usr/sbin/sendmail" });
  });
  it("refuse une configuration publique, absente explicitement ou des adresses injectées", async () => {
    await mkdir(settings().distDir);
    const publicFile = join(settings().distDir, "mail.json");
    await writeFile(publicFile, JSON.stringify(enabled));
    expect(() => readReportEmailSettings(settings(), { BUDG_REPORT_EMAIL_CONFIG: publicFile })).toThrow("public");
    expect(() => readReportEmailSettings(settings(), { BUDG_REPORT_EMAIL_ENABLED: "true" })).toThrow("illisible");
    for (const value of [
      { ...enabled, to: "one@example.test,two@example.test" },
      { ...enabled, from: "budg@example.test\r\nBcc:other@example.test" },
      { ...enabled, transport: "smtp" },
      { ...enabled, transport: "smtp", smtp: { host: "smtp.example.test", port: 25, user: "sender", password: "private" } },
      { ...enabled, sendmailPath: "sendmail" },
    ]) {
      await writeFile(configuration(), JSON.stringify(value));
      expect(() => readReportEmailSettings(settings(), {})).toThrow("Vérifiez");
    }
  });
  it("construit un MIME exploitable et le remet uniquement au destinataire configuré", async () => {
    const program = join(directory, "capture-mail");
    const captured = join(directory, "captured.eml");
    const argumentsFile = join(directory, "arguments.json");
    await writeFile(program, `#!${process.execPath}\nconst fs=require('node:fs');const chunks=[];process.stdin.on('data',chunk=>chunks.push(chunk));process.stdin.on('end',()=>{fs.writeFileSync(${JSON.stringify(captured)},Buffer.concat(chunks),{mode:0o600});fs.writeFileSync(${JSON.stringify(argumentsFile)},JSON.stringify(process.argv.slice(2)),{mode:0o600});});\n`);
    await chmod(program, 0o700);
    await writeFile(configuration(), JSON.stringify({ ...enabled, sendmailPath: program }));
    await deliverReportMessage(readReportEmailSettings(settings(), {}), report, "<test-2026-11@budg.example.test>");
    const mime = await readFile(captured, "utf8");
    expect(mime).toContain("To: recipient@example.test");
    expect(mime).toContain("From: BUDG <budg@example.test>");
    expect(mime).toContain("Message-ID: <test-2026-11@budg.example.test>");
    expect(mime).toContain("application/json");
    expect(mime).toContain("budget-2026-11.json");
    expect(mime).toContain(Buffer.from('{"version":5}').toString("base64"));
    expect(JSON.parse(await readFile(argumentsFile, "utf8"))).toEqual(["-i", "-f", "budg@example.test", "recipient@example.test"]);
  });
  it("refuse un échec du service local sans exposer de données ou de secrets", async () => {
    const program = join(directory, "reject-mail");
    await writeFile(program, `#!${process.execPath}\nprocess.stderr.write('SECRET_FAILURE');process.exit(1);\n`);
    await chmod(program, 0o700);
    await writeFile(configuration(), JSON.stringify({ ...enabled, sendmailPath: program }));
    await expect(deliverReportMessage(readReportEmailSettings(settings(), {}), report, "<test@budg.example.test>")).rejects.toThrow("Le rapport n’a pas pu être remis");
    await expect(deliverReportMessage({ enabled: false }, report, "<test@budg.example.test>")).rejects.toThrow("désactivé");
  });
  it("impose TLS en SMTP et considère un refus comme un envoi échoué", async () => {
    const sendMail = vi.fn().mockResolvedValue({ accepted: ["recipient@example.test"], rejected: [] });
    const close = vi.fn();
    const create = vi.spyOn(nodemailer, "createTransport").mockReturnValue({ sendMail, close } as unknown as ReturnType<typeof nodemailer.createTransport>);
    await writeFile(configuration(), JSON.stringify({ ...enabled, transport: "smtp", smtp: { host: "smtp.example.test", port: 587, user: "sender", password: "private" } }));
    const config = readReportEmailSettings(settings(), {});
    await deliverReportMessage(config, report, "<test@budg.example.test>");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ port: 587, secure: false, requireTLS: true, tls: expect.objectContaining({ rejectUnauthorized: true }) }));
    sendMail.mockResolvedValueOnce({ accepted: [], rejected: ["recipient@example.test"] });
    await expect(deliverReportMessage(config, report, "<test@budg.example.test>")).rejects.toThrow("Le rapport n’a pas pu être remis");
    expect(close).toHaveBeenCalledTimes(2);
  });
  it("refuse un programme qui coupe le flux avant de recevoir les pièces jointes", async () => {
    const program = join(directory, "truncate-mail");
    await writeFile(program, `#!${process.execPath}\nprocess.exit(0);\n`);
    await chmod(program, 0o700);
    await writeFile(configuration(), JSON.stringify({ ...enabled, sendmailPath: program }));
    const oversized = { ...report, attachments: [{ filename: "backup.json", content: Buffer.alloc(2_000_000, "x"), contentType: "application/json" }] };
    await expect(deliverReportMessage(readReportEmailSettings(settings(), {}), oversized, "<test@budg.example.test>")).rejects.toThrow("Le rapport n’a pas pu être remis");
  });
});
