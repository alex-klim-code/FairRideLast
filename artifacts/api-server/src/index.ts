import app from "./app";
import { logger } from "./lib/logger";
import { purgeExpiredGeocodingCache } from "./lib/geocoding";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

// Expired results disappear even when there is no search traffic. No sensitive errors logged.
setInterval(() => {
  void purgeExpiredGeocodingCache().catch(() => {
    logger.warn("Address cache cleanup unavailable");
  });
}, 60000).unref();

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
