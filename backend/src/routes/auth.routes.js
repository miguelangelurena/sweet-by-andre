import express from "express";
import { register, login, getMe, logout } from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { createAuthRateLimit } from "../middleware/authRateLimit.js";

const router = express.Router();

router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});

router.post("/register", createAuthRateLimit({ action: "register" }), register);
router.post("/login", createAuthRateLimit(), login);
router.get("/me", requireAuth, getMe);
router.post("/logout", logout);

export default router;
