import {
  BUNDLED_OPS_PRESET_NAMES,
  BUNDLED_PRESET_JSON,
} from "./bundled-presets.generated.ts";

export async function readOpsFile(
  _credentialDir: string,
  opsFile: string,
): Promise<string> {
  const content = BUNDLED_PRESET_JSON[opsFile];
  if (content === undefined) {
    throw new Error(
      `ops_file '${opsFile}' not found among bundled presets: ` +
        `${BUNDLED_OPS_PRESET_NAMES.join(", ")}.`,
    );
  }
  return content;
}

export { BUNDLED_OPS_PRESET_NAMES };
