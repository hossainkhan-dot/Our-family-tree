import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

/** On the phone: opens the share sheet (save to Drive, Files, WhatsApp...). In a browser: normal download. */
export async function saveOrShare(filename: string, text: string, mime: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const r = await Filesystem.writeFile({ path: filename, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: filename, url: r.uri, dialogTitle: "ব্যাকআপ কোথায় রাখবেন?" });
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

/** Same as saveOrShare, for binary files (ZIP). */
export async function saveOrShareBytes(filename: string, bytes: Uint8Array, mime: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const r = await Filesystem.writeFile({ path: filename, data: btoa(bin), directory: Directory.Cache });
    await Share.share({ title: filename, url: r.uri, dialogTitle: "ব্যাকআপ কোথায় রাখবেন?" });
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}
