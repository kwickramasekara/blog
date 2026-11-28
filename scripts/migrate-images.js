#!/usr/bin/env node
/**
 * One-off migration of Uploadcare-hosted blog images to Cloudinary.
 *
 * Usage:
 *   npm run migrate:images
 *   npm run migrate:images -- --dry-run
 *
 * The script:
 *   1. Finds every Uploadcare URL referenced in src/.
 *   2. Audits each original's format, dimensions, and byte size.
 *   3. Resizes originals that exceed Cloudinary's Free limits.
 *   4. Uploads each asset to Cloudinary as blog/<uploadcare-uuid>.
 *   5. Saves migration-map.json with source and Cloudinary details.
 *   6. Rewrites source URLs to canonical Cloudinary URLs.
 *   7. Verifies every migrated asset is within the Free limits.
 *
 * It does not delete anything from Uploadcare.
 */

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { getCloudinaryURL } = require("../images");

const ROOT = path.resolve(__dirname, "..");
const SRC_DIR = path.join(ROOT, "src");
const MAP_PATH = path.join(ROOT, "migration-map.json");

const CLOUDINARY_MAX_BYTES = 10 * 1024 * 1024;
const CLOUDINARY_MAX_PIXELS = 25_000_000;
const MAX_LONG_EDGE = 2048;
const JPEG_QUALITY = 90;

const SOURCE_EXTENSIONS = new Set([
  ".html",
  ".js",
  ".json",
  ".md",
  ".njk",
  ".txt",
  ".yaml",
  ".yml",
]);

const UPLOADCARE_URL_SOURCE = String.raw`https?:\/\/(?:ucarecdn\.com|[a-z0-9-]+\.ucarecd\.net)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/[^\s)"'<>]*)?`;

const createUploadcareURLRegex = () => new RegExp(UPLOADCARE_URL_SOURCE, "gi");

const dryRun = process.argv.includes("--dry-run");

/**
 * Loads .env.local and .env without overwriting existing environment variables.
 * .env.local takes precedence over .env.
 */
function loadEnvFiles() {
  for (const file of [".env.local", ".env"]) {
    const filePath = path.join(ROOT, file);

    if (!fs.existsSync(filePath)) continue;

    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const match = line.match(
        /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/
      );

      if (!match) continue;

      let value = match[2];

      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      if (process.env[match[1]] === undefined) {
        process.env[match[1]] = value;
      }
    }
  }
}

/**
 * Recursively lists files in a directory.
 * @param {string} directory - directory to walk
 * @returns {string[]} - file paths
 */
function listFiles(directory) {
  const files = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listFiles(entryPath));
    } else {
      files.push(entryPath);
    }
  }

  return files;
}

/**
 * Returns all Uploadcare URL occurrences in src/.
 * @returns {{uuid: string, files: Set<string>}[]} - occurrences
 */
function findUploadcareOccurrences() {
  const occurrences = new Map();

  for (const file of listFiles(SRC_DIR)) {
    if (!SOURCE_EXTENSIONS.has(path.extname(file))) continue;

    const content = fs.readFileSync(file, "utf8");

    for (const match of content.matchAll(createUploadcareURLRegex())) {
      const uuid = match[1].toLowerCase();

      if (!occurrences.has(uuid)) {
        occurrences.set(uuid, {
          uuid,
          files: new Set(),
        });
      }

      occurrences.get(uuid).files.add(path.relative(ROOT, file));
    }
  }

  return [...occurrences.values()].sort((a, b) => a.uuid.localeCompare(b.uuid));
}

/**
 * Fetches Uploadcare metadata and byte size for an original.
 * @param {string} uuid - Uploadcare UUID
 * @returns {Promise<object>} - audit details
 */
async function auditUploadcareAsset(uuid) {
  const sourceURL = `https://ucarecdn.com/${uuid}/`;
  const metadataURL = `https://ucarecdn.com/${uuid}/-/json/`;

  const [metadataResponse, headResponse] = await Promise.all([
    fetch(metadataURL),
    fetch(sourceURL, { method: "HEAD" }),
  ]);

  if (!metadataResponse.ok) {
    throw new Error(
      `Uploadcare metadata failed for ${uuid}: ${metadataResponse.status}`
    );
  }

  if (!headResponse.ok) {
    throw new Error(
      `Uploadcare HEAD failed for ${uuid}: ${headResponse.status}`
    );
  }

  const metadata = await metadataResponse.json();
  const bytes = Number(headResponse.headers.get("content-length"));

  if (!metadata.width || !metadata.height || !Number.isFinite(bytes)) {
    throw new Error(`Uploadcare returned incomplete metadata for ${uuid}`);
  }

  const pixels = metadata.width * metadata.height;

  return {
    uuid,
    sourceURL,
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    bytes,
    needsResize: bytes > CLOUDINARY_MAX_BYTES || pixels > CLOUDINARY_MAX_PIXELS,
  };
}

