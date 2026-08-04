// See ts-loader.mjs. Split in two because a module resolver has to be
// registered from outside the graph it resolves.
import { register } from "node:module";

register("./ts-loader.mjs", import.meta.url);
