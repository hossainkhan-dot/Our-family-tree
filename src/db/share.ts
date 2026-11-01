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

/** একাধিক ফাইল একসঙ্গে (ভাগ-করা ZIP-এর সব অংশ): ফোনে একটি শেয়ার-শিটে সব ফাইল যায়; ব্রাউজারে একে একে নামে। */
export async function saveOrShareMany(files: { name: string; data: Uint8Array }[], mime: string): Promise<void> {
  if (files.length === 1) return saveOrShareBytes(files[0].name, files[0].data, mime);
  if (Capacitor.isNativePlatform()) {
    const uris: string[] = [];
    for (const f of files) {
      let bin = "";
      for (let i = 0; i < f.data.length; i += 0x8000) bin += String.fromCharCode(...f.data.subarray(i, i + 0x8000));
      uris.push((await Filesystem.writeFile({ path: f.name, data: btoa(bin), directory: Directory.Cache })).uri);
    }
    await Share.share({ title: files[0].name, files: uris, dialogTitle: `ব্যাকআপের ${files.length}টি ফাইল কোথায় রাখবেন?` });
    return;
  }
  for (const f of files) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([f.data as BlobPart], { type: mime }));
    a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    await new Promise((r) => setTimeout(r, 300));
  }
}
