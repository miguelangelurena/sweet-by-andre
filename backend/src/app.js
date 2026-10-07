import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";

import { pool } from "./config/database.js";
import healthRouter from "./routes/health.routes.js";
import authRouter from "./routes/auth.routes.js";
import categoryRouter from "./routes/category.routes.js";
import productRouter from "./routes/products.routes.js";
import cartRouter from "./routes/cart.routes.js";

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
app.use("/api", categoryRouter);
app.use("/api", productRouter);
app.use("/api", categoryRouter);
app.use("/api", productRouter);
app.use("/api", cartRouter);

export default app;