/**
 * Downloads and downscales an original that exceeds Cloudinary Free limits.
 * PNGs keep their format/alpha; other formats are converted to JPEG.
 * @param {object} audit - audit details for the original
 * @returns {Promise<object>} - resized image details
 */
async function createResizedImage(audit) {
  const response = await fetch(audit.sourceURL);

  if (!response.ok) {
    throw new Error(
      `Uploadcare download failed for ${audit.uuid}: ${response.status}`
    );
  }

  let input = Buffer.from(await response.arrayBuffer());
  let inputFormat = audit.format.toUpperCase();

  // sharp's prebuilt binaries may not decode every HEIF/HEIC variant. Fall
  // back to Uploadcare's JPEG conversion if the original can't be read.
  try {
    await sharp(input).metadata();
  } catch {
    const convertedResponse = await fetch(
      `https://ucarecdn.com/${audit.uuid}/-/format/jpeg/`
    );

    if (!convertedResponse.ok) {
      throw new Error(
        `Uploadcare JPEG conversion failed for ${audit.uuid}: ${convertedResponse.status}`
      );
    }

    input = Buffer.from(await convertedResponse.arrayBuffer());
    inputFormat = "JPEG";
  }

  let maxEdge = MAX_LONG_EDGE;
  let quality = JPEG_QUALITY;

  for (let attempt = 0; attempt < 20; attempt++) {
    const pipeline = sharp(input, { failOn: "none" }).rotate().resize({
      width: maxEdge,
      height: maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    });

    let output;

    if (inputFormat === "PNG") {
      output = await pipeline
        .png({ compressionLevel: 9, palette: false })
        .toBuffer({ resolveWithObject: true });
    } else if (inputFormat === "WEBP") {
      output = await pipeline
        .webp({ quality })
        .toBuffer({ resolveWithObject: true });
    } else {
      output = await pipeline
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
    }

    const { width, height, size, format } = output.info;

    if (
      size <= CLOUDINARY_MAX_BYTES &&
      width * height <= CLOUDINARY_MAX_PIXELS
    ) {
      return {
        buffer: output.data,
        width,
        height,
        bytes: size,
        format: format === "jpeg" ? "jpg" : format,
        quality,
        maxEdge,
      };
    }

    if (quality > 60) {
      quality -= 5;
    } else if (maxEdge > 1024) {
      maxEdge -= 256;
    } else {
      break;
    }
  }

  throw new Error(`Could not resize ${audit.uuid} below Cloudinary limits`);
}

/**
 * Returns the MIME type for a Cloudinary image format.
 * @param {string} format - image format
 * @returns {string} - MIME type
 */
function getMimeType(format) {
  return format === "jpg" ? "image/jpeg" : `image/${format}`;
}

/**
 * Uploads one image to Cloudinary using signed Basic authentication.
 * @param {object} audit - source audit details
 * @param {object|null} resized - resized image details, if applicable
 * @returns {Promise<object>} - Cloudinary upload response
 */
async function uploadToCloudinary(audit, resized) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const form = new FormData();

  if (resized) {
    form.append(
      "file",
      new Blob([resized.buffer], { type: getMimeType(resized.format) }),
      `${audit.uuid}.${resized.format}`
    );
  } else {
    form.append("file", audit.sourceURL);
  }

  form.append("public_id", `blog/${audit.uuid}`);
  form.append("asset_folder", "blog");
  form.append("overwrite", "false");
  form.append("unique_filename", "false");
  form.append("use_filename", "false");
  form.append("tags", "uploadcare-migration");

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString(
          "base64"
        )}`,
      },
      body: form,
    }
  );

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(
      `Cloudinary upload failed for ${audit.uuid}: ${
        response.status
      } ${JSON.stringify(data)}`
    );
  }

  if (data.public_id !== `blog/${audit.uuid}`) {
    throw new Error(
      `Cloudinary returned unexpected public_id for ${audit.uuid}: ${data.public_id}`
    );
  }

  return data;
}

/**
 * Returns a canonical Cloudinary delivery URL without transformations.
 * @param {object} upload - Cloudinary upload response
 * @returns {string} - canonical URL
 */
function getCanonicalCloudinaryURL(upload) {
  return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/v${upload.version}/${upload.public_id}.${upload.format}`;
}

