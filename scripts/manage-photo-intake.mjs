#!/usr/bin/env node
// Local file organisation only. No network, generation or website writes.
import { copyFile, lstat, mkdir, open, readFile, readdir, realpath, rmdir, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FOLDERS = ["0INPUT", "1PROCESSING", "2PROCESSED", "3NEEDS-INFO"];
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/u;
const SHA256 = /^[a-f\d]{64}$/u;
const IMAGE = /\.(?:jpe?g|png|webp|heic|heif|tiff?|avif)$/iu;
const args = process.argv.slice(2);
const takeFlag = (name) => {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
};
const takeValue = (name) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value.`);
  args.splice(index, 2);
  return value;
};
const dryRun = takeFlag("--dry-run");
const rootArgument = takeValue("--root");
const root = await realpath(resolve(rootArgument ?? join(dirname(fileURLToPath(import.meta.url)), "..")));
const journalRoot = join(root, "1PROCESSING", ".journals");
const now = () => new Date().toISOString();

async function info(path) {
  try { return await lstat(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
function safeRelative(value) {
  if (typeof value !== "string" || !value || value.includes("\\") || value.includes("\0") || value.startsWith("/") || value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Use relative paths without traversal or empty path segments.");
  }
  return value;
}
async function safePath(value) {
  const parts = safeRelative(value).split("/");
  let path = root;
  for (let index = 0; index < parts.length; index++) {
    path = join(path, parts[index]);
    const entry = await info(path);
    if (entry?.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${value}`);
    if (entry && index < parts.length - 1 && !entry.isDirectory()) throw new Error(`A parent is not a directory: ${value}`);
  }
  return path;
}
async function directory(value, create = false) {
  const path = await safePath(value);
  const entry = await info(path);
  if (!entry && create) await mkdir(path, { mode: 0o700 });
  else if (!entry?.isDirectory()) throw new Error(`Missing intake directory: ${value}. Run init first.`);
  return path;
}
async function hashFile(value) {
  const path = await safePath(value);
  const entry = await info(path);
  if (!entry?.isFile()) throw new Error(`Expected a regular file: ${value}`);
  // O_NOFOLLOW closes the final-component symlink race on supported platforms.
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error(`Expected a regular file: ${value}`);
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error(`File changed while reading: ${value}`);
    return { sha256: hash.digest("hex"), bytes: after.size };
  } finally { await handle.close(); }
}
async function json(value) { return JSON.parse(await readFile(await safePath(value), "utf8")); }
async function writeNew(value, data) {
  const path = await safePath(value);
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}
async function flushFile(value) {
  const handle = await open(await safePath(value), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { await handle.sync(); } finally { await handle.close(); }
}
async function event(path, value) {
  // Flush journal events before the next mutation so interruption is recoverable.
  const handle = await open(path, constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0));
  try { await handle.writeFile(`\n${JSON.stringify({ at: now(), ...value })}\n`); await handle.sync(); }
  finally { await handle.close(); }
}
async function readJournal(value) {
  const lines = (await readFile(await safePath(value), "utf8")).trim().split("\n");
  const plan = JSON.parse(lines[0]);
  let lastEvent;
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    // An interrupted append may leave a partial event. The flushed plan and
    // actual file hashes remain sufficient to recover without editing the log.
    try { lastEvent = JSON.parse(line); } catch { lastEvent = undefined; }
  }
  return { plan, complete: lastEvent?.event === "complete" && lastEvent.destination === plan.destination };
}
function validId(id) { if (!UUID.test(id ?? "")) throw new Error("Use a canonical lowercase UUID for --id."); return id; }
function validSlug(slug) { if (!/^[a-z\d]+(?:-[a-z\d]+)*$/u.test(slug ?? "") || slug.length > 70) throw new Error("Use a short lowercase hyphenated --slug."); return slug; }
async function locate(id) {
  const matches = [];
  for (const folder of FOLDERS.slice(1)) {
    for (const entry of await readdir(await directory(folder), { withFileTypes: true })) {
      if (entry.name.startsWith(`${id}-`)) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`Unsafe garment folder: ${entry.name}`);
        matches.push(`${folder}/${entry.name}`);
      }
    }
  }
  if (matches.length !== 1) throw new Error(matches.length ? "This UUID occurs in several folders; inspect its journals before continuing." : "No garment folder has that UUID.");
  return matches[0];
}
async function walk(value) {
  const files = [];
  for (const entry of await readdir(await directory(value), { withFileTypes: true })) {
    const next = `${value}/${entry.name}`;
    safeRelative(next);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed: ${next}`);
    if (entry.isDirectory()) files.push(...await walk(next));
    else if (entry.isFile()) files.push(next);
    else throw new Error(`Unsupported file type: ${next}`);
  }
  return files.sort();
}
async function removeEmpty(value) {
  const path = await safePath(value);
  if (!(await info(path))) return;
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.isSymbolicLink()) await removeEmpty(`${value}/${entry.name}`);
  }
  // A changed/new file blocks cleanup; never recursively delete files.
  await rmdir(path);
}
async function makeParents(value, boundary) {
  const parts = safeRelative(value).split("/");
  for (let count = boundary.split("/").length; count < parts.length; count++) {
    await directory(parts.slice(0, count).join("/"), true);
  }
}
function validatePlan(plan) {
  if (!plan || plan.version !== 1 || !["stage", "finish", "needs-info", "resume"].includes(plan.kind) || !Array.isArray(plan.files) || !plan.files.length) throw new Error("Invalid operation journal.");
  validId(plan.id);
  const folderName = `${plan.id}-${validSlug(plan.slug)}`;
  const expectedSource = plan.kind === "stage" ? "0INPUT" : `${plan.kind === "resume" ? "3NEEDS-INFO" : "1PROCESSING"}/${folderName}`;
  const expectedDestination = `${plan.kind === "finish" ? "2PROCESSED" : plan.kind === "needs-info" ? "3NEEDS-INFO" : "1PROCESSING"}/${folderName}`;
  if (plan.source !== expectedSource || plan.destination !== expectedDestination) throw new Error("Journal paths do not match the operation.");
  const destinations = new Set();
  for (const file of plan.files) {
    safeRelative(file.source); safeRelative(file.destination);
    if (!file.source.startsWith(`${plan.source}/`) || !file.destination.startsWith(`${plan.destination}/`) || !SHA256.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || destinations.has(file.destination)) throw new Error("Invalid file in operation journal.");
    if (plan.kind === "stage" && (file.source.split("/").length !== 2 || file.destination !== `${plan.destination}/originals/${file.source.split("/")[1]}`)) throw new Error("Invalid staging path in journal.");
    if (plan.kind !== "stage" && file.destination.slice(plan.destination.length) !== file.source.slice(plan.source.length)) throw new Error("Archive paths must preserve the full garment folder.");
    destinations.add(file.destination);
  }
}
async function runPlan(plan, journal) {
  validatePlan(plan);
  await directory(plan.destination);
  for (const child of ["originals", "working", "references", "generated"]) await directory(`${plan.destination}/${child}`, true);
  for (const file of plan.files) {
    const sourcePath = await safePath(file.source);
    const destinationPath = await safePath(file.destination);
    const sourceExists = await info(sourcePath);
    const destinationExists = await info(destinationPath);
    if (sourceExists && (await hashFile(file.source)).sha256 !== file.sha256) throw new Error(`Source changed; kept both copies: ${file.source}`);
    if (destinationExists && (await hashFile(file.destination)).sha256 !== file.sha256) throw new Error(`Destination differs; nothing overwritten: ${file.destination}`);
    if (!sourceExists && !destinationExists) throw new Error(`Both copies are missing: ${file.source}`);
    if (!destinationExists) {
      await makeParents(file.destination, plan.destination);
      await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL);
      // A partial exclusive copy is retained for inspection if verification fails.
      if ((await hashFile(file.destination)).sha256 !== file.sha256) throw new Error(`Copied file failed verification: ${file.destination}`);
    }
    await flushFile(file.destination);
    await event(journal, { event: "copy-verified", source: file.source, destination: file.destination, sha256: file.sha256 });
    if (sourceExists) {
      if ((await hashFile(file.source)).sha256 !== file.sha256) throw new Error(`Source changed before removal: ${file.source}`);
      await unlink(await safePath(file.source));
    }
    await event(journal, { event: "moved", source: file.source, destination: file.destination, sha256: file.sha256 });
  }
  if (plan.kind !== "stage") await removeEmpty(plan.source);
  await event(journal, { event: "complete", destination: plan.destination });
  console.log(`${plan.kind} complete: ${plan.destination}`);
}
async function startPlan(plan) {
  validatePlan(plan);
  const journal = join(journalRoot, `${now().replace(/[:.]/gu, "-")}-${plan.kind}-${plan.id}-${randomUUID()}.jsonl`);
  const handle = await open(journal, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify({ at: now(), ...plan })}\n`); await handle.sync(); } finally { await handle.close(); }
  console.log(`Recovery journal: ${relative(root, journal)}`);
  await runPlan(plan, journal);
}
async function stage() {
  const id = validId(takeValue("--id"));
  const slug = validSlug(takeValue("--slug"));
  if (args.shift() !== "--files" || !args.length) throw new Error("stage needs --files followed by plain input filenames.");
  const names = [...new Set(args.splice(0))];
  if (names.some((name) => name.includes("/") || name.includes("\\") || name.startsWith(".") || !IMAGE.test(name))) throw new Error("Use plain visible image filenames directly inside 0INPUT.");
  for (const folder of FOLDERS.slice(1)) {
    if ((await readdir(await directory(folder))).some((name) => name.startsWith(`${id}-`))) throw new Error("That UUID is already organised. Reuse its existing folder.");
  }
  const destination = `1PROCESSING/${id}-${slug}`;
  const files = [];
  for (const name of names) files.push({ source: `0INPUT/${name}`, destination: `${destination}/originals/${name}`, ...await hashFile(`0INPUT/${name}`) });
  if (dryRun) return console.log(JSON.stringify({ dryRun: true, kind: "stage", id, destination, files }, null, 2));
  await mkdir(await safePath(destination), { mode: 0o700 }); // Exclusive: never adopt an existing garment directory.
  for (const child of ["originals", "working", "references", "generated"]) await directory(`${destination}/${child}`, true);
  await writeNew(`${destination}/manifest.json`, {
    version: 1, id, slug, createdAt: now(),
    originals: files.map((file) => ({ path: `originals/${file.source.split("/")[1]}`, sha256: file.sha256, bytes: file.bytes, role: "unassigned" })),
    analysis: { complete: false, completedAt: null, notes: "" },
    reference: { status: "pending", checkedAt: null, urls: [], notes: "" },
    generation: { finalized: false, path: null, sha256: null, provider: null, model: null, createdAt: null, visualQA: { passed: false, checkedAt: null, notes: "" } },
    sync: { verified: false, itemId: id, verifiedAt: null, evidence: "" },
  });
  await startPlan({ version: 1, kind: "stage", id, slug, source: "0INPUT", destination, files });
}
function evidenceDate(value, description) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/u.test(value) || !Number.isFinite(Date.parse(value)) || Date.parse(value) > Date.now() + 300_000) throw new Error(`${description} needs a real ISO timestamp.`);
}
function nonempty(value, description) { if (typeof value !== "string" || !value.trim()) throw new Error(`${description} needs a written record.`); }
async function validateFinished(value, id) {
  const manifest = await json(`${value}/manifest.json`);
  if (manifest.version !== 1 || manifest.id !== id) throw new Error("Manifest identity does not match this garment.");
  if (manifest.analysis?.complete !== true) throw new Error("Analysis is not complete.");
  evidenceDate(manifest.analysis.completedAt, "Analysis"); nonempty(manifest.analysis.notes, "Analysis");
  if (!["checked", "uncertain"].includes(manifest.reference?.status)) throw new Error("Record the online reference check as checked or uncertain.");
  evidenceDate(manifest.reference.checkedAt, "Reference check"); nonempty(manifest.reference.notes, "Reference check");
  if (!Array.isArray(manifest.reference.urls)) throw new Error("Reference URLs must be an array.");
  for (const url of manifest.reference.urls) {
    const parsed = typeof url === "string" ? new URL(url) : null;
    if (!parsed || parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Reference URLs must use HTTPS without credentials.");
  }
  if (manifest.reference.status === "checked" && !manifest.reference.urls.length) throw new Error("A checked online reference needs its source URL; use uncertain when no match is verified.");
  const generated = manifest.generation;
  if (generated?.finalized !== true || generated.visualQA?.passed !== true) throw new Error("The AI catalogue image must be finalized and pass visual QA.");
  if (!safeRelative(generated.path).startsWith("generated/") || !IMAGE.test(generated.path) || !SHA256.test(generated.sha256)) throw new Error("Record the final image under generated/ with its SHA-256.");
  evidenceDate(generated.createdAt, "Image generation"); evidenceDate(generated.visualQA.checkedAt, "Visual QA");
  nonempty(generated.provider, "Image provider"); nonempty(generated.model, "Image model"); nonempty(generated.visualQA.notes, "Visual QA proportions and crop check");
  if ((await hashFile(`${value}/${generated.path}`)).sha256 !== generated.sha256) throw new Error("The finalized studio image no longer matches its manifest hash.");
  if (!Array.isArray(manifest.originals) || !manifest.originals.length) throw new Error("Manifest must retain the original photo hashes.");
  for (const original of manifest.originals) {
    if (!safeRelative(original.path).startsWith("originals/") || !SHA256.test(original.sha256)) throw new Error("Invalid original photo record.");
    if ((await hashFile(`${value}/${original.path}`)).sha256 !== original.sha256) throw new Error(`An original changed: ${original.path}`);
  }
  if (manifest.sync?.verified !== true || manifest.sync.itemId !== id) throw new Error("Verify the synced closet item with this stable UUID before finishing.");
  evidenceDate(manifest.sync.verifiedAt, "Sync verification"); nonempty(manifest.sync.evidence, "Sync verification evidence");
  if (Date.parse(manifest.sync.verifiedAt) < Date.parse(generated.createdAt) || Date.parse(generated.visualQA.checkedAt) < Date.parse(generated.createdAt)) throw new Error("Visual QA and sync verification must follow the final image generation.");
  return manifest;
}
async function archive(kind) {
  const id = validId(takeValue("--id"));
  const reason = kind === "needs-info" ? takeValue("--reason") : undefined;
  if (args.length) throw new Error("Unexpected arguments.");
  const source = await locate(id);
  const sourceFolder = kind === "resume" ? "3NEEDS-INFO" : "1PROCESSING";
  if (!source.startsWith(`${sourceFolder}/`)) throw new Error(`This operation needs a garment in ${sourceFolder}.`);
  const slug = source.slice(`${sourceFolder}/${id}-`.length);
  if (kind === "finish") await validateFinished(source, id);
  else if (kind === "needs-info") nonempty(reason, "Needs-info reason");
  const destination = `${kind === "finish" ? "2PROCESSED" : kind === "resume" ? "1PROCESSING" : "3NEEDS-INFO"}/${id}-${slug}`;
  if (await info(await safePath(destination))) throw new Error("Destination already exists; nothing overwritten.");
  const files = [];
  for (const file of await walk(source)) files.push({ source: file, destination: `${destination}${file.slice(source.length)}`, ...await hashFile(file) });
  if (dryRun) return console.log(JSON.stringify({ dryRun: true, kind, id, destination, files }, null, 2));
  if (kind === "needs-info") {
    await writeNew(`${source}/needs-info-${randomUUID()}.json`, { recordedAt: now(), reason });
    const last = (await walk(source)).find((file) => !files.some((entry) => entry.source === file));
    files.push({ source: last, destination: `${destination}${last.slice(source.length)}`, ...await hashFile(last) });
  }
  await mkdir(await safePath(destination), { mode: 0o700 });
  await startPlan({ version: 1, kind, id, slug, source, destination, files });
}
async function status() {
  const result = {};
  for (const folder of FOLDERS) {
    const path = await safePath(folder);
    if (!(await info(path))) { result[folder] = { missing: true }; continue; }
    result[folder] = (await readdir(await directory(folder), { withFileTypes: true })).filter((entry) => entry.name !== ".journals").map((entry) => ({ name: entry.name, kind: entry.isSymbolicLink() ? "unsafe-symlink" : entry.isDirectory() ? "garment-folder" : entry.isFile() ? "file" : "unsupported" }));
  }
  result.incompleteJournals = [];
  if (await info(journalRoot)) {
    for (const name of await readdir(await directory("1PROCESSING/.journals"))) {
      if (!name.endsWith(".jsonl")) continue;
      try { if (!(await readJournal(`1PROCESSING/.journals/${name}`)).complete) result.incompleteJournals.push(name); }
      catch { result.incompleteJournals.push(name); }
    }
  }
  console.log(JSON.stringify(result, null, 2));
}
async function recover() {
  const name = takeValue("--journal");
  if (!name || name.includes("/") || name.includes("\\") || !name.endsWith(".jsonl") || args.length) throw new Error("recover needs --journal followed by its plain .jsonl filename.");
  const journal = await safePath(`1PROCESSING/.journals/${name}`);
  const { plan, complete } = await readJournal(`1PROCESSING/.journals/${name}`);
  if (complete) return console.log("This operation is already complete.");
  validatePlan(plan);
  if (dryRun) return console.log(JSON.stringify({ dryRun: true, ...plan }, null, 2));
  await runPlan(plan, journal);
}
async function main() {
  const command = args.shift();
  if (command === "init") {
    if (args.length) throw new Error("Unexpected arguments.");
    if (dryRun) return console.log(`Would create ${FOLDERS.join(", ")} and 1PROCESSING/.journals under ${root}`);
    for (const folder of FOLDERS) await directory(folder, true);
    await directory("1PROCESSING/.journals", true);
    console.log(`Intake folders ready under ${root}`);
  } else if (command === "status") { if (args.length) throw new Error("Unexpected arguments."); await status(); }
  else if (command === "stage") await stage();
  else if (command === "finish") await archive("finish");
  else if (["hold", "needs-info"].includes(command)) await archive("needs-info");
  else if (command === "resume") await archive("resume");
  else if (command === "recover") await recover();
  else throw new Error("Usage: manage-photo-intake.mjs init|status|stage --id UUID --slug slug --files filenames...|finish --id UUID|hold --id UUID --reason text|resume --id UUID|recover --journal filename.jsonl [--dry-run] [--root directory]");
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
