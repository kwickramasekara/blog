/**
 * @overview Parses and transforms Cloudinary delivery URLs. Kept dependency-free
 * so build-time code and maintenance scripts can share the same URL handling.
 */

const CLOUDINARY_HOST = "res.cloudinary.com";

const CLOUDINARY_TRANSFORMATION_PREFIX_PATTERN =
  /^(?:a|ac|af|ar|b|bl|bo|br|c|co|cs|d|dl|dn|dpr|dr|du|e|eo|f|fl|fn|fps|g|h|if|ki|l|o|pg|q|r|so|sp|t|u|vc|vs|w|x|y|z)_/i;

/**
 * Parses a Cloudinary delivery URL into its components
 * @param {string} imageURL - any valid image URL
 * @returns {{publicId: string, format: string|null, version: string|null, baseURL: string}|null} - parsed URL components
 */
const parseCloudinaryURL = function (imageURL) {
  if (!imageURL) return null;

  let url;

  try {
    url = new URL(imageURL);
  } catch {
    return null;
  }

  if (url.host !== CLOUDINARY_HOST) return null;

  const segments = url.pathname.split("/").filter(Boolean);

  // Expected path: /<cloud_name>/image/upload/...
  if (
    segments.length < 4 ||
    segments[1] !== "image" ||
    segments[2] !== "upload"
  ) {
    return null;
  }

  const cloudName = segments[0];
  let rest = segments.slice(3);
  let version = null;

  const versionIndex = rest.findIndex((segment) => /^v\d+$/.test(segment));

  if (versionIndex >= 0) {
    version = rest[versionIndex];
    rest = rest.slice(versionIndex + 1);
  } else {
    // Without a version, strip leading transformation segments. Canonical URLs
    // stored by the blog have no transformations, so this is mainly a safety net
    // for URLs inserted manually or by the Cloudinary media library.
    while (rest.length > 1) {
      const segment = rest[0];
      const isTransformation =
        segment.includes(",") ||
        CLOUDINARY_TRANSFORMATION_PREFIX_PATTERN.test(segment);

      if (!isTransformation || segment.includes(".")) break;

      rest.shift();
    }
  }

  if (rest.length === 0) return null;

  const lastSegment = rest[rest.length - 1];
  const extensionIndex = lastSegment.lastIndexOf(".");
  const format =
    extensionIndex > 0 ? lastSegment.slice(extensionIndex + 1) : null;
  const publicIdSegments = [...rest];

  if (format) {
    publicIdSegments[publicIdSegments.length - 1] = lastSegment.slice(
      0,
      extensionIndex
    );
  }

  let publicId;

  try {
    publicId = decodeURIComponent(publicIdSegments.join("/"));
  } catch {
    return null;
  }

  const versionPath = version ? `/${version}` : "";
  const extension = format ? `.${format}` : "";
  const baseURL = `https://${CLOUDINARY_HOST}/${cloudName}/image/upload${versionPath}/${publicId}${extension}`;

  return {
    publicId,
    format,
    version,
    baseURL,
  };
};

/**
 * Adds a transformation to a Cloudinary delivery URL. Non-Cloudinary URLs are
 * returned unchanged.
 * @param {string} imageURL - any valid image URL
 * @param {string} transformation - Cloudinary transformation string
 * @returns {string} - transformed image URL
 */
const getCloudinaryURL = function (imageURL, transformation) {
  const parsed = parseCloudinaryURL(imageURL);

  if (!parsed) return imageURL;
  if (!transformation) return parsed.baseURL;

  return parsed.baseURL.replace(
    "/image/upload/",
    `/image/upload/${transformation}/`
  );
};

module.exports = {
  CLOUDINARY_HOST,
  parseCloudinaryURL,
  getCloudinaryURL,
};
