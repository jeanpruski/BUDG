import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const scryptOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const dummyHash = `scrypt$32768$8$1$${Buffer.alloc(16).toString("base64url")}$${Buffer.alloc(64).toString("base64url")}`;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, scryptOptions, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || Buffer.byteLength(password) > 1024)
    throw new Error("Le mot de passe doit contenir au moins 12 caractères (1024 octets maximum).");
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$32768$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`;
}
export async function verifyPassword(password: string, encoded?: string): Promise<boolean> {
  const parts = (encoded || dummyHash).split("$");
  const valid = parts.length === 6 && parts.slice(0, 4).join("$") === "scrypt$32768$8$1";
  const source = valid ? parts : dummyHash.split("$");
  const salt = Buffer.from(source[4], "base64url");
  const expected = Buffer.from(source[5], "base64url");
  const actual = await derive(password, salt.length === 16 ? salt : Buffer.alloc(16));
  return !!encoded && valid && expected.length === actual.length && timingSafeEqual(actual, expected);
}
export const secretToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
