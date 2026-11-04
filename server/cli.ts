import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Pool } from "pg";
import { validateState } from "../src/domain";
import { readConfig, databaseConfig } from "./config";
import { hashPassword } from "./security";
import { saveBudget, type PublicUser } from "./storage";
import { runJobs, parseServerSnapshot, restoreDisasterSnapshot, flushMonthlyArchives } from "./jobs";
import migrationSql from "./migrations/001_online.sql";
import amountPlanMigrationSql from "./migrations/002_amount_plans.sql";
import emailReportMigrationSql from "./migrations/003_email_reports.sql";
import potTransferMigrationSql from "./migrations/004_pot_transfers.sql";
import billClosureMigrationSql from "./migrations/005_bill_closures.sql";
import { runReportEmails } from "./reportDelivery";
import { readReportEmailSettings, deliverReportMessage } from "./reportMail";
import { renderMonthlyReport } from "./monthlyReport";
import { monthSchema } from "../src/domain";
import type { ServerSnapshot } from "./jobs";

function argument(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}
async function readSecret(): Promise<string> {
  if (process.env.BUDG_USER_PASSWORD) {
    const password = process.env.BUDG_USER_PASSWORD;
    delete process.env.BUDG_USER_PASSWORD;
    return password;
  }
  if (process.stdin.isTTY)
    throw new Error("Fournissez BUDG_USER_PASSWORD dans un environnement protégé, ou le mot de passe par entrée standard redirigée.");
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const value of process.stdin) {
    const chunk = Buffer.from(value); bytes += chunk.length;
    if (bytes > 1026) throw new Error("Mot de passe trop long.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}
function emailArgument(args: string[]) {
  const email = argument(args, "email")?.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Indiquez une adresse valide avec --email.");
  return email;
}
export async function migrate(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [1112884296]);
    await client.query(migrationSql);
    await client.query(amountPlanMigrationSql);
    await client.query(emailReportMigrationSql);
    await client.query(potTransferMigrationSql);
    await client.query(billClosureMigrationSql);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

export async function runCli(args = process.argv.slice(2)) {
  const [command, ...options] = args;
  if (!command || command === "help" || command === "--help") {
    console.log(`BUDG administration
  migrate
  create-user --email EMAIL --name NOM --role editor|viewer
  password --email EMAIL
  jobs [--daily|--monthly]
  reports
  report-preview --month AAAA-MM --output DOSSIER_PRIVE
  report-test --month AAAA-MM
  restore FICHIER --email EDITEUR
  restore-disaster FICHIER
Les mots de passe sont lus depuis BUDG_USER_PASSWORD ou l’entrée standard, jamais depuis un argument.
restore conserve le journal existant et crée les traces des changements.
restore-disaster exige une base sans budget ni journal et restaure les traces originales.`);
    return;
  }
  if (options.includes("--password")) throw new Error("Ne transmettez jamais un mot de passe en argument.");
  const config = readConfig(), pool = new Pool(databaseConfig(config));
  async function publishAfterRestore() {
    try {
      const result = await flushMonthlyArchives(config, pool);
      if (result.pending > 0) console.error("Budget restauré ; une archive mensuelle sera publiée lors d’une prochaine tentative horaire.");
    } catch {
      console.error("Budget restauré et copie mensuelle conservée en base ; la publication sur disque sera réessayée automatiquement.");
    }
  }
  try {
    if (command === "migrate") {
      await migrate(pool); console.log("Migrations appliquées.");
    } else if (command === "create-user") {
      const email = emailArgument(options), displayName = argument(options, "name")?.trim();
      const role = argument(options, "role");
      if (!displayName || displayName.length > 60 || !["editor", "viewer"].includes(role || ""))
        throw new Error("Indiquez --name (1–60 caractères) et --role editor|viewer.");
      const passwordHash = await hashPassword(await readSecret());
      await pool.query(
        "INSERT INTO budg_users(id,email,display_name,role,password_hash) VALUES ($1,$2,$3,$4,$5)",
        [randomUUID(), email, displayName, role, passwordHash],
      );
      console.log("Compte créé. Un seul compte est autorisé pour chaque rôle.");
    } else if (command === "password") {
      const email = emailArgument(options), passwordHash = await hashPassword(await readSecret());
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          "UPDATE budg_users SET password_hash=$1,updated_at=now() WHERE email=$2 RETURNING id", [passwordHash, email],
        );
        if (!result.rows[0]) throw new Error("Compte introuvable.");
        await client.query("DELETE FROM budg_sessions WHERE user_id=$1", [result.rows[0].id]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
      finally { client.release(); }
      console.log("Mot de passe modifié ; les sessions de ce compte ont été fermées.");
    } else if (command === "jobs") {
      if (options.includes("--daily") && options.includes("--monthly")) throw new Error("Choisissez une seule fréquence.");
      const mode = options.includes("--monthly") ? "monthly" : options.includes("--daily") ? "daily" : "scheduled";
      let backupFailed = false, emailFailed = false;
      try {
        const result = await runJobs(config, pool, { mode });
        console.log(JSON.stringify(result));
        for (const warning of result.warnings || []) console.error(warning);
      } catch {
        backupFailed = true;
        console.error("La sauvegarde sur disque a échoué. Les rapports email seront traités séparément.");
      }
      try {
        const result = await runReportEmails(config, pool);
        console.log(JSON.stringify({ reports: result }));
        if (result.failed.length) console.error("Un rapport email reste en attente ; une nouvelle tentative est programmée.");
      } catch {
        emailFailed = true;
        console.error("Les rapports email n’ont pas pu être traités ; la prochaine tâche horaire réessaiera.");
      }
      if (backupFailed || emailFailed) throw new Error("Une tâche BUDG nécessite une vérification ; les données financières sont conservées.");
    } else if (command === "reports") {
      const result = await runReportEmails(config, pool);
      console.log(JSON.stringify(result));
      if (result.failed.length) throw new Error("Un rapport email reste en attente ; une nouvelle tentative est programmée.");
    } else if (command === "report-preview" || command === "report-test") {
      const month = monthSchema.parse(argument(options, "month"));
      const client = await pool.connect();
      let snapshot: ServerSnapshot;
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [1112884295]);
        const state = validateState((await client.query("SELECT data FROM budg_state WHERE id=1")).rows[0]?.data);
        const audit = (await client.query("SELECT * FROM budg_audit ORDER BY id")).rows;
        snapshot = parseServerSnapshot({ format: "BUDG_SERVER_BACKUP", version: 1, kind: "monthly", month, createdAt: new Date().toISOString(), timeZone: config.timeZone, state, audit });
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
      finally { client.release(); }
      const report = await renderMonthlyReport(snapshot, "monthly");
      if (command === "report-preview") {
        const directory = resolve(argument(options, "output") || join(config.backupDir, "report-preview", month));
        const publicRoot = resolve(config.distDir);
        if (directory === publicRoot || directory.startsWith(publicRoot + "/")) throw new Error("Le rapport doit rester dans un dossier privé.");
        await mkdir(directory, { recursive: true, mode: 0o700 });
        let previewHtml = report.html;
        for (const attachment of report.attachments) if (attachment.cid) previewHtml = previewHtml.replaceAll(`cid:${attachment.cid}`, attachment.filename);
        await writeFile(join(directory, "email.html"), previewHtml, { mode: 0o600 });
        for (const attachment of report.attachments) await writeFile(join(directory, attachment.filename), attachment.content, { mode: 0o600 });
        console.log("Aperçu et sauvegardes créés dans le dossier privé demandé. Aucun email envoyé.");
      } else {
        const settings = readReportEmailSettings(config);
        await deliverReportMessage(settings, { ...report, subject: "[TEST] " + report.subject }, `<budg-report-test-${randomUUID()}@${new URL(config.appOrigin).hostname}>`);
        console.log("Email de test remis au service d’envoi. Vérifiez sa réception et les pièces jointes.");
      }
    } else if (command === "restore-disaster") {
      const filename = options[0];
      if (!filename || filename.startsWith("--")) throw new Error("Indiquez le fichier de sauvegarde serveur.");
      const raw = JSON.parse(await readFile(filename, "utf8"));
      console.log(JSON.stringify(await restoreDisasterSnapshot(pool, raw)));
      await publishAfterRestore();
    } else if (command === "restore") {
      const filename = options[0], email = emailArgument(options);
      if (!filename || filename.startsWith("--")) throw new Error("Indiquez le fichier de sauvegarde.");
      const raw = JSON.parse(await readFile(filename, "utf8"));
      const state = raw?.format === "BUDG_SERVER_BACKUP" ? parseServerSnapshot(raw).state : validateState(raw);
      const userResult = await pool.query(
        `SELECT id,email,display_name AS "displayName",role FROM budg_users WHERE email=$1 AND enabled=true AND role='editor'`, [email],
      );
      if (!userResult.rows[0]) throw new Error("L’auteur de la restauration doit être le compte éditeur actif.");
      const current = await pool.query("SELECT revision FROM budg_state WHERE id=1");
      const expectedRevision = Number(current.rows[0]?.revision || 0);
      const restored = await saveBudget(pool, state, expectedRevision, userResult.rows[0] as PublicUser, { timeZone: config.timeZone, allowHistoryRewrite: true });
      console.log(`Budget restauré, révision ${restored.revision}. Journal conservé.`);
      await publishAfterRestore();
    } else throw new Error("Commande inconnue. Utilisez --help.");
  } finally { await pool.end(); }
}
if (typeof require !== "undefined" && require.main === module)
  void runCli().catch((error: unknown) => {
    // DB errors may contain connection details or user input: never print them raw.
    if (error instanceof Error && !("code" in error)) console.error(error.message);
    else console.error("Commande impossible. Vérifiez la base, les migrations, les rôles et l’unicité des comptes.");
    process.exitCode = 1;
  });
