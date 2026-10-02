export const requireAdmin = (req, res, next) => {
    console.log("AUTH USER:", req.user);

    if (req.user.role !== "admin") {
        return res.status(403).json({
            status: "ERROR",
            message: "Forbidden"
        });
    }

    next();
};