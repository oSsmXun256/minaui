import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
await mkdir(dist, { recursive: true });
await copyFile(resolve(root, "minaui.css"), resolve(dist, "minaui.css"));
await copyFile(resolve(root, "minaui.js"), resolve(dist, "minaui.js"));
await copyFile(resolve(root, "minaui-aqua-compat.css"), resolve(dist, "minaui-aqua-compat.css"));
await copyFile(resolve(root, "minaui.glass.js"), resolve(dist, "minaui.glass.js"));
await mkdir(resolve(dist, "legacy"), { recursive: true });
await copyFile(resolve(root, "legacy", "minaui.glass.v2.js"), resolve(dist, "legacy", "minaui.glass.v2.js"));
console.log("MinaUI build complete: dist/minaui.css, dist/minaui.js, dist/minaui-aqua-compat.css, dist/minaui.glass.js, dist/legacy/minaui.glass.v2.js");
