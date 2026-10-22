export const requireAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            status: "ERROR",
            message: "Authentication required"
        });
    }

    if (req.user.role !== "admin") {
        return res.status(403).json({
            status: "ERROR",
            message: "Forbidden"
        });
    }

    next();
};
