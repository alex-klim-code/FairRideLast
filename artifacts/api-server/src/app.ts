import express, { type Express, type ErrorRequestHandler } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { CLERK_PROXY_PATH, clerkProxyMiddleware, getClerkProxyHost } from "./middlewares/clerkProxyMiddleware";

const app: Express = express();
// Deliberate socket-only policy: never trust caller-controlled forwarding headers.
app.set("trust proxy", false);

app.use(
  pinoHttp({
    logger,
    autoLogging: {
      ignore: req => ["/api/geocoding/search", "/api/geocoding/reverse", "/api/transit/routes"].includes(req.url?.split("?")[0] || ""),
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
// Never allow credentialed cross-origin calls to transport state.
app.use(cors());
app.use(["/api/geocoding/search", "/api/geocoding/reverse", "/api/transit/routes"], (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
}, express.json({ limit: "2kb" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

const safeGeocodingError: ErrorRequestHandler = (_error, req, res, next) => {
  if (!["/api/geocoding/search", "/api/geocoding/reverse", "/api/transit/routes"].includes(req.path)) { next(_error); return; }
  res.status(400).json({ error: req.path === "/api/transit/routes" ? "Nieprawidłowe zapytanie o trasę." : "Invalid address search request." });
};
app.use(safeGeocodingError);

export default app;
