import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { collectCgvCatalog } from "./cgv.js";

const outputPath = process.env.CGV_CATALOG_PATH
  ?? resolve(import.meta.dirname, "../config/catalog.json");

try {
  const catalog = await collectCgvCatalog();
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  console.log(`CGV 카탈로그 저장: 영화 ${catalog.movies.length}개, 극장 ${catalog.theatres.length}개`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
