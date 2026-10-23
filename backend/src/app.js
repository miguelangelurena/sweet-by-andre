import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import cookieParser from "cookie-parser";

import { pool } from "./config/database.js";
import healthRouter from "./routes/health.routes.js";
import authRouter from "./routes/auth.routes.js";
import categoryRouter from "./routes/category.routes.js";
import productRouter from "./routes/products.routes.js";
import cartRouter from "./routes/cart.routes.js";
import orderRouter from "./routes/orders.routes.js";
import paymentRouter from "./routes/payments.routes.js";
import { handleStripeWebhook } from "./controllers/stripe-webhook.controllers.js";
import adminOrdersRouter from "./routes/admin-orders.routes.js";
import guestCartRoutes from "./routes/guestCart.routes.js";

const app = express();

// Stripe webhook: must receive the raw request body.
app.post(
    "/api/payments/webhook",
    express.raw({ type: "application/json" }),
    handleStripeWebhook
);

// Parse JSON for the rest of the API.
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
app.use("/api", cartRouter);
app.use("/api", orderRouter);
app.use("/api", paymentRouter);
app.use("/api/admin", adminOrdersRouter);
app.use(cookieParser());
app.use("/api", guestCartRoutes);

export default app;