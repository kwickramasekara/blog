/**
 * @overview Helps improve blog post images with responsive variants, placeholders,
 * and lazy loading.
 *
 * Local images uploaded through the Decap CMS media library are processed at
 * build time with Eleventy Image. Legacy Uploadcare images keep using Eleventy
 * Fetch so they render as before.
 */

const fs = require("fs");
const path = require("path");
const EleventyFetch = require("@11ty/eleventy-fetch");
const Image = require("@11ty/eleventy-img");

const ASSETHOST = "ucarecdn.com";
const LQIPURL = "/preview/-/format/jpeg/-/resize/24x/-/blur/24/";
const METADATAURL = "/resize/1280x/-/json/";

const LOCAL_UPLOAD_PREFIX = "/images/uploads/";
const LOCAL_UPLOAD_DIR = path.join(process.cwd(), "src", "images", "uploads");
const LOCAL_IMAGE_WIDTHS = [400, 800, 1280];
const LOCAL_IMAGE_SIZES = "(max-width: 682px) calc(100vw - 32px), 650px";
const LOCAL_IMAGE_SKIP_EXTENSIONS = new Set([".gif", ".svg"]);

const fetchOptions = {
  directory: "node_modules/.cache/images", // helps with netlify build cache as well
  duration: "*", // cache indefinitely since images don't change often
  type: "buffer",
};

const lqipCache = new Map();
const lqipTransform = (sharp) =>
  sharp.resize({ width: 24, withoutEnlargement: true }).blur(20);

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

  let URLObj;
  try {
    URLObj = new URL(imageURL);
  } catch {
    // Relative paths are handled by the local media pipeline.
    return null;
  }

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

/**
 * Resolve a local media library URL to a file in the Eleventy input directory
 * @param {string} imageURL - image URL from Markdown or front matter
 * @returns {string | null} - absolute file path when this is a local upload
 */
const getLocalUploadPath = function (imageURL) {
  if (!imageURL) return null;

  let pathname;
  try {
    pathname = new URL(imageURL, "https://example.com").pathname;
  } catch {
    return null;
  }

  if (!pathname.startsWith(LOCAL_UPLOAD_PREFIX)) return null;

  let decodedPath = pathname;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    // Use the original path if it contains malformed escape sequences.
  }

  const relativePath = decodedPath.slice(LOCAL_UPLOAD_PREFIX.length);
  const filePath = path.resolve(LOCAL_UPLOAD_DIR, relativePath);

  if (!filePath.startsWith(`${LOCAL_UPLOAD_DIR}${path.sep}`)) return null;

  return filePath;
};

/**
 * Returns a blurred 24px JPEG LQIP for a local image
 * @param {string} filePath - absolute path to the source image
 * @returns {Promise<string>} - base64 encoded JPEG
 */
const getLocalLQIP = function (filePath) {
  if (!lqipCache.has(filePath)) {
    lqipCache.set(
      filePath,
      Image(filePath, {
        widths: [24],
        formats: ["jpeg"],
        dryRun: true,
        sharpJpegOptions: { quality: 40 },
        transform: lqipTransform,
      }).then((metadata) => metadata.jpeg[0].buffer.toString("base64")),
    );
  }

  return lqipCache.get(filePath);
};

/**
 * Build responsive picture markup for a local media library image.
 * GIF and SVG uploads are intentionally served as-is to preserve animation
 * and vector sharpness.
 * @param {string} imageURL - image URL from Markdown
 * @param {string} alt - image alt text
 * @returns {Promise<{ html: string } | { skipped: true } | null>} - picture markup or skip/null
 */
const getLocalImage = async function (imageURL, alt = "") {
  const filePath = getLocalUploadPath(imageURL);
  if (!filePath) return null;

  if (!fs.existsSync(filePath)) {
    console.warn(`[images] Local upload not found: ${filePath}`);
    return null;
  }

  if (LOCAL_IMAGE_SKIP_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return { skipped: true };
  }

  const [metadata, lqip] = await Promise.all([
    Image(filePath, {
      widths: LOCAL_IMAGE_WIDTHS,
      formats: ["avif", "jpeg"],
      outputDir: "./dist/img/",
      urlPath: "/img/",
      sharpAvifOptions: { quality: 60 },
      sharpJpegOptions: { quality: 85 },
    }),
    getLocalLQIP(filePath),
  ]);

  const largest = metadata.jpeg.at(-1);

  const htmlAttributes = {
    alt: alt || "",
    sizes: LOCAL_IMAGE_SIZES,
    loading: "lazy",
    decoding: "async",
    class: "with-placeholder",
    style: `aspect-ratio: ${
      largest.width / largest.height
    };background-image: url('data:image/jpeg;base64,${lqip}');`,
  };

  const html = Image.generateHTML(metadata, htmlAttributes);

  return { html };
};

module.exports = {
  getImageMetadata,
  modifyImageURL,
  getLocalImage,
};
