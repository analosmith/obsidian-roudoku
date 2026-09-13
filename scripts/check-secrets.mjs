import { readdir, readFile } from "node:fs/promises";
const forbidden = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /AIza[A-Za-z0-9_-]{35}/,
  /['"][a-f0-9]{32}['"]/,
];
async function scan(dir) {
  let failures = 0;
  for (const file of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${file.name}`;
    if (file.isDirectory()) {
      failures += await scan(path);
      continue;
    }
    if (!/\.(ts|js)$/.test(path)) continue;
    const source = await readFile(path, "utf8");
    if (forbidden.some((pattern) => pattern.test(source))) {
      console.error(`Potential credential in ${path}; value withheld.`);
      failures++;
    }
  }
  return failures;
}
if (await scan("src")) process.exitCode = 1;
else console.log("No credential-shaped literals found in src.");
