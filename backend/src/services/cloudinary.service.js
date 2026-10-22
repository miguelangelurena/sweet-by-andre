
import { Readable } from "node:stream";
import { cloudinary } from "../config/cloudinary.js";

export const uploadImageToCloudinary = async (
    fileBuffer,
    productId
) => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: `sweet-by-andre/products/${productId}`,
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
    return cloudinary.uploader.destroy(publicId, {
        resource_type: "image"
    });
};
