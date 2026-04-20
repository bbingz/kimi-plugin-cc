/**
 * Render setup report as human-readable markdown.
 */
export function renderSetupReport(report) {
  const lines = [];

  lines.push("## Kimi CLI Status\n");

  const status = report.ready ? "Ready" : "Not Ready";
  lines.push(`**Status:** ${status}\n`);

  lines.push("| Component | Status | Detail |");
  lines.push("|-----------|--------|--------|");
  lines.push(
    `| Node.js | ${report.node.available ? "OK" : "Missing"} | ${report.node.detail} |`
  );
  lines.push(
    `| npm | ${report.npm.available ? "OK" : "Missing"} | ${report.npm.detail} |`
  );
  lines.push(
    `| Kimi CLI | ${report.gemini.available ? "OK" : "Missing"} | ${report.gemini.detail} |`
  );
  lines.push(
    `| Authentication | ${report.auth.loggedIn ? "OK" : "Not logged in"} | ${report.auth.detail} |`
  );

  if (report.auth.model) {
    lines.push(`\n**Default model:** ${report.auth.model}`);
  }

  if (report.actionsTaken.length > 0) {
    lines.push("\n**Actions taken:**");
    for (const action of report.actionsTaken) {
      lines.push(`- ${action}`);
    }
  }

  if (report.nextSteps.length > 0) {
    lines.push("\n**Next steps:**");
    for (const step of report.nextSteps) {
      lines.push(`- ${step}`);
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * Render ask/review result as human-readable markdown.
 */
export function renderKimiResult(result) {
  if (!result.ok) {
    return `**Error:** ${result.error}\n`;
  }

  const lines = [];
  lines.push(result.response);

  return lines.join("\n") + "\n";
}

/**
 * Render a background job submission confirmation.
 */
export function renderJobSubmitted(job) {
  return `**Job submitted:** \`${job.jobId}\` (PID: ${job.pid})\n\nUse \`/kimi:status ${job.jobId}\` to check progress, \`/kimi:result ${job.jobId}\` to get output.\n`;
}

/**
 * Render status report as human-readable markdown.
 */
export function renderStatusReport(snapshot) {
  const lines = [];

  if (snapshot.running.length === 0 && snapshot.recent.length === 0) {
    return "No Kimi jobs found.\n";
  }

  if (snapshot.running.length > 0) {
    lines.push("## Running Jobs\n");
    lines.push("| Job ID | Type | Phase | Elapsed |");
    lines.push("|--------|------|-------|---------|");
    for (const job of snapshot.running) {
      lines.push(
        `| \`${job.id}\` | ${job.kindLabel} | ${job.phase || job.status} | ${job.elapsed || "?"} |`
      );
    }
    if (snapshot.running[0]?.progressPreview) {
      lines.push(`\n**Latest progress:**\n\`\`\`\n${snapshot.running[0].progressPreview}\n\`\`\``);
    }
  }

  if (snapshot.recent.length > 0) {
    lines.push("\n## Recent Jobs\n");
    lines.push("| Job ID | Type | Status | Phase | Duration |");
    lines.push("|--------|------|--------|-------|----------|");
    for (const job of snapshot.recent) {
      lines.push(
        `| \`${job.id}\` | ${job.kindLabel} | ${job.status} | ${job.phase || "-"} | ${job.elapsed || "?"} |`
      );
    }

    // Latest finished hint
    const latestFinished = snapshot.recent.find((j) => j.status === "completed" || j.status === "failed");
    if (latestFinished) {
      lines.push(`\n**Latest finished:** \`${latestFinished.id}\` (${latestFinished.status})`);
      if (latestFinished.prompt) lines.push(`  ${latestFinished.prompt}`);
      lines.push(renderFollowUpHints(latestFinished));
    }
  }

  if (snapshot.waitTimedOut) {
    lines.push("\n> **Warning:** Wait timed out. The job is still running.");
  }

  lines.push(`\n*Total jobs: ${snapshot.totalJobs}*`);
  return lines.join("\n") + "\n";
}

function renderFollowUpHints(job) {
  const hints = [];
  if (job.status === "running" || job.status === "queued") {
    hints.push(`  - Cancel: \`/kimi:cancel ${job.id}\``);
  }
  if (job.status === "completed" || job.status === "failed") {
    hints.push(`  - View result: \`/kimi:result ${job.id}\``);
  }
  if (job.kind === "task" && job.write) {
    hints.push(`  - Review changes: \`/kimi:review --wait\``);
  }
  if (job.geminiSessionId) {
    hints.push(`  - Resume: \`/kimi:rescue --resume-last\``);
  }
  return hints.join("\n");
}

/**
 * Render stored job result.
 */
export function renderStoredJobResult(job, result) {
  const lines = [];
  lines.push(`## Result: \`${job.id}\` (${job.kindLabel})\n`);
  lines.push(`**Status:** ${job.status} | **Duration:** ${job.elapsed || "?"}\n`);

  if (result) {
    if (result.ok === false) {
      lines.push(`**Error:** ${result.error}\n`);
    } else if (result.response) {
      lines.push(result.response);
    } else {
      lines.push("```json\n" + JSON.stringify(result, null, 2) + "\n```");
    }
  } else {
    lines.push("*No result data available. The job may still be running or the output was lost.*\n");
  }

  return lines.join("\n") + "\n";
}

/**
 * Render cancel report.
 */
export function renderCancelReport(report) {
  if (report.cancelled) {
    return `**Cancelled** job \`${report.jobId}\`.\n`;
  }
  return `**Cannot cancel:** ${report.reason}\n`;
}
