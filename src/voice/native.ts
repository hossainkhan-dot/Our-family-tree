import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { Clip } from "./model";

/** ফোনের নেটিভ অংশ (native/android/VoicePacksPlugin.java)। শুধু Android অ্যাপে আছে; ব্রাউজারে নেই। */
export interface NativeState { json: string; activeId: string | null; running: boolean; overlayGranted: boolean; notifGranted: boolean; sdk: number }
export interface PickResult { cancelled: boolean; files: Clip[]; failed: { name: string; reason: string }[] }
export interface VoicePacksNative {
  getState(): Promise<NativeState>;
  save(o: { json: string }): Promise<void>;
  setActive(o: { id: string | null }): Promise<void>;
  pickAudio(): Promise<PickResult>;
  purge(): Promise<{ removed: number }>;
  play(o: { file: string; volume: number; speaker: boolean }): Promise<void>;
  stopAll(): Promise<void>;
  requestOverlayPermission(): Promise<void>;
  requestNotificationPermission(): Promise<{ granted: boolean }>;
  startOverlay(): Promise<void>;
  stopOverlay(): Promise<void>;
  addListener(event: "activeChanged", fn: (e: { id?: string | null }) => void): Promise<PluginListenerHandle>;
  addListener(event: "overlayState", fn: (e: { running: boolean }) => void): Promise<PluginListenerHandle>;
}

export const voiceSupported = (): boolean => Capacitor.getPlatform() === "android";
export const VP = registerPlugin<VoicePacksNative>("VoicePacks");
