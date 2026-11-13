const http = require("node:http");
const net = require("node:net");
const { spawn } = require("node:child_process");

const port = 8090;
let stoppingNormally = false;
const cloudflared = spawn(process.argv[2], ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
  stdio: "inherit",
});

const server = http.createServer((request, response) => {
  if (request.url === "/x" || request.url === "/x/") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("Stopping the Windows desktop session.");
    stoppingNormally = true;
    cloudflared.kill();
    return;
  }

  if (request.url === "/" || request.url === "/index.html") {
    response.writeHead(302, { location: "/vnc.html?autoconnect=true&resize=remote&path=websockify" });
    response.end();
    return;
  }

  const upstream = http.request(
    { host: "127.0.0.1", port: 6080, path: request.url, method: request.method, headers: request.headers },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("error", (error) => {
    response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    response.end(`Desktop proxy failed: ${error.message}`);
  });
  request.pipe(upstream);
});

server.on("upgrade", (request, client, head) => {
  const upstream = net.connect(6080, "127.0.0.1", () => {
    const headers = Object.entries(request.headers)
      .map(([name, value]) => `${name}: ${value}`)
      .join("\r\n");
    upstream.write(`${request.method} ${request.url} HTTP/${request.httpVersion}\r\n${headers}\r\n\r\n`);
    if (head.length) upstream.write(head);
    client.pipe(upstream);
    upstream.pipe(client);
  });
  upstream.on("error", () => client.destroy());
  client.on("error", () => upstream.destroy());
});

server.listen(port, "127.0.0.1");

cloudflared.on("error", (error) => {
  console.error(`Could not start cloudflared: ${error.message}`);
  server.close(() => process.exit(1));
});
cloudflared.on("exit", (code) => {
  server.close(() => process.exit(stoppingNormally ? 0 : (code ?? 0)));
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => cloudflared.kill());
}
