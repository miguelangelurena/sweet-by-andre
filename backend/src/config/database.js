
import "dotenv/config";
import { Pool } from "pg";
import { databaseOptions } from "./hosting.js";

// Use the database selected by the environment.
// Node.js can load .env.test with --env-file=.env.test.
export const pool = new Pool(databaseOptions());
