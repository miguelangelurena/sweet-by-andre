import { securityError } from "../utils/securityLog.js";

export function expireSession(req, res, message) {
  req.session.destroy((error) => {
    if (error)
      securityError(error, "Expired session cleanup failed", req.requestId);
    res.clearCookie("connect.sid", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    res.status(401).json({ status: "ERROR", message });
  });
}
