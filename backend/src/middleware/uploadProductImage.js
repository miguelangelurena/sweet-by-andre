
import multer from "multer";

const storage = multer.memoryStorage();

const allowedMimeTypes = [
    "image/jpeg",
    "image/png",
    "image/webp"
];

export const uploadProductImage = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1,
        fields: 0,
        parts: 1,
        fieldNameSize: 100,
        headerPairs: 50
    },
    fileFilter: (req, file, callback) => {
        if (!allowedMimeTypes.includes(file.mimetype)) {
            return callback(
                new Error("Only JPEG, PNG and WebP images are allowed")
            );
        }

        callback(null, true);
    }
}).single("image");
