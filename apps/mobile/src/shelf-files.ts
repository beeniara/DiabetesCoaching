import { Directory, File, Paths } from "expo-file-system";

const SHELF_PHOTO_DIRECTORY = "shelf-photos";
const MAX_ANALYSIS_PHOTO_BYTES = 6 * 1024 * 1024;

function getShelfPhotoDirectory() {
  return new Directory(Paths.document, SHELF_PHOTO_DIRECTORY);
}

function isOwnedShelfPhoto(uri: string) {
  const directoryUri = getShelfPhotoDirectory().uri;
  const prefix = directoryUri.endsWith("/") ? directoryUri : `${directoryUri}/`;
  return uri.startsWith(prefix);
}

export async function persistShelfPhoto(sourceUri: string, id: string) {
  const directory = getShelfPhotoDirectory();
  directory.create({ idempotent: true, intermediates: true });
  const source = new File(sourceUri);
  if (!source.exists) throw new Error("The selected photo is no longer available.");
  const extension = /^\.[a-z0-9]{1,5}$/i.test(source.extension) ? source.extension.toLowerCase() : ".jpg";
  const destination = new File(directory, `${id}${extension}`);
  await source.copy(destination, { overwrite: true });
  return destination.uri;
}

export function deleteOwnedShelfPhoto(uri: string) {
  if (!isOwnedShelfPhoto(uri)) return false;
  const file = new File(uri);
  if (file.exists) file.delete();
  return true;
}

export async function readShelfPhotoDataUrl(uri: string) {
  if (!isOwnedShelfPhoto(uri)) throw new Error("Only an app-owned shelf photo can be sent for analysis.");
  const file = new File(uri);
  if (!file.exists) throw new Error("The local shelf photo is missing.");
  const info = file.info();
  if ((info.size ?? 0) > MAX_ANALYSIS_PHOTO_BYTES) {
    throw new Error("The photo is too large for local-server analysis. Capture a smaller image and retry.");
  }
  const extension = file.extension.toLowerCase();
  const mimeType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mimeType};base64,${await file.base64()}`;
}
