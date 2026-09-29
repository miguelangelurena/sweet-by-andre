import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

import { pool } from "./config/database.js";
import healthRouter from "./routes/health.routes.js";
import authRouter from "./routes/auth.routes.js";

const app = express();

app.use(express.json());

const PgSession = connectPgSimple(session);

app.use(
    session({
        store: new PgSession({
            pool: pool
        }),
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: false,
            sameSite: "lax"
        }
    })
);

app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);

export default app;