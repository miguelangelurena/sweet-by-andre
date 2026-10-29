
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import cookieParser from "cookie-parser";
import cors from "cors";

import { pool } from "./config/database.js";

import healthRouter from "./routes/health.routes.js";
import authRouter from "./routes/auth.routes.js";
import categoryRouter from "./routes/category.routes.js";
import productRouter from "./routes/products.routes.js";
import cartRouter from "./routes/cart.routes.js";
import orderRouter from "./routes/orders.routes.js";
import paymentRouter from "./routes/payments.routes.js";
import adminOrdersRouter from "./routes/admin-orders.routes.js";
import guestCartRoutes from "./routes/guestCart.routes.js";
import seasonalRouter from "./routes/seasonal.routes.js";

import { handleStripeWebhook } from "./controllers/stripe-webhook.controllers.js";

const app = express();

const isProduction = process.env.NODE_ENV === "production";

const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

// Necessary when Express is behind a trusted reverse proxy.
if (isProduction) {
    app.set("trust proxy", 1);
}

// 1. Stripe webhook must receive the original raw body.
app.post(
    "/api/payments/webhook",
    express.raw({ type: "application/json" }),
    handleStripeWebhook
);

// 2. Configure CORS.
app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                return callback(null, true);
            }

            return callback(null, false);
        },
        credentials: true,
        methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: [
            "Content-Type",
            "Authorization",
            "X-CSRF-Token"
        ]
    })
);

// 3. Validate Origin for requests that modify data.
// Requests without Origin are allowed for API clients like Postman.
// This is one layer of protection, not complete CSRF protection.
app.use((req, res, next) => {
    const unsafeMethods = ["POST", "PUT", "PATCH", "DELETE"];
    const origin = req.headers.origin;

    if (
        unsafeMethods.includes(req.method) &&
        origin &&
        !allowedOrigins.includes(origin)
    ) {
        return res.status(403).json({
            status: "ERROR",
            message: "Origin not allowed"
        });
    }

    next();
});

// 4. Parse request bodies and cookies.
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

// 5. PostgreSQL session storage.
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
            secure: isProduction,
            sameSite: "lax",
            maxAge: 1000 * 60 * 60 * 24 * 7
        }
    })
);

// 6. Routes.
app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api", categoryRouter);
app.use("/api", seasonalRouter);
app.use("/api", productRouter);
app.use("/api", cartRouter);
app.use("/api", orderRouter);
app.use("/api", paymentRouter);
app.use("/api/admin", adminOrdersRouter);
app.use("/api", guestCartRoutes);

export default app;