/**
 * Verifies that a Cloudinary asset is readable and within the Free limits.
 * @param {string} cloudinaryURL - canonical Cloudinary URL
 * @returns {Promise<object>} - verified metadata
 */
async function verifyCloudinaryAsset(cloudinaryURL) {
  const infoURL = getCloudinaryURL(cloudinaryURL, "fl_getinfo");
  const response = await fetch(infoURL);

  if (!response.ok) {
    throw new Error(
      `Cloudinary getinfo failed for ${cloudinaryURL}: ${response.status}`
    );
  }

  const info = await response.json();
  const input = info.input || info;

  if (!input.width || !input.height) {
    throw new Error(
      `Cloudinary returned incomplete metadata for ${cloudinaryURL}`
    );
  }

  if (input.bytes > CLOUDINARY_MAX_BYTES) {
    throw new Error(
      `Cloudinary asset exceeds 10 MB: ${cloudinaryURL} (${input.bytes} bytes)`
    );
  }

  if (input.width * input.height > CLOUDINARY_MAX_PIXELS) {
    throw new Error(
      `Cloudinary asset exceeds 25 MP: ${cloudinaryURL} (${input.width}x${input.height})`
    );
  }

  return input;
}

/**
 * Loads migration-map.json if it exists.
 * @returns {object} - migration map
 */
function loadMigrationMap() {
  if (!fs.existsSync(MAP_PATH)) {
    return { cloudName: process.env.CLOUDINARY_CLOUD_NAME, images: [] };
  }

  return JSON.parse(fs.readFileSync(MAP_PATH, "utf8"));
}

/**
 * Saves migration-map.json.
 * @param {object} map - migration map
 */
function saveMigrationMap(map) {
  map.generatedAt = new Date().toISOString();
  fs.writeFileSync(MAP_PATH, `${JSON.stringify(map, null, 2)}\n`);
}

/**
 * Rewrites every Uploadcare URL in src/ to its canonical Cloudinary URL.
 * @param {Map<string, object>} mapByUuid - migration entries keyed by UUID
 * @returns {{files: number, replacements: number}} - rewrite summary
 */
function rewriteSourceFiles(mapByUuid) {
  let files = 0;
  let replacements = 0;

  for (const file of listFiles(SRC_DIR)) {
    if (!SOURCE_EXTENSIONS.has(path.extname(file))) continue;

    const content = fs.readFileSync(file, "utf8");
    let fileReplacements = 0;

    const newContent = content.replace(
      createUploadcareURLRegex(),
      (match, uuid) => {
        const entry = mapByUuid.get(uuid.toLowerCase());

        if (!entry || !entry.cloudinaryURL) return match;

        fileReplacements++;
        return entry.cloudinaryURL;
      }
    );

    if (fileReplacements > 0) {
      fs.writeFileSync(file, newContent);
      files++;
      replacements += fileReplacements;
      console.log(
        `  rewrote ${fileReplacements} URL(s) in ${path.relative(ROOT, file)}`
      );
    }
  }

  return { files, replacements };
}

/**
 * Returns remaining Uploadcare URLs in src/.
 * @returns {{file: string, url: string}[]} - remaining URLs
 */
function findRemainingUploadcareURLs() {
  const remaining = [];

  for (const file of listFiles(SRC_DIR)) {
    if (!SOURCE_EXTENSIONS.has(path.extname(file))) continue;

    const content = fs.readFileSync(file, "utf8");

    for (const match of content.matchAll(createUploadcareURLRegex())) {
      remaining.push({
        file: path.relative(ROOT, file),
        url: match[0],
      });
    }
  }

  return remaining;
}

/**
 * Runs the migration.
 */
async function main() {
  loadEnvFiles();

  const requiredEnv = [
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ];

  for (const name of requiredEnv) {
    if (!process.env[name]) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
  }

  const occurrences = findUploadcareOccurrences();
  const map = loadMigrationMap();
  const mapByUuid = new Map(map.images.map((entry) => [entry.uuid, entry]));

  console.log(
    `Found ${occurrences.length} unique Uploadcare image(s) across ${
      new Set(occurrences.flatMap((item) => [...item.files])).size
    } file(s).`
  );

  if (dryRun) {
    console.log(
      "Dry run: auditing only; nothing will be uploaded or rewritten.\n"
    );
  }

  const failures = [];
  let processed = 0;

  for (const occurrence of occurrences) {
    processed++;
    const { uuid } = occurrence;
    let entry = mapByUuid.get(uuid);

    try {
      const audit = await auditUploadcareAsset(uuid);
      const resizeNote = audit.needsResize ? "needs resize" : "within limits";

      console.log(
        `[${processed}/${occurrences.length}] ${uuid} ${audit.format} ${
          audit.width
        }x${audit.height} ${(audit.bytes / 1e6).toFixed(2)} MB (${resizeNote})`
      );

      if (dryRun) {
        if (audit.needsResize) {
          const resized = await createResizedImage(audit);
          console.log(
            `  would resize to ${resized.width}x${resized.height} ${(
              resized.bytes / 1e6
            ).toFixed(2)} MB (q${resized.quality}, max ${resized.maxEdge}px)`
          );
        }
        continue;
      }

      if (!entry || !entry.cloudinaryURL) {
        const resized = audit.needsResize
          ? await createResizedImage(audit)
          : null;

        if (resized) {
          console.log(
            `  resized to ${resized.width}x${resized.height} ${(
              resized.bytes / 1e6
            ).toFixed(2)} MB (q${resized.quality}, max ${resized.maxEdge}px)`
          );
        }

        const upload = await uploadToCloudinary(audit, resized);
        const cloudinaryURL = getCanonicalCloudinaryURL(upload);

        entry = {
          uuid,
          sourceURL: audit.sourceURL,
          cloudinaryURL,
          source: {
            bytes: audit.bytes,
            width: audit.width,
            height: audit.height,
            format: audit.format,
          },
          uploaded: {
            bytes: upload.bytes,
            width: upload.width,
            height: upload.height,
            format: upload.format,
            version: upload.version,
            publicId: upload.public_id,
            assetFolder: upload.asset_folder || null,
            existing: Boolean(upload.existing),
          },
          resized: Boolean(resized),
          resize: resized
            ? {
                maxEdge: resized.maxEdge,
                quality: resized.quality,
                width: resized.width,
                height: resized.height,
                bytes: resized.bytes,
              }
            : null,
        };

        mapByUuid.set(uuid, entry);
        map.images = [...mapByUuid.values()].sort((a, b) =>
          a.uuid.localeCompare(b.uuid)
        );
        saveMigrationMap(map);

        const existingNote = upload.existing ? " (already existed)" : "";
        console.log(`  uploaded ${cloudinaryURL}${existingNote}`);
      } else {
        console.log(`  already in migration-map.json: ${entry.cloudinaryURL}`);
      }
    } catch (error) {
      failures.push({ uuid, error: error.message });
      console.error(`  failed: ${error.message}`);
    }
  }

  if (failures.length > 0) {
    saveMigrationMap(map);
    console.error(
      `\n${failures.length} image(s) failed. migration-map.json was saved; no source URLs were rewritten.`
    );
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    console.log("\nDry run complete. No uploads or source rewrites were made.");
    return;
  }

  console.log("\nVerifying Cloudinary assets...");

  for (const entry of map.images) {
    try {
      const verified = await verifyCloudinaryAsset(entry.cloudinaryURL);
      entry.verified = {
        bytes: verified.bytes,
        width: verified.width,
        height: verified.height,
      };
    } catch (error) {
      failures.push({ uuid: entry.uuid, error: error.message });
      console.error(`  failed: ${error.message}`);
    }
  }

  saveMigrationMap(map);

  if (failures.length > 0) {
    console.error(
      `\n${failures.length} image(s) could not be verified. No source URLs were rewritten.`
    );
    process.exitCode = 1;
    return;
  }

  console.log("All Cloudinary assets verified within Free limits.");

  const rewrite = rewriteSourceFiles(mapByUuid);
  console.log(
    `\nRewrote ${rewrite.replacements} URL(s) across ${rewrite.files} file(s).`
  );

  const remaining = findRemainingUploadcareURLs();

  if (remaining.length > 0) {
    console.error("\nRemaining Uploadcare URLs in src/:");

    for (const item of remaining) {
      console.error(`  ${item.file}: ${item.url}`);
    }

    process.exitCode = 1;
    return;
  }

  console.log("No Uploadcare URLs remain in src/.");
  console.log(`Migration map saved to ${path.relative(ROOT, MAP_PATH)}.`);
  console.log("Uploadcare assets were not modified.");
}

main().catch((error) => {
  console.error(`\nMigration failed: ${error.message}`);
  process.exitCode = 1;
});
