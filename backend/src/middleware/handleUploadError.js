
import multer from "multer";

export const handleUploadError = (error, req, res, next) => {
    if (!error) {
        return next();
    }

    if (error instanceof multer.MulterError) {
        return res.status(400).json({
            status: "ERROR",
            message:
                error.code === "LIMIT_FILE_SIZE"
                    ? "Image must not exceed 5 MB"
                    : "Invalid image upload"
        });
    }

    if (error.message === "Only JPEG, PNG and WebP images are allowed") {
        return res.status(400).json({
            status: "ERROR",
            message: error.message
        });
    }

    return next(error);
};
