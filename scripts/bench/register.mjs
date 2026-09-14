import { register } from "node:module";

// Resolve relative to THIS file's own location, not the process cwd, so
// `npm run bench:*` works regardless of which directory it's invoked from.
register("./ts-loader.mjs", import.meta.url);
