import { Router } from "express";
import { health } from "../controllers/health.controllers.js";

const router = Router();
router.get("/", health);

export default router;