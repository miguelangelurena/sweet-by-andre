
import { Readable } from "node:stream";
import { cloudinary } from "../config/cloudinary.js";
const imageFolder = () => process.env.CLOUDINARY_FOLDER || (process.env.APP_ENV === "staging" ? "sweet-by-andre/staging" : "sweet-by-andre");

export const uploadImageToCloudinary = async (
    fileBuffer,
    productId
) => {
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
    if (process.env.APP_ENV === "staging" && !publicId.startsWith(`${imageFolder()}/`)) {
        throw new Error("Staging can delete only its own uploaded images");
    }
    return cloudinary.uploader.destroy(publicId, {
        resource_type: "image"
    });
};
