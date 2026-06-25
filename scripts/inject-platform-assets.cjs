const fs = require("fs");
const path = require("path");

const WORKFLOW_START = "<!-- apt-workflow:start -->";
const WORKFLOW_END = "<!-- apt-workflow:end -->";

const PUBLIC_TEMPLATES = new Set([
  "feature.md",
  "plan-from-spec.md",
  "implement-plan.md",
  "verify.md",
  "finish-feature.md",
  "design-system.md",
  "design-page.md",
]);

function parseFrontmatter(content) {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {}, body: content };
  }
  const end = normalized.indexOf("\n---\n", 4);
  if (end === -1) {
    return { frontmatter: {}, body: content };
  }
  const fmBlock = normalized.slice(4, end);
  const body = normalized.slice(end + 5);
  const frontmatter = {};
  for (const line of fmBlock.split("\n")) {
    const match = line.match(/^([\w-]+):\s*(.*)$/);
    if (match) {
      frontmatter[match[1]] = match[2].trim();
    }
  }
  return { frontmatter, body };
}

function buildClaudeCommand(content) {
  return content.endsWith("\n") ? content : content + "\n";
}

function buildQoderCommand(content) {
  const { frontmatter, body } = parseFrontmatter(content);
  const lines = ["---"];
  if (frontmatter.description) {
    lines.push(`description: ${frontmatter.description}`);
  }
  lines.push("---");
  const normalizedBody = body.startsWith("\n") ? body.slice(1) : body;
  return lines.join("\n") + "\n" + normalizedBody + (normalizedBody.endsWith("\n") ? "" : "\n");
}

function skillNameFromFile(filename) {
  const slug = filename.replace(/\.md$/, "");
  return `apt-${slug}`;
}

function buildCodexSkill(filename, content) {
  const { frontmatter, body } = parseFrontmatter(content);
  const name = skillNameFromFile(filename);
  const description = frontmatter.description || name;
  const normalizedBody = body.startsWith("\n") ? body.slice(1) : body;
  return (
    `---\nname: ${name}\ndescription: ${description}\n---\n` +
    normalizedBody +
    (normalizedBody.endsWith("\n") ? "" : "\n")
  );
}

function extractWorkflowBlock(snippetContent) {
  const startIdx = snippetContent.indexOf(WORKFLOW_START);
  const endIdx = snippetContent.indexOf(WORKFLOW_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return snippetContent.trim() + "\n";
  }
  return snippetContent.slice(startIdx, endIdx + WORKFLOW_END.length).trim() + "\n";
}

function injectAgentsMd(projectRoot, snippetPath) {
  const snippetContent = fs.readFileSync(snippetPath, "utf8");
  const workflowBlock = extractWorkflowBlock(snippetContent);
  const agentsPath = path.join(projectRoot, "AGENTS.md");

  if (!fs.existsSync(agentsPath)) {
    const initial = snippetContent.endsWith("\n") ? snippetContent : snippetContent + "\n";
    fs.writeFileSync(agentsPath, initial);
    console.log("OK " + agentsPath + " (created)");
    return;
  }

  let existing = fs.readFileSync(agentsPath, "utf8");
  const startIdx = existing.indexOf(WORKFLOW_START);
  const endIdx = existing.indexOf(WORKFLOW_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    existing =
      existing.slice(0, startIdx) +
      workflowBlock.trimEnd() +
      "\n" +
      existing.slice(endIdx + WORKFLOW_END.length);
  } else {
    const sep = existing.endsWith("\n") ? "" : "\n";
    existing = existing + sep + "\n" + workflowBlock;
  }

  fs.writeFileSync(agentsPath, existing);
  console.log("OK " + agentsPath + " (updated)");
}

function injectPlatformAssets(projectRoot, aptHome) {
  const root = path.resolve(projectRoot);
  const templatesDir = path.join(path.resolve(aptHome), "templates");
  const snippetPath = path.join(templatesDir, "_agents-md-snippet.md");

  if (!fs.existsSync(templatesDir)) {
    throw new Error("Templates not found: " + templatesDir);
  }

  const claudeDir = path.join(root, ".claude", "commands");
  const qoderDir = path.join(root, ".qoder", "commands");
  const zcodeCommandsDir = path.join(root, ".zcode", "commands");
  const skillsRoot = path.join(root, ".agents", "skills");
  const zcodeSkillsRoot = path.join(root, ".zcode", "skills");

  fs.mkdirSync(claudeDir, { recursive: true });
  fs.mkdirSync(qoderDir, { recursive: true });
  fs.mkdirSync(zcodeCommandsDir, { recursive: true });
  fs.mkdirSync(skillsRoot, { recursive: true });
  fs.mkdirSync(zcodeSkillsRoot, { recursive: true });

  for (const filename of fs.readdirSync(templatesDir)) {
    if (!PUBLIC_TEMPLATES.has(filename)) {
      continue;
    }
    const content = fs.readFileSync(path.join(templatesDir, filename), "utf8");

    fs.writeFileSync(path.join(claudeDir, filename), buildClaudeCommand(content));
    fs.writeFileSync(path.join(qoderDir, filename), buildQoderCommand(content));
    fs.writeFileSync(path.join(zcodeCommandsDir, filename), buildQoderCommand(content));

    const skillDir = path.join(skillsRoot, skillNameFromFile(filename));
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      buildCodexSkill(filename, content)
    );

    const zcodeSkillDir = path.join(zcodeSkillsRoot, skillNameFromFile(filename));
    fs.mkdirSync(zcodeSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(zcodeSkillDir, "SKILL.md"),
      buildCodexSkill(filename, content)
    );
  }

  console.log("OK " + claudeDir);
  console.log("OK " + qoderDir);
  console.log("OK " + zcodeCommandsDir);
  console.log("OK " + skillsRoot);
  console.log("OK " + zcodeSkillsRoot);

  if (fs.existsSync(snippetPath)) {
    injectAgentsMd(root, snippetPath);
  } else {
    console.warn("WARN: _agents-md-snippet.md not found, skipping AGENTS.md");
  }
}

function main() {
  const projectRoot = process.argv[2];
  const aptHome = process.argv[3] || process.env.APT_HOME;

  if (!projectRoot) {
    console.error("Usage: node inject-platform-assets.cjs <projectRoot> [aptHome]");
    process.exit(1);
  }
  if (!aptHome) {
    console.error("APT_HOME not set and aptHome argument missing");
    process.exit(1);
  }

  injectPlatformAssets(projectRoot, aptHome);
}

if (require.main === module) {
  main();
}

module.exports = {
  parseFrontmatter,
  buildQoderCommand,
  buildCodexSkill,
  skillNameFromFile,
  injectAgentsMd,
  injectPlatformAssets,
  extractWorkflowBlock,
  PUBLIC_TEMPLATES,
};
