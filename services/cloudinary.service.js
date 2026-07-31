const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/**
 * Upload a File Buffer to Cloudinary
 * @param {Buffer} buffer - File buffer from multer memory storage
 * @param {String} folder - Cloudinary folder path
 * @returns {Promise<String>} Secure image URL
 */
function uploadImageBuffer(buffer, folder = "oloja/menu_items") {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
      },
      (error, result) => {
        if (error) {
          return reject(
            new Error(`Cloudinary upload failed: ${error.message}`),
          );
        }
        resolve(result.secure_url);
      },
    );
    uploadStream.end(buffer);
  });
}

/**
 * Upload a Base64 string to Cloudinary
 * @param {String} base64Str - Base64 encoded image string or data URL
 * @param {String} folder - Cloudinary folder path
 * @returns {Promise<String>} Secure image URL
 */
async function uploadBase64Image(base64Str, folder = "oloja/menu_items") {
  try {
    const result = await cloudinary.uploader.upload(base64Str, {
      folder,
      resource_type: "auto",
    });
    return result.secure_url;
  } catch (error) {
    throw new Error(`Cloudinary upload failed: ${error.message}`);
  }
}

/**
 * Helper to upload either a multer file object or base64 string
 * @param {Object|String} fileOrString - Multer file object or image string
 * @param {String} folder - Cloudinary folder
 * @returns {Promise<String|null>} Secure image URL or original URL
 */
async function uploadImage(fileOrString, folder = "oloja/menu_items") {
  if (!fileOrString) return null;

  // If it's a multer file object with buffer
  if (fileOrString.buffer) {
    return uploadImageBuffer(fileOrString.buffer, folder);
  }

  // If it's a string
  if (typeof fileOrString === "string") {
    // If it's already a hosted URL (e.g. http:// or https://)
    if (fileOrString.startsWith("http://") || fileOrString.startsWith("https://")) {
      return fileOrString;
    }
    // If base64 data string
    if (fileOrString.startsWith("data:") || fileOrString.length > 200) {
      return uploadBase64Image(fileOrString, folder);
    }
  }

  return null;
}

module.exports = {
  cloudinary,
  uploadImageBuffer,
  uploadBase64Image,
  uploadImage,
};
