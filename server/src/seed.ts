/**
 * Interactive / scripted user seeding.
 *
 *   npm run seed-users                       -> creates/updates users from .env
 *   npm run seed-users -- alice secret "Alice"  -> creates/updates a single user
 */
import { ensureUser, seedUsersFromEnv } from "./auth.js";

const [username, password, displayName] = process.argv.slice(2);
if (username && password) {
  ensureUser(username, password, displayName ?? username);
} else {
  seedUsersFromEnv();
}
console.log("Done.");
