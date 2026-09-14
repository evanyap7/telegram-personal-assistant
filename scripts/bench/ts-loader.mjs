// Minimal ESM loader hook: fixes Node's inability to resolve extensionless
// relative TypeScript imports (e.g. `from "./security"`), without installing
// any new npm package. Node's built-in `--experimental-strip-types` handling
// still does the actual TS-stripping; this hook only widens *resolution* of
// bare relative specifiers that have no file extension.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const CANDIDATE_EXTS = [".ts", ".tsx", ".mts", ".js", ".mjs"];

export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  const hasExt = path.extname(specifier) !== "";

  if (isRelative && !hasExt && context.parentURL) {
    const parentPath = fileURLToPath(context.parentURL);
    const baseDir = path.dirname(parentPath);
    const basePath = path.resolve(baseDir, specifier);

    for (const ext of CANDIDATE_EXTS) {
      if (existsSync(basePath + ext)) {
        return nextResolve(pathToFileURL(basePath + ext).href, context);
      }
    }
    // also try as a directory index
    for (const ext of CANDIDATE_EXTS) {
      if (existsSync(path.join(basePath, "index" + ext))) {
        return nextResolve(
          pathToFileURL(path.join(basePath, "index" + ext)).href,
          context
        );
      }
    }
  }

  return nextResolve(specifier, context);
}
