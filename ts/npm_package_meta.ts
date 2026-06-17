/** Shared npm package.json fields for @atomicmail/* releases. */
export const ATOMICMAIL_NPM_PACKAGE_META = {
  author: "Atomic Mail",
  homepage: "https://atomicmail.ai",
  repository: {
    type: "git" as const,
    url: "git+https://github.com/Atomic-Mail/atomic-mail-agentic.git",
  },
  bugs: {
    url: "https://github.com/Atomic-Mail/atomic-mail-agentic/issues",
  },
  publishConfig: {
    access: "public" as const,
  },
};

export const ATOMICMAIL_GITHUB_PACKAGES_PUBLISH_CONFIG = {
  registry: "https://npm.pkg.github.com",
  access: "public" as const,
} as const;
