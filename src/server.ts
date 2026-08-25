import "dotenv/config";
import express from "express";
import { z } from "zod";
import { WebClient } from "@slack/web-api";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const slackToken = process.env.SLACK_BOT_TOKEN;
const port = Number(process.env.PORT ?? 3000);

if (!slackToken) {
  throw new Error("Missing SLACK_BOT_TOKEN");
}

if (!slackToken.startsWith("xoxb-")) {
  throw new Error("SLACK_BOT_TOKEN must start with xoxb-");
}

const slack = new WebClient(slackToken);

function createMcpServer() {
  const mcpServer = new McpServer({
    name: "assistant-slack-bot",
    version: "1.0.0"
  });

  mcpServer.registerTool(
    "slack_post_message",
    {
      title: "Post a Slack message",
      description: "Post a message to Slack as the Assistant bot, either as a new post or a thread reply.",
      inputSchema: {
        channel: z.string().describe("Slack channel ID, for example C0123456789"),
        text: z.string().min(1).max(4000).describe("The message to post"),
        thread_ts: z
          .string()
          .optional()
          .describe("Slack thread timestamp. Include this to reply in a thread.")
      }
    },
    async ({ channel, text, thread_ts }) => {
      const result = await slack.chat.postMessage({
        channel,
        text,
        thread_ts
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              channel: result.channel,
              ts: result.ts,
              thread_ts: thread_ts ?? result.ts
            })
          }
        ]
      };
    }
  );

  mcpServer.registerTool(
    "slack_read_thread",
    {
      title: "Read a Slack thread",
      description: "Read replies in a Slack thread for a specific message.",
      inputSchema: {
        channel: z.string().describe("Slack channel ID, for example C0123456789"),
        thread_ts: z
          .string()
          .describe("Slack thread timestamp for the parent message"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Maximum number of messages to return")
      }
    },
    async ({ channel, thread_ts, limit }) => {
      const result = await slack.conversations.replies({
        channel,
        ts: thread_ts,
        limit: limit ?? 50
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              channel,
              thread_ts,
              messages: (result.messages ?? []).map((message) => ({
                ts: message.ts,
                user: "user" in message ? message.user : undefined,
                text: message.text ?? ""
              }))
            })
          }
        ]
      };
    }
  );

  return mcpServer;
}

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.send("Assistant Bot Slack MCP server is running.");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/mcp", async (req, res) => {
  const mcpServer = createMcpServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });

  res.on("close", () => {
    transport.close();
  });

  await mcpServer.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(port, () => {
  console.log(`MCP server listening on port ${port}`);
});
