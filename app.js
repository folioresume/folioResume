import "./src/config/env.js"; // must be first — loads dotenv
import "./src/config/cloudinary.js"; // configure cloudinary at startup

import express from "express";
import { JWT_SECRET } from "./src/config/env.js";
import apiLogger from "./src/utils/logger.js";
import { corsMiddleware, hostCheckMiddleware } from "./src/middlewares/cors.js";
import { generalLimiter } from "./src/middlewares/rateLimiter.js";
import { requireApiKey } from "./src/middlewares/apiKey.js";
import { multerErrorHandler, globalErrorHandler } from "./src/middlewares/errorHandler.js";
import { GEMINI_MODEL } from "./src/config/env.js";
import apiRoutes from "./src/routes/index.js";

const app = express();

if (process.env.NODE_ENV === "production" && JWT_SECRET === "change_this_secret_in_env") {
  throw new Error("JWT_SECRET must be configured in production.");
}

app.use(apiLogger);
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

app.use(corsMiddleware);
app.use(hostCheckMiddleware);

app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      if (req.path === "/api/payments/webhook") {
        req.rawBody = buf;
      }
    },
  }),
);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "resume-parser", model: GEMINI_MODEL });
});

app.use("/api", generalLimiter, requireApiKey, apiRoutes);

app.use(multerErrorHandler);
app.use(globalErrorHandler);

export default app;
