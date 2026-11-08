// LahLah Video MCP server (stdio). Lets Claude Desktop and Claude Code drive the running editor.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, VERSION } from "./create";

if (process.argv.includes("--version")) {
  console.log(VERSION);
} else {
  await createServer().connect(new StdioServerTransport());
}
