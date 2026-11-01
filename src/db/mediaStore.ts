import { MEDIA, idbGet, idbKeys, idbPut } from "./idb";
import type { MediaStore } from "./media";

export const idbMediaStore: MediaStore = {
  get: (sha) => idbGet<Uint8Array>(MEDIA, sha),
  put: (sha, b) => idbPut(MEDIA, sha, b),
  has: async (sha) => (await idbGet<Uint8Array>(MEDIA, sha)) !== null,
};
export const mediaKeys = () => idbKeys(MEDIA);
