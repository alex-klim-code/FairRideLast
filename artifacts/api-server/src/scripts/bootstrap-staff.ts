import { savePermission } from "../lib/staff-permissions";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const id = process.argv[2];
try {
  if (!id || process.argv[3] !== "--confirm") throw new Error("Usage: pnpm --filter @workspace/api-server staff:bootstrap user_CLERK_ID --confirm");
  await savePermission("operator-bootstrap", id, "ADMIN", false, true);
  logger.info("First verified Admin provisioned. Further changes belong in the Admin staff page.");
} catch (error) {
  logger.error({ message: error instanceof Error ? error.message : "Provisioning failed" }, "Admin was not provisioned.");
  process.exitCode = 1;
} finally { await pool.end(); }