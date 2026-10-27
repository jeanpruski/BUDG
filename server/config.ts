import { resolve, relative, isAbsolute, sep } from "node:path";
import type { PoolConfig } from "pg";

export type ServerConfig = {
  production: boolean;
  appOrigin: string;
  databaseUrl: string;
  databaseSsl: boolean;
  port: number | string;
  host: string;
  distDir: string;
  sessionTtlDays: number;
  trustProxy: number | false;
  backupDir: string;
  timeZone: string;
};

export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const production = env.NODE_ENV === "production";
  if (production && !env.APP_ORIGIN)
    throw new Error("APP_ORIGIN est obligatoire en production.");
  const origin = new URL(env.APP_ORIGIN || "http://127.0.0.1:3000");
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.username || origin.password || origin.pathname !== "/" ||
    origin.search || origin.hash || (production && origin.protocol !== "https:")
  ) throw new Error("APP_ORIGIN doit être une origine HTTP(S), HTTPS en production.");
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL est obligatoire.");
  const database = new URL(env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(database.protocol))
    throw new Error("DATABASE_URL doit désigner une base PostgreSQL.");
  const databaseSsl = env.DATABASE_SSL === "true";
  if (databaseSsl && ["sslmode", "sslcert", "sslkey", "sslrootcert", "ssl"].some((key) => database.searchParams.has(key)))
    throw new Error("Avec DATABASE_SSL=true, retirez les paramètres ssl de DATABASE_URL afin de conserver la vérification des certificats.");
  const rawPort = env.PORT || "3000";
  let port: number | string = rawPort;
  if (/^\d+$/.test(rawPort)) {
    port = Number(rawPort);
    if (port < 1 || port > 65535) throw new Error("PORT invalide.");
  } else if (rawPort !== "passenger" && !rawPort.startsWith("/")) {
    throw new Error("PORT doit être un port, un socket ou passenger.");
  }
  const ttl = Number(env.SESSION_TTL_DAYS || "14");
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 90)
    throw new Error("SESSION_TTL_DAYS doit être compris entre 1 et 90.");
  const proxy = Number(env.TRUST_PROXY || "0");
  if (!Number.isInteger(proxy) || proxy < 0 || proxy > 5)
    throw new Error("TRUST_PROXY doit être un nombre de relais entre 0 et 5.");
  if (production && !env.BUDG_BACKUP_DIR)
    throw new Error("BUDG_BACKUP_DIR est obligatoire en production.");
  if (production && !isAbsolute(env.BUDG_BACKUP_DIR!))
    throw new Error("BUDG_BACKUP_DIR doit être un chemin absolu en production.");
  const distDir = resolve(env.BUDG_DIST_DIR || "dist");
  const backupDir = resolve(env.BUDG_BACKUP_DIR || "backups/server");
  const backupRelative = relative(distDir, backupDir);
  if (backupRelative !== ".." && !backupRelative.startsWith(`..${sep}`) && !isAbsolute(backupRelative))
    throw new Error("Le dossier des sauvegardes doit rester hors du dossier public dist.");
  const timeZone = env.BUDG_TIME_ZONE || "Europe/Paris";
  new Intl.DateTimeFormat("fr-FR", { timeZone });
  return {
    production, appOrigin: origin.origin, databaseUrl: env.DATABASE_URL,
    databaseSsl, port,
    host: env.HOST || "127.0.0.1", distDir,
    sessionTtlDays: ttl, trustProxy: proxy || false, backupDir, timeZone,
  };
}

export function databaseConfig(config: ServerConfig): PoolConfig {
  return {
    connectionString: config.databaseUrl,
    ...(config.databaseSsl ? { ssl: { rejectUnauthorized: true } } : {}),
    max: 10, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
  };
}
