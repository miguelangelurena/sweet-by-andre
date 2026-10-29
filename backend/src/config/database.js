
import "dotenv/config";
import { Pool } from "pg";

// Use the database selected by the environment.
// Node.js can load .env.test with --env-file=.env.test.
export const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});
