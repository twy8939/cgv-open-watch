import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function mergeRunReport(values, reportPath = process.env.CGV_WATCH_REPORT) {
  if (!reportPath) return;

  let previous = {};
  try {
    previous = JSON.parse(await readFile(reportPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  await mkdir(dirname(reportPath), { recursive: true });
  const temporaryPath = `${reportPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify({ ...previous, ...values }, null, 2)}\n`, "utf8");
  await rename(temporaryPath, reportPath);
}
