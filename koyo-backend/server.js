import express from "express";
import cors from "cors";

const app = express();

const PORT = process.env.PORT || 3000;

const XTREAM_URL = (process.env.XTREAM_URL || "").replace(/\/+$/, "");
const USERNAME = process.env.XTREAM_USERNAME || "";
const PASSWORD = process.env.XTREAM_PASSWORD || "";

const ALLOWED_ORIGIN =
  process.env.ALLOWED_ORIGIN ||
  "https://royahassam3064.github.io";

app.disable("x-powered-by");

app.use(cors({
  origin: ALLOWED_ORIGIN,
  methods: ["GET", "HEAD", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Range"],
  exposedHeaders: [
    "Content-Length",
    "Content-Range",
    "Accept-Ranges"
  ]
}));

app.get("/", (req, res) => {
  res.json({
    name: "KOYO TV Backend",
    status: "online"
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

function checkConfig(res) {
  if (!XTREAM_URL || !USERNAME || !PASSWORD) {
    res.status(503).json({
      error: "XTREAM settings are missing in Render."
    });
    return false;
  }

  try {
    const url = new URL(XTREAM_URL);

    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error();
    }
  } catch {
    res.status(503).json({
      error: "Invalid XTREAM_URL."
    });
    return false;
  }

  return true;
}

const allowedActions = new Set([
  "get_live_streams",
  "get_vod_streams",
  "get_series",
  "get_series_info",
  "get_live_categories",
  "get_vod_categories",
  "get_series_categories"
]);

app.get("/api/xtream", async (req, res) => {
  if (!checkConfig(res)) return;

  const action = String(req.query.action || "");

  if (action && !allowedActions.has(action)) {
    return res.status(400).json({
      error: "Unsupported Xtream action."
    });
  }

  const target = new URL(
    "player_api.php",
    XTREAM_URL + "/"
  );

  target.searchParams.set("username", USERNAME);
  target.searchParams.set("password", PASSWORD);

  if (action) {
    target.searchParams.set("action", action);
  }

  if (req.query.series_id) {
    target.searchParams.set(
      "series_id",
      String(req.query.series_id)
    );
  }

  try {
    const controller = new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      25000
    );

    const response = await fetch(target, {
      signal: controller.signal
    });

    clearTimeout(timer);

    if (!response.ok) {
      return res.status(502).json({
        error: `Xtream HTTP ${response.status}`
      });
    }

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: "Provider returned invalid JSON."
      });
    }

    res.json(data);

  } catch (error) {
    res.status(502).json({
      error: error.name === "AbortError"
        ? "Xtream connection timed out."
        : "Cannot connect to Xtream provider."
    });
  }
});

app.get("/stream/:type/:id", async (req, res) => {
  if (!checkConfig(res)) return;

  const { type, id } = req.params;

  const extension = String(
    req.query.ext || (type === "live" ? "ts" : "mp4")
  );

  if (
    !["live", "movie", "series"].includes(type) ||
    !/^\d+$/.test(id) ||
    !/^[a-zA-Z0-9]{2,5}$/.test(extension)
  ) {
    return res.status(400).json({
      error: "Invalid stream request."
    });
  }

  const path =
    `${type}/${encodeURIComponent(USERNAME)}/` +
    `${encodeURIComponent(PASSWORD)}/` +
    `${encodeURIComponent(id)}.${encodeURIComponent(extension)}`;

  const target = new URL(path, XTREAM_URL + "/");

  const headers = {};

  if (req.headers.range) {
    headers.Range = req.headers.range;
  }

  try {
    const upstream = await fetch(target, {
      headers,
      redirect: "follow"
    });

    if (!upstream.ok && upstream.status !== 206) {
      return res.status(502).json({
        error: `Stream provider returned HTTP ${upstream.status}.`
      });
    }

    for (const name of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges"
    ]) {
      const value = upstream.headers.get(name);

      if (value) {
        res.setHeader(name, value);
      }
    }

    res.status(upstream.status);

    if (!upstream.body) {
      return res.end();
    }

    const reader = upstream.body.getReader();

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      if (!res.write(value)) {
        await new Promise(resolve =>
          res.once("drain", resolve)
        );
      }
    }

    res.end();

  } catch {
    if (!res.headersSent) {
      res.status(502).json({
        error: "Unable to open stream."
      });
    } else {
      res.destroy();
    }
  }
});

app.listen(PORT, () => {
  console.log("KOYO TV Backend started on port " + PORT);
});
