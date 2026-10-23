import { randomBytes, timingSafeEqual } from "node:crypto";

const HEADER = "X-CSRF-Token";

export const getSessionCsrfToken = (req, res) => {
    if (!req.session) {
        return res.status(401).json({
            status: "ERROR",
            message: "Session not available"
        });
    }

    if (!req.session.csrfToken) {
        req.session.csrfToken = randomBytes(32).toString("hex");
    }

    // Persist the token before sending it to the browser.
    req.session.save((error) => {
        if (error) {
            console.error("Error saving CSRF token:", error);

            return res.status(500).json({
                status: "ERROR",
                message: "Internal server error"
            });
        }

        res.set("Cache-Control", "no-store");

        return res.status(200).json({
            status: "GOOD",
            csrf_token: req.session.csrfToken
        });
    });
};

export const requireSessionCsrf = (req, res, next) => {
    const expected = req.session?.csrfToken;
    const supplied = req.get(HEADER);

    if (
        typeof expected !== "string" ||
        typeof supplied !== "string" ||
        !/^[0-9a-f]{64}$/i.test(expected) ||
        !/^[0-9a-f]{64}$/i.test(supplied)
    ) {
        return res.status(403).json({
            status: "ERROR",
            message: "Missing or invalid CSRF token"
        });
    }

    const expectedBuffer = Buffer.from(expected, "hex");
    const suppliedBuffer = Buffer.from(supplied, "hex");

    if (!timingSafeEqual(expectedBuffer, suppliedBuffer)) {
        return res.status(403).json({
            status: "ERROR",
            message: "Missing or invalid CSRF token"
        });
    }

    next();
};