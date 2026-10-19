import { isNativeApp } from "./platform";

/**
 * Native camera / gallery. Returns a data URL (the same thing the web file input produced), or null when
 * the user cancelled. Throws an Error with a user-readable message when permission is refused.
 * In a browser this returns "unsupported" so callers keep using their <input type="file">.
 */
export async function nativePhoto(source: "camera" | "gallery"): Promise<string | null | "unsupported"> {
  if (!isNativeApp()) return "unsupported";
  const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
  try {
    const photo = await Camera.getPhoto({
      // Evidence photos keep their quality here; they are downscaled once, in compressImageForUpload, to 1600 px.
      quality: 92,
      resultType: CameraResultType.DataUrl,
      source: source === "camera" ? CameraSource.Camera : CameraSource.Photos,
      correctOrientation: true,
      saveToGallery: false,
      width: 2400,
    });
    return photo.dataUrl ?? null;
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? e);
    if (/cancel/i.test(msg)) return null;
    if (/denied|permission/i.test(msg)) throw new Error("Camera permission is off. Allow Camera for Intense Care in Android Settings → Apps → Intense Care → Permissions.");
    throw new Error("The camera couldn't be opened. Try again.");
  }
}

/** Scans one QR code with Google's code-scanner (no camera permission needed). null = cancelled, "unsupported" = use the web scanner. */
export async function nativeScanQr(): Promise<string | null | "unsupported"> {
  if (!isNativeApp()) return "unsupported";
  try {
    const { BarcodeScanner, BarcodeFormat } = await import("@capacitor-mlkit/barcode-scanning");
    const support = await BarcodeScanner.isSupported();
    if (!support.supported) return "unsupported";
    const res = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
    return res.barcodes[0]?.rawValue ?? null;
  } catch (e) {
    const msg = String((e as { message?: string })?.message ?? e);
    if (/cancel/i.test(msg)) return null;
    return "unsupported";
  }
}
