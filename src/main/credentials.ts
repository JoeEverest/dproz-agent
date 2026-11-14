import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { CredentialInput, CredentialSummary } from "@shared/ipc";
import { app, safeStorage } from "electron";
import { writeFileAtomic } from "./files";

type StoredCredential = CredentialInput & { updatedAt: string };

const vaultFile = () => path.join(app.getPath("userData"), "credentials.vault");

export function normalizeSite(site: string) {
	const trimmed = site.trim().toLowerCase();
	try {
		return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname.replace(/^www\./, "");
	} catch {
		return trimmed;
	}
}

export function storageBackend() {
	const backend = process.platform === "linux" ? safeStorage.getSelectedStorageBackend() : process.platform;
	const encrypted = safeStorage.isEncryptionAvailable() && backend !== "basic_text";
	return { encrypted, backend };
}

const keyFile = () => path.join(app.getPath("userData"), "vault.key");

async function localKey() {
	try {
		return await fs.readFile(keyFile());
	} catch {
		const key = randomBytes(32);
		await fs.writeFile(keyFile(), key, { mode: 0o600 });
		return key;
	}
}

export async function seal(text: string): Promise<Buffer> {
	if (safeStorage.isEncryptionAvailable()) return Buffer.concat([Buffer.from("K"), safeStorage.encryptString(text)]);
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", await localKey(), iv);
	const body = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
	return Buffer.concat([Buffer.from("L"), iv, cipher.getAuthTag(), body]);
}

export async function unseal(sealed: Buffer): Promise<string> {
	if (sealed[0] === 0x4b) return safeStorage.decryptString(sealed.subarray(1));
	const decipher = createDecipheriv("aes-256-gcm", await localKey(), sealed.subarray(1, 13));
	decipher.setAuthTag(sealed.subarray(13, 29));
	return Buffer.concat([decipher.update(sealed.subarray(29)), decipher.final()]).toString("utf8");
}

async function readVault(): Promise<StoredCredential[]> {
	try {
		return JSON.parse(await unseal(await fs.readFile(vaultFile())));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw new Error(`The saved logins could not be opened: ${(error as Error).message}`);
	}
}

async function writeVault(credentials: StoredCredential[]) {
	await writeFileAtomic(vaultFile(), await seal(JSON.stringify(credentials)));
}

const summarize = ({ site, username, notes, updatedAt }: StoredCredential): CredentialSummary => ({
	site,
	username,
	notes,
	updatedAt,
});

export async function listCredentials(): Promise<CredentialSummary[]> {
	return (await readVault()).map(summarize).sort((a, b) => a.site.localeCompare(b.site));
}

function matchesSite(stored: string, requested: string) {
	return stored === requested || requested.endsWith(`.${stored}`) || stored.endsWith(`.${requested}`);
}

export async function findCredential(site: string): Promise<StoredCredential | null> {
	const requested = normalizeSite(site);
	const credentials = await readVault();
	return (
		credentials.find((credential) => credential.site === requested) ??
		credentials.find((credential) => matchesSite(credential.site, requested)) ??
		null
	);
}

export async function saveCredential(input: CredentialInput): Promise<CredentialSummary[]> {
	const site = normalizeSite(input.site);
	const others = (await readVault()).filter((credential) => credential.site !== site);
	await writeVault([...others, { ...input, site, updatedAt: new Date().toISOString() }]);
	return listCredentials();
}

export async function removeCredential(site: string): Promise<CredentialSummary[]> {
	const normalized = normalizeSite(site);
	await writeVault((await readVault()).filter((credential) => credential.site !== normalized));
	return listCredentials();
}
