const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  parseFrontmatter,
  buildQoderCommand,
  buildCodexSkill,
  skillNameFromFile,
  injectPlatformAssets,
  injectAgentsMd,
  PUBLIC_TEMPLATES,
  EXTRA_SKILLS,
} = require("./inject-platform-assets.cjs");

const SAMPLE = `---
description: Test command description
model: sonnet
---

Body line one.
`;

describe("inject-platform-assets", () => {
  it("parseFrontmatter extracts description and body", () => {
    const { frontmatter, body } = parseFrontmatter(SAMPLE);
    assert.equal(frontmatter.description, "Test command description");
    assert.equal(frontmatter.model, "sonnet");
    assert.match(body, /Body line one/);
  });

  it("parseFrontmatter handles CRLF line endings", () => {
    const crlf = SAMPLE.replace(/\n/g, "\r\n");
    const { frontmatter, body } = parseFrontmatter(crlf);
    assert.equal(frontmatter.description, "Test command description");
    assert.doesNotMatch(body, /^---/);
  });

  it("buildQoderCommand removes model line", () => {
    const out = buildQoderCommand(SAMPLE);
    assert.match(out, /description: Test command description/);
    assert.doesNotMatch(out, /model:/);
    assert.match(out, /Body line one/);
  });

  it("buildCodexSkill produces valid skill frontmatter", () => {
    const out = buildCodexSkill("feature.md", SAMPLE);
    assert.match(out, /^---\nname: apt-feature\n/);
    assert.match(out, /description: Test command description/);
    assert.doesNotMatch(out, /model:/);
  });

  it("skillNameFromFile maps template names", () => {
    assert.equal(skillNameFromFile("plan-from-spec.md"), "apt-plan-from-spec");
    assert.equal(skillNameFromFile("apt-goal.md"), "apt-goal");
    assert.equal(skillNameFromFile("feature.md"), "apt-feature");
    assert.equal(skillNameFromFile("auto-brainstorm.md"), "apt-auto-brainstorm");
    assert.equal(skillNameFromFile("current-status.md"), "apt-current-status");
  });

  it("PUBLIC_TEMPLATES has ten entries", () => {
    assert.equal(PUBLIC_TEMPLATES.size, 10);
  });

  it("EXTRA_SKILLS is separate from PUBLIC_TEMPLATES", () => {
    assert.equal(EXTRA_SKILLS.size, 1);
    assert.ok(EXTRA_SKILLS.has("apt-v0-handoff"));
  });
});

describe("injectPlatformAssets integration", () => {
  let tmpDir;
  let templatesDir;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "apt-inject-"));
    templatesDir = path.join(tmpDir, "templates");
    fs.mkdirSync(templatesDir);

    fs.writeFileSync(path.join(templatesDir, "feature.md"), SAMPLE);
    fs.writeFileSync(path.join(templatesDir, "_feature-closeout.md"), "internal");
    fs.writeFileSync(
      path.join(templatesDir, "_agents-md-snippet.md"),
      "<!-- apt-workflow:start -->\n## APT Workflow\n<!-- apt-workflow:end -->\n"
    );
    for (const name of PUBLIC_TEMPLATES) {
      if (name === "feature.md") continue;
      fs.writeFileSync(
        path.join(templatesDir, name),
        `---\ndescription: ${name}\nmodel: sonnet\n---\n\n${name} body\n`
      );
    }

    const extraSkillDir = path.join(templatesDir, ".agents", "skills", "apt-v0-handoff");
    fs.mkdirSync(extraSkillDir, { recursive: true });
    fs.writeFileSync(
      path.join(extraSkillDir, "SKILL.md"),
      "---\nname: apt-v0-handoff\ndescription: v0 handoff skill\n---\n\nExtra skill body\n"
    );
  });

  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes claude, qoder, zcode, and codex skill outputs", () => {
    const projectRoot = path.join(tmpDir, "project");
    fs.mkdirSync(projectRoot);

    injectPlatformAssets(projectRoot, tmpDir);

    const qoder = fs.readFileSync(
      path.join(projectRoot, ".qoder", "commands", "feature.md"),
      "utf8"
    );
    assert.doesNotMatch(qoder, /model:/);

    const zcodeCmd = fs.readFileSync(
      path.join(projectRoot, ".zcode", "commands", "feature.md"),
      "utf8"
    );
    assert.doesNotMatch(zcodeCmd, /model:/);

    const skill = fs.readFileSync(
      path.join(projectRoot, ".agents", "skills", "apt-feature", "SKILL.md"),
      "utf8"
    );
    assert.match(skill, /name: apt-feature/);

    const zcodeSkill = fs.readFileSync(
      path.join(projectRoot, ".zcode", "skills", "apt-feature", "SKILL.md"),
      "utf8"
    );
    assert.match(zcodeSkill, /name: apt-feature/);

    assert.equal(
      fs.readdirSync(path.join(projectRoot, ".claude", "commands")).length,
      10
    );
    assert.equal(
      fs.readdirSync(path.join(projectRoot, ".qoder", "commands")).length,
      10
    );
    assert.equal(
      fs.readdirSync(path.join(projectRoot, ".zcode", "commands")).length,
      10
    );
    const expectedSkillCount = PUBLIC_TEMPLATES.size + EXTRA_SKILLS.size;
    assert.equal(
      fs.readdirSync(path.join(projectRoot, ".agents", "skills")).length,
      expectedSkillCount
    );
    assert.equal(
      fs.readdirSync(path.join(projectRoot, ".zcode", "skills")).length,
      expectedSkillCount
    );

    const extraSkillPath = path.join(
      projectRoot,
      ".agents",
      "skills",
      "apt-v0-handoff",
      "SKILL.md"
    );
    assert.ok(fs.existsSync(extraSkillPath));
    const extraSkill = fs.readFileSync(extraSkillPath, "utf8");
    assert.match(extraSkill, /name: apt-v0-handoff/);
    assert.match(extraSkill, /Extra skill body/);

    const zcodeExtraSkill = fs.readFileSync(
      path.join(projectRoot, ".zcode", "skills", "apt-v0-handoff", "SKILL.md"),
      "utf8"
    );
    assert.match(zcodeExtraSkill, /name: apt-v0-handoff/);

    assert(!fs.existsSync(path.join(projectRoot, ".claude", "commands", "_feature-closeout.md")));
  });

  it("AGENTS.md injection is idempotent across three runs", () => {
    const projectRoot = path.join(tmpDir, "project-idem");
    fs.mkdirSync(projectRoot, { recursive: true });
    const snippet = path.join(templatesDir, "_agents-md-snippet.md");

    injectAgentsMd(projectRoot, snippet);
    injectAgentsMd(projectRoot, snippet);
    injectAgentsMd(projectRoot, snippet);

    const content = fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8");
    const starts = content.split(WORKFLOW_START_MARKER).length - 1;
    assert.equal(starts, 1);
  });
});

const WORKFLOW_START_MARKER = "<!-- apt-workflow:start -->";
