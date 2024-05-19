/**
 * @overview Helps improve blog post images with placeholders and lazy loading.
 * Uses 11ty fetch plugin to cache image metadata and LQIPs so it wouldn't
 * increase Uploadcare usage. Should also help with Netlify builds since it caches
 * the images in the node_modules/.cache/images directory.
 */

const EleventyFetch = require("@11ty/eleventy-fetch");

const ASSETHOST = "ucarecdn.com";
const LQIPURL = "/preview/-/format/jpeg/-/resize/24x/-/blur/24/";
const METADATAURL = "/resize/1280x/-/json/";

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
 * Returns JSON metadata for an image hosted on Uploadcare
 * @param {string} uuid - Uploadcare UUID for the image
 * @returns {Promise<object>} - JSON metadata object
 */
const getJSONdata = async (uuid) =>
  fetch(`https://${ASSETHOST}/${uuid}/-${METADATAURL}`, "json");

/**
 * Returns LQIP (Low Quality Image Placeholder) for an image hosted on Uploadcare
 * @param {string} uuid - Uploadcare UUID for the image
 * @returns {Promise<Buffer>} - Low quality image as a buffer
 */
const getLQIP = async (uuid) =>
  fetch(`https://${ASSETHOST}/${uuid}/-${LQIPURL}`);

/**
 * Returns LQIP (Low Quality Image Placeholder) and other metadata (width, height, etc)
 * for an image hosted on Uploadcare
 * @param {string} imageURL - any valid image URL
 * @returns {Promise<object>} - metadata object
 */
const getImageMetadata = async function (imageURL) {
  if (!imageURL) return null;

  const URLObj = new URL(imageURL);

  if (URLObj.host !== ASSETHOST) return null;

  const uuid = URLObj.pathname.split("/")[1];

  const json = await getJSONdata(uuid);
  const lqip = await getLQIP(uuid);

  return {
    ...json,
    lqip: lqip.toString("base64"),
  };
};

/**
 * Modify the image resizing edge for portrait oriented images
 * @param {string} imageURL - any valid image URL
 * @param {number} width - image width from metadata
 * @param {number} height - image height from metadata
 * @returns {string} - modified image URL
 */
const modifyImageURL = function (imageURL, width, height) {
  if (width / height < 1) {
    const regex = /\/resize\/(\d+)x\//; // Regular expression to match /resize/{width}x/

    return imageURL?.replace(regex, "/resize/x$1/");
  }

  return imageURL;
};

module.exports = {
  getImageMetadata,
  modifyImageURL,
};
