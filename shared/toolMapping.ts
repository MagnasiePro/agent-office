import defaults from "./tool-stations.json";

export interface ToolStationConfig {
  /** Station type used for unmapped tools. */
  default: string;
  /** Exact tool name → station type. */
  tools: Record<string, string>;
  /** Tool name prefix → station type (e.g. every MCP tool). */
  prefixes: Record<string, string>;
  /** Station type → animation played while working there. */
  animations: Record<string, string>;
  /** Tool-name suffixes that push to / pull from a remote without a local git command. */
  mail: { push: string[]; pull: string[] };
}

export const DEFAULT_TOOL_CONFIG: ToolStationConfig = defaults;

export function stationForTool(tool: string, config: ToolStationConfig = DEFAULT_TOOL_CONFIG): string {
  const exact = config.tools[tool];
  if (exact) return exact;
  for (const [prefix, station] of Object.entries(config.prefixes)) if (tool.startsWith(prefix)) return station;
  return config.default;
}

export function animationForStation(station: string, config: ToolStationConfig = DEFAULT_TOOL_CONFIG): string {
  return config.animations[station] ?? "work_type";
}

export function mailForTool(tool: string, config: ToolStationConfig = DEFAULT_TOOL_CONFIG): "push" | "pull" | null {
  for (const dir of ["push", "pull"] as const) if (config.mail[dir].some((s) => tool.endsWith(s))) return dir;
  return null;
}
