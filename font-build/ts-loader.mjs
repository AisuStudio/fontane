// Lets these scripts import the app's own modules directly, so composition
// has exactly one implementation instead of a browser copy and an offline
// copy that drift apart.
//
// Node strips TypeScript types on its own now, but it still won't guess file
// extensions, and the app's imports are extensionless in the way bundlers
// expect ("./hangul", not "./hangul.ts"). This resolver fills that gap and
// nothing else — no transpiling, no path aliases beyond what's needed.
//
// Used via the sibling ts-register.mjs:
//   node --import ./font-build/ts-register.mjs font-build/spike-hangul.mjs ...

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

// opentype.js resolves to its CommonJS build by default, which offers Node no
// named exports; the app's bundler picks the ESM one. Only matters if a
// script pulls in exportFont.ts.
const OPENTYPE_ESM = pathToFileURL(
  new URL("../node_modules/opentype.js/dist/opentype.mjs", import.meta.url).pathname
).href;

export async function resolve(specifier, context, next) {
  if (specifier === "opentype.js" && existsSync(fileURLToPath(OPENTYPE_ESM))) {
    return { url: OPENTYPE_ESM, shortCircuit: true, format: "module" };
  }
  try {
    return await next(specifier, context);
  } catch (err) {
    if (specifier.startsWith(".")) {
      const url = new URL(specifier + ".ts", context.parentURL);
      if (existsSync(fileURLToPath(url))) {
        return { url: url.href, shortCircuit: true, format: "module-typescript" };
      }
    }
    throw err;
  }
}
