import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { storage } from "../firebase/storage.js";

const AVATAR_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

export function isAvatarImage(file) {
  return !!file && AVATAR_TYPES.has(file.type) && file.size <= 5 * 1024 * 1024;
}

export function avatarInitial(name, fallback = "?") {
  return String(name || fallback || "?").trim().charAt(0).toUpperCase() || "?";
}

export async function resolveAvatarUrl(profile, user) {
  if (profile?.photoURL) return profile.photoURL;
  if (profile?.avatarUrl) return profile.avatarUrl;
  if (profile?.avatarPath) return getDownloadURL(ref(storage, profile.avatarPath));
  if (user?.photoURL) return user.photoURL;
  return "";
}

export async function uploadProfileAvatar(uid, file) {
  if (!uid) throw new Error("Sign in again before uploading a profile photo.");
  if (!isAvatarImage(file)) throw new Error("Upload a JPG, PNG, or WebP image under 5 MB.");

  const ext = AVATAR_TYPES.get(file.type);
  const avatarPath = `avatars/${uid}/profile.${ext}`;
  const avatarRef = ref(storage, avatarPath);
  await uploadBytes(avatarRef, file, {
    contentType: file.type,
    cacheControl: "public,max-age=3600"
  });
  const photoURL = await getDownloadURL(avatarRef);
  return { avatarPath, photoURL };
}
