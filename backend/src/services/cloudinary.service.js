
import { Readable } from "node:stream";
import { cloudinary } from "../config/cloudinary.js";
const imageFolder = () => process.env.CLOUDINARY_FOLDER || (process.env.APP_ENV === "staging" ? "sweet-by-andre/staging" : "sweet-by-andre");

export const uploadImageToCloudinary = async (
    fileBuffer,
    productId
) => {
    const config = cloudinary.config();
    if (![config.cloud_name, config.api_key, config.api_secret].every(value => typeof value === "string" && value.trim())) {
        throw Object.assign(new Error("Image hosting is not configured"), { code: "IMAGE_HOSTING_NOT_CONFIGURED" });
    }
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: `${imageFolder()}/products/${productId}`,
                resource_type: "image",
                overwrite: false
            },
            (error, result) => {
                if (error) {
                    return reject(error);
                }

                if (!result?.secure_url || !result?.public_id) {
                    return reject(
                        new Error("Cloudinary returned an invalid response")
                    );
                }

                resolve({
                    image_url: result.secure_url,
                    public_id: result.public_id
                });
            }
        );

        Readable.from([fileBuffer]).pipe(uploadStream);
    });
};

export const deleteImageFromCloudinary = async (publicId) => {
    if (typeof publicId !== "string" || !publicId.startsWith(`${imageFolder()}/products/`) || publicId.includes("..")) {
        throw new Error("Image deletion is restricted to the current application's upload folder");
    }
    return cloudinary.uploader.destroy(publicId, {
        resource_type: "image"
    });
};
