import cloudinary from "../config/cloudinary.js";

export function cloudinaryReady() {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET,
  );
}

export function uploadBufferToCloudinary(file, folder) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image", overwrite: false },
      (error, result) => {
        if (error || !result) {
          reject(error || new Error("Cloudinary upload failed."));
          return;
        }
        resolve(result);
      },
    );
    stream.end(file.buffer);
  });
}
