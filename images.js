/**
 * @overview Helps improve blog post images with placeholders and lazy loading.
 * Uses 11ty fetch plugin to cache image metadata and LQIPs so it wouldn't
 * increase image host usage. Should also help with Netlify builds since it
 * caches the images in the node_modules/.cache/images directory.
 */

const EleventyFetch = require("@11ty/eleventy-fetch");
const {
  CLOUDINARY_HOST,
  parseCloudinaryURL,
  getCloudinaryURL,
} = require("./lib/cloudinary-url");

const UPLOADCARE_HOST = "ucarecdn.com";
const UPLOADCARE_CUSTOM_HOST_PATTERN = /\.ucarecd\.net$/i;

const UPLOADCARE_LQIP_URL = "/preview/-/format/jpeg/-/resize/24x/-/blur/24/";
const UPLOADCARE_METADATA_URL = "/resize/1280x/-/json/";

const CLOUDINARY_DISPLAY_TRANSFORM = "c_limit,w_1280,h_1280/f_auto/q_auto";
const CLOUDINARY_LQIP_TRANSFORM = "w_24,e_blur:500,q_50,f_jpg,fl_strip_profile";

const fetchOptions = {
  directory: "node_modules/.cache/images", // helps with netlify build cache as well
  duration: "*", // cache indefinitely since images don't change often
  type: "buffer",
};

/**
 * Returns cache or fetch response based on the URL and type
 * @param {string} url - any valid URL
 * @param {'text' | 'json' | 'buffer'} type - type of fetch response
 * @returns {Promise<string | object | Buffer>} - fetch response
 */
const fetch = async (url, type = "buffer") =>
  EleventyFetch(url, { ...fetchOptions, type });

/**
 * Returns true when the hostname belongs to Uploadcare (including custom CDN domains)
 * @param {string} host - hostname from a URL
 * @returns {boolean} - whether the host is an Uploadcare host
 */
const isUploadcareHost = (host) =>
  host === UPLOADCARE_HOST || UPLOADCARE_CUSTOM_HOST_PATTERN.test(host);

/**
 * Returns JSON metadata for an image hosted on Uploadcare
 * @param {string} uuid - Uploadcare UUID for the image
 * @returns {Promise<object>} - JSON metadata object
 */
const getJSONdata = async (uuid) =>
  fetch(
    `https://${UPLOADCARE_HOST}/${uuid}/-${UPLOADCARE_METADATA_URL}`,
    "json"
  );

/**
 * Returns LQIP (Low Quality Image Placeholder) for an image hosted on Uploadcare
 * @param {string} uuid - Uploadcare UUID for the image
 * @returns {Promise<Buffer>} - Low quality image as a buffer
 */
const getLQIP = async (uuid) =>
  fetch(`https://${UPLOADCARE_HOST}/${uuid}/-${UPLOADCARE_LQIP_URL}`);

/**
 * Returns LQIP (Low Quality Image Placeholder) and other metadata (width, height, etc)
 * for an image hosted on Cloudinary
 * @param {string} imageURL - any valid Cloudinary image URL
 * @returns {Promise<object|null>} - metadata object
 */
const getCloudinaryMetadata = async function (imageURL) {
  const parsed = parseCloudinaryURL(imageURL);

  if (!parsed) return null;

  const infoURL = getCloudinaryURL(
    imageURL,
    `${CLOUDINARY_DISPLAY_TRANSFORM}/fl_getinfo`
  );
  const lqipURL = getCloudinaryURL(imageURL, CLOUDINARY_LQIP_TRANSFORM);

  const [info, lqip] = await Promise.all([
    fetch(infoURL, "json"),
    fetch(lqipURL),
  ]);

  const output = info.output || info.input || info;

  if (!output || !output.width || !output.height) return null;

  return {
    width: output.width,
    height: output.height,
    original: {
      format: parsed.format || output.format || "jpeg",
    },
    lqipFormat: "jpeg",
    lqip: lqip.toString("base64"),
  };
};

/**
 * Returns LQIP (Low Quality Image Placeholder) and other metadata (width, height, etc)
 * for an image hosted on Uploadcare or Cloudinary
 * @param {string} imageURL - any valid image URL
 * @returns {Promise<object|null>} - metadata object
 */
const getImageMetadata = async function (imageURL) {
  if (!imageURL) return null;

  let URLObj;

  try {
    URLObj = new URL(imageURL);
  } catch {
    return null;
  }

  if (isUploadcareHost(URLObj.host)) {
    const uuid = URLObj.pathname.split("/")[1];

    if (!uuid) return null;

    const json = await getJSONdata(uuid);
    const lqip = await getLQIP(uuid);

    return {
      ...json,
      lqip: lqip.toString("base64"),
    };
  }

  if (URLObj.host === CLOUDINARY_HOST) {
    return getCloudinaryMetadata(imageURL);
  }

  return null;
};

/**
 * Modify the image URL for display. Uploadcare portrait images need their
 * resize edge switched to the height, while Cloudinary handles both edges with
 * c_limit.
 * @param {string} imageURL - any valid image URL
 * @param {number} width - image width from metadata
 * @param {number} height - image height from metadata
 * @returns {string} - modified image URL
 */
const modifyImageURL = function (imageURL, width, height) {
  if (!imageURL) return imageURL;

  if (parseCloudinaryURL(imageURL)) {
    return getCloudinaryURL(imageURL, CLOUDINARY_DISPLAY_TRANSFORM);
  }

  if (width / height < 1) {
    const regex = /\/resize\/(\d+)x\//; // Regular expression to match /resize/{width}x/

    return imageURL?.replace(regex, "/resize/x$1/");
  }

  return imageURL;
};

module.exports = {
  getImageMetadata,
  modifyImageURL,
  getCloudinaryURL,
};
