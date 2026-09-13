import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const { version } = JSON.parse(await readFile("manifest.json", "utf8"));
await mkdir("dist/roudoku", { recursive: true });
const hashes = {};
for (const name of ["main.js", "manifest.json", "styles.css"]) {
  await copyFile(name, `dist/roudoku/${name}`);
  hashes[name] = createHash("sha256")
    .update(await readFile(name))
    .digest("hex");
}
await writeFile("dist/SHA256.json", JSON.stringify(hashes, null, 2) + "\n");
execFileSync(
  "/usr/bin/zip",
  ["-q", "-r", `roudoku-${version}.zip`, "roudoku"],
  { cwd: "dist" },
);
console.log(`Created dist/roudoku-${version}.zip`);
