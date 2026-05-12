// Shared MCP tool result shapes (stdio server).

export function mcpText(text: string): {
  content: [{ type: "text"; text: string }];
} {
  return { content: [{ type: "text" as const, text }] };
}

export function mcpError(text: string): {
  content: [{ type: "text"; text: string }];
  isError: true;
} {
  return { content: [{ type: "text" as const, text }], isError: true };
}
