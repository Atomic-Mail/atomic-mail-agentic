export const DEFAULT_SKILL_MANIFEST_PATH = "../shared/skill/manifest.json";
export const DEFAULT_SKILL_TEMPLATE_PATH = "../shared/skill/SKILL.template.md";

export const NPX_SKILL_INVOCATION =
  "npx --package=@atomicmail/agent-skill atomicmail";
export const BUNDLED_CLI_INVOCATION = "{baseDir}/scripts/atomicmail";
export const HERMES_CLI_INVOCATION = "${HERMES_SKILL_DIR}/scripts/atomicmail";
export const HERMES_CREDENTIALS_DIR = "~/.hermes/atomicmail";

export const PLACEHOLDER_CLI = "{{ATOMICMAIL_CLI}}";
export const PLACEHOLDER_CREDENTIALS_DIR = "{{CREDENTIALS_DIR_DEFAULT}}";
export const PLACEHOLDER_HERMES_BLUEPRINT_CLI = "{{CLI_HERMES_BLUEPRINT}}";

export type SkillMdProfile = "bundled" | "npm" | "clawhub" | "hermes";

export interface SkillManifestConfigEntry {
  key: string;
  description: string;
  default: string;
  prompt: string;
}

export interface SkillManifestBlueprint {
  schedule: string;
  deliver: string;
  no_agent: boolean;
  prompt: string;
}

export interface SkillManifestHermes {
  tags: string[];
  config: SkillManifestConfigEntry[];
  blueprint: SkillManifestBlueprint;
}

export interface SkillManifestOpenclaw {
  requires: { bins: string[] };
  homepage: string;
}

export interface SkillManifestEnvVar {
  name: string;
  prompt: string;
  help: string;
  required_for: string;
}

export interface SkillManifestCredentialFile {
  path: string;
  description: string;
}

export interface SkillManifest {
  name: string;
  description: string;
  author: string;
  license: string;
  platforms: string[];
  credentialsDir: {
    default: string;
    hermes: string;
  };
  cliInvocations: {
    npm: string;
    bundledBody: string;
    hermesBlueprint: string;
  };
  openclaw: SkillManifestOpenclaw;
  hermes: SkillManifestHermes;
  requiredEnvironmentVariables: SkillManifestEnvVar[];
  requiredCredentialFiles: SkillManifestCredentialFile[];
  platformNotes: string[];
}

export interface RenderSkillMdOptions {
  profile: SkillMdProfile;
  version: string;
  template?: string;
  manifest?: SkillManifest;
}

export function loadSkillManifest(
  path = DEFAULT_SKILL_MANIFEST_PATH,
): SkillManifest {
  const text = Deno.readTextFileSync(path);
  return JSON.parse(text) as SkillManifest;
}

export async function readSkillTemplate(
  path = DEFAULT_SKILL_TEMPLATE_PATH,
): Promise<string> {
  return await Deno.readTextFile(path);
}

function substitutePlaceholders(
  text: string,
  replacements: Record<string, string>,
): string {
  let result = text;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replaceAll(key, value);
  }
  return result;
}

function formatPlatforms(platforms: string[]): string {
  return `[${platforms.join(", ")}]`;
}

function formatHermesBlueprintPrompt(
  manifest: SkillManifest,
): string {
  return substitutePlaceholders(manifest.hermes.blueprint.prompt, {
    [PLACEHOLDER_HERMES_BLUEPRINT_CLI]: manifest.cliInvocations.hermesBlueprint,
  });
}

function buildHermesFrontmatter(
  manifest: SkillManifest,
  version: string,
): string {
  const blueprintPrompt = formatHermesBlueprintPrompt(manifest);
  return [
    `name: ${manifest.name}`,
    `description: ${manifest.description}`,
    `version: ${version}`,
    `author: ${manifest.author}`,
    `license: ${manifest.license}`,
    `platforms: ${formatPlatforms(manifest.platforms)}`,
    "metadata:",
    "  hermes:",
    `    tags: [${manifest.hermes.tags.join(", ")}]`,
    "    config:",
    ...manifest.hermes.config.map((entry) => [
      `      - key: ${entry.key}`,
      `        description: ${entry.description}`,
      `        default: ${entry.default}`,
      `        prompt: ${entry.prompt}`,
    ]).flat(),
    "    blueprint:",
    `      schedule: "${manifest.hermes.blueprint.schedule}"`,
    `      deliver: ${manifest.hermes.blueprint.deliver}`,
    `      no_agent: ${manifest.hermes.blueprint.no_agent}`,
    "      prompt: |",
    ...blueprintPrompt.split("\n").map((line) => `        ${line}`),
    "required_environment_variables:",
    ...manifest.requiredEnvironmentVariables.map((entry) => [
      `  - name: ${entry.name}`,
      `    prompt: ${entry.prompt}`,
      `    help: ${entry.help}`,
      `    required_for: ${entry.required_for}`,
    ]).flat(),
    "required_credential_files:",
    ...manifest.requiredCredentialFiles.map((entry) => [
      `  - path: ${entry.path}`,
      `    description: ${entry.description}`,
    ]).flat(),
  ].join("\n");
}

function buildBundledFrontmatter(
  manifest: SkillManifest,
  version: string,
): string {
  const hermesFrontmatter = buildHermesFrontmatter(manifest, version);
  const lines = hermesFrontmatter.split("\n");
  const metadataIdx = lines.findIndex((line) => line === "metadata:");
  if (metadataIdx === -1) return hermesFrontmatter;
  lines.splice(
    metadataIdx + 1,
    0,
    "  openclaw:",
    `    requires: ${JSON.stringify(manifest.openclaw.requires)}`,
    `    homepage: ${manifest.openclaw.homepage}`,
  );
  return lines.join("\n");
}

function buildClawhubFrontmatter(
  manifest: SkillManifest,
  version: string,
): string {
  return [
    `name: ${manifest.name}`,
    `description: ${manifest.description}`,
    `version: ${version}`,
    `metadata: ${
      JSON.stringify({
        openclaw: {
          requires: manifest.openclaw.requires,
          homepage: manifest.openclaw.homepage,
        },
      })
    }`,
  ].join("\n");
}

function buildNpmFrontmatter(manifest: SkillManifest): string {
  return [
    `name: ${manifest.name}`,
    `description: ${manifest.description}`,
  ].join("\n");
}

function buildPlatformNotesSection(
  manifest: SkillManifest,
  cliInvocation: string,
): string {
  const notes = manifest.platformNotes.map((line) =>
    substitutePlaceholders(line, { [PLACEHOLDER_CLI]: cliInvocation })
  );
  return [
    "## Platform notes",
    "",
    ...notes.map((line) => `- ${line}`),
    "",
  ].join("\n");
}

function buildHermesNotesSection(
  manifest: SkillManifest,
  cliInvocation: string,
): string {
  const notes = manifest.platformNotes.map((line) =>
    substitutePlaceholders(line, { [PLACEHOLDER_CLI]: cliInvocation })
  );
  return [
    "## Hermes Agent notes",
    "",
    ...notes.map((line) => `- ${line}`),
    "",
  ].join("\n");
}

function renderBody(
  template: string,
  profile: SkillMdProfile,
  manifest: SkillManifest,
): string {
  const cliInvocation = profile === "npm"
    ? manifest.cliInvocations.npm
    : profile === "hermes"
    ? manifest.cliInvocations.hermesBlueprint
    : manifest.cliInvocations.bundledBody;
  const credentialsDir = profile === "hermes"
    ? manifest.credentialsDir.hermes
    : manifest.credentialsDir.default;

  let body = substitutePlaceholders(template, {
    [PLACEHOLDER_CLI]: cliInvocation,
    [PLACEHOLDER_CREDENTIALS_DIR]: credentialsDir,
  });

  if (profile === "bundled") {
    const trimmed = body.replace(/\s+$/, "");
    body = `${trimmed}\n\n${
      buildPlatformNotesSection(manifest, cliInvocation)
    }`;
  } else if (profile === "hermes") {
    const trimmed = body.replace(/\s+$/, "");
    body = `${trimmed}\n\n${buildHermesNotesSection(manifest, cliInvocation)}`;
  }

  return body.startsWith("\n") ? body : `\n${body}`;
}

export function renderSkillMd(options: RenderSkillMdOptions): string {
  const manifest = options.manifest ?? loadSkillManifest();
  const template = options.template ??
    Deno.readTextFileSync(DEFAULT_SKILL_TEMPLATE_PATH);

  const frontmatter = options.profile === "npm"
    ? buildNpmFrontmatter(manifest)
    : options.profile === "clawhub"
    ? buildClawhubFrontmatter(manifest, options.version)
    : options.profile === "hermes"
    ? buildHermesFrontmatter(manifest, options.version)
    : buildBundledFrontmatter(manifest, options.version);

  const body = renderBody(template, options.profile, manifest);
  return `---\n${frontmatter}\n---${body}`;
}

/** Parity with legacy ClawHub transform for incremental migration. */
export function transformSkillMdForBundled(
  content: string,
  version: string,
  manifest?: SkillManifest,
): string {
  const m = manifest ?? loadSkillManifest();
  const withPlaceholders = content.replaceAll(
    NPX_SKILL_INVOCATION,
    PLACEHOLDER_CLI,
  ).replaceAll(m.credentialsDir.default, PLACEHOLDER_CREDENTIALS_DIR);

  const bodyStart = withPlaceholders.indexOf("\n---", 3);
  if (!withPlaceholders.startsWith("---") || bodyStart === -1) {
    throw new Error("SKILL.md must start with YAML frontmatter.");
  }

  const bodyTemplate = withPlaceholders.slice(bodyStart + 4);
  return renderSkillMd({
    profile: "bundled",
    version,
    manifest: m,
    template: bodyTemplate,
  });
}

function extractBodyTemplate(content: string): string {
  const bodyStart = content.indexOf("\n---", 3);
  if (!content.startsWith("---") || bodyStart === -1) {
    throw new Error("SKILL.md must start with YAML frontmatter.");
  }
  return content.slice(bodyStart + 4);
}

function templateFromLegacyContent(
  content: string,
  manifest: SkillManifest,
): string {
  return extractBodyTemplate(
    content.replaceAll(NPX_SKILL_INVOCATION, PLACEHOLDER_CLI)
      .replaceAll(manifest.credentialsDir.default, PLACEHOLDER_CREDENTIALS_DIR)
      .replaceAll(manifest.credentialsDir.hermes, PLACEHOLDER_CREDENTIALS_DIR),
  );
}

export function transformSkillMdForClawhub(
  content: string,
  version: string,
  manifest?: SkillManifest,
): string {
  const m = manifest ?? loadSkillManifest();
  return renderSkillMd({
    profile: "clawhub",
    version,
    manifest: m,
    template: templateFromLegacyContent(content, m),
  });
}

export function transformSkillMdForHermes(
  content: string,
  version: string,
  manifest?: SkillManifest,
): string {
  const m = manifest ?? loadSkillManifest();
  return renderSkillMd({
    profile: "hermes",
    version,
    manifest: m,
    template: templateFromLegacyContent(content, m),
  });
}
