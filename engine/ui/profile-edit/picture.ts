/** The browser's side of cropping: decoding a picture, drawing a crop on a canvas, encoding it as a WebP. Tested in a real browser (e2e/avatar.spec.ts); jsdom has no canvas. */
import { CropError, type Picture, type PictureIo } from './crops.ts';

function decode(src: string, crossOrigin: boolean, failure: string, release: () => void): Promise<Picture> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, url: src, source: img, release });
    img.onerror = () => { release(); reject(new CropError(failure)); };
    img.src = src;
  });
}

export const browserIo: PictureIo = {
  loadFile(file) {
    const url = URL.createObjectURL(file);
    return decode(url, false, 'That file is not a picture this browser can read. Choose a JPEG, PNG, WebP or GIF.', () => URL.revokeObjectURL(url));
  },
  loadUrl(url) {
    return decode(url, true, 'Your stored portrait could not be read back into this browser to cut a new square from it. Upload a picture again to set both.', () => {});
  },
  encode(picture, cut, out, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = out.width;
    canvas.height = out.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return Promise.reject(new CropError('This browser cannot cut pictures.'));
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(picture.source, cut.x, cut.y, cut.width, cut.height, 0, 0, out.width, out.height);
    return new Promise((resolve, reject) => {
      try {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new CropError('This browser could not save the crop as a picture.'))), 'image/webp', quality);
      } catch {
        /* A canvas that holds a picture from another origin without permission refuses to be read back. */
        reject(new CropError('Your stored portrait could not be read back into this browser to cut a new square from it. Upload a picture again to set both.'));
      }
    });
  },
};
