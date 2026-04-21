// This module intentionally stays small (~440 bytes). Review-flow prompts
// live in review.mjs (buildReviewPrompt / buildAdversarialPrompt); ask and
// rescue prompts pass through verbatim to the CLI. No prompt-template
// abstraction is planned for v0.1 — if a sibling plugin needs to centralize
// prompts, do it in its own <llm>.mjs rather than forcing the abstraction
// up here. (Rationale added in response to gemini-plugin-cc alignment
// review §5.5.)

import fs from "node:fs";
import path from "node:path";

export function loadPromptTemplate(rootDir, name) {
  const promptPath = path.join(rootDir, "prompts", `${name}.md`);
  return fs.readFileSync(promptPath, "utf8");
}

export function interpolateTemplate(template, variables) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : "";
  });
}
