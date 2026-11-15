import express from "express";
import { register, login, getMe, logout } from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { createAuthRateLimit } from "../middleware/authRateLimit.js";
import { requireSessionCsrf } from "../middleware/sessionCsrf.js";

const router = express.Router();

router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});

router.post("/register", (req, res, next) => {
    if (["staging", "production"].includes(process.env.APP_ENV) && process.env.ENABLE_CUSTOMER_REGISTRATION !== "true")
        return res.status(403).json({ status: "ERROR", message: "Customer registration is not available" });
    next();
}, createAuthRateLimit({ action: "register" }), register);
router.post("/login", createAuthRateLimit(), login);
router.get("/me", requireAuth, getMe);
router.post("/logout", requireAuth, requireSessionCsrf, logout);

export default router;
