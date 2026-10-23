const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:5173")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);

export const requireTrustedOrigin = (req, res, next) => {
    const origin = req.get("Origin");
    const fetchSite = req.get("Sec-Fetch-Site");

    if (origin && !allowedOrigins.includes(origin)) {
        return res.status(403).json({
            status: "ERROR",
            message: "Origin not allowed"
        });
    }

    // Reject explicit cross-site browser requests.
    if (fetchSite === "cross-site") {
        return res.status(403).json({
            status: "ERROR",
            message: "Cross-site request not allowed"
        });
    }

    // Browsers usually provide Origin for cross-origin POST
    // requests. Reject ambiguous browser requests.
    if (fetchSite && !origin && fetchSite !== "same-origin") {
        return res.status(403).json({
            status: "ERROR",
            message: "Origin required"
        });
    }

    next();
};