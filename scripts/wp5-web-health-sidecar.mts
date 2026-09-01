import { createServer } from "node:http";

import { GET } from "../app/api/health/route.ts";

const port = Number.parseInt(process.env.PORT || "0", 10);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/api/health") {
      const response = GET();
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === "transfer-encoding") return;
        res.setHeader(key, value);
      });
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    res.statusCode = 404;
    res.end();
  } catch {
    res.statusCode = 500;
    res.end();
  }
});

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  const bound = typeof address === "object" && address ? address.port : port;
  process.stdout.write(`WP5_WEB_READY http://127.0.0.1:${bound}\n`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
