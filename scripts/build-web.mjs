// Builds the web client into one HTML file each:
//   web/index.html          served by the API at «/», talks to the server
//   dist/landsbyen-demo.html  the demo with the service inside the page, no server needed
// Run with `npm run build:web` after changing anything in web/ or src/.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const esbuild = process.env.ESBUILD ?? "node_modules/.bin/esbuild";
const template = readFileSync("web/template.html", "utf8");

function bundle(entry) {
  const code = execFileSync(esbuild, [entry, "--bundle", "--format=esm", "--target=es2022", "--minify", "--charset=utf8"], {
    encoding: "utf8",
  });
  // A literal </script> would end the inline script early
  return template.replace("/*APP*/", () => code.replace(/<\/script/gi, "<\\/script"));
}

const head = '<!doctype html>\n<html lang="nb">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n';
writeFileSync("web/index.html", head + bundle("web/main.ts"));
mkdirSync("dist", { recursive: true });
writeFileSync("dist/landsbyen-demo.html", bundle("web/demo.ts"));
console.log("Bygget web/index.html og dist/landsbyen-demo.html");
