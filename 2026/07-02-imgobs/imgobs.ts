// ── PRNG ─────────────────────────────────────────────

/**
 * mulberry32 — 确定性 32 位种子 PRNG
 */
function mulberry32(seed: number): () => number {
  var s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates 洗牌 */
function permutation(n: number, seed: number): number[] {
  var arr: number[] = [];
  for (var i = 0; i < n; i++) arr.push(i);
  var rng = mulberry32(seed);
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(rng() * (i + 1));
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
  }
  return arr;
}

/** 逆排列 */
function argsort(perm: number[]): number[] {
  var idx: number[] = [];
  for (var i = 0; i < perm.length; i++) idx.push(i);
  idx.sort(function (a, b) { return perm[a] - perm[b]; });
  return idx;
}

// ── Obfuscator ───────────────────────────────────────

var BS = 8;
var HLF = 4;
var PPB = 2;
var SEED = 42;
var STRIP_H = 16;
var META_BLOCKS = 14;
var META_STRIP_W = 112;
var BIT2LUM = [32, 96, 160, 224];

function flattenRGBA(data: Uint8ClampedArray, n: number): Uint8Array {
  var out = new Uint8Array(n * 3);
  for (var i = 0, j = 0; i < n * 4; i += 4) {
    out[j++] = data[i];
    out[j++] = data[i + 1];
    out[j++] = data[i + 2];
  }
  return out;
}

function expandRGBA(pixels: Uint8Array, w: number, h: number): Uint8ClampedArray {
  var n = w * h;
  var out = new Uint8ClampedArray(n * 4);
  for (var i = 0, j = 0; i < n * 3; i += 3) {
    out[j++] = pixels[i];
    out[j++] = pixels[i + 1];
    out[j++] = pixels[i + 2];
    out[j++] = 255;
  }
  return out;
}

function makePairs(pixels: Uint8Array): Uint8Array {
  var n = pixels.length / 3;
  var m = Math.ceil(n / PPB);
  var out = new Uint8Array(m * 6);
  for (var i = 0; i < n; i++) {
    var dst = (i >> 1) * 6 + (i & 1) * 3;
    out[dst] = pixels[i * 3];
    out[dst + 1] = pixels[i * 3 + 1];
    out[dst + 2] = pixels[i * 3 + 2];
  }
  return out;
}

function padPairs(pairs: Uint8Array, target: number): Uint8Array {
  var need = target * 6;
  if (pairs.length >= need) return pairs;
  var out = new Uint8Array(need);
  out.set(pairs);
  return out;
}

function grid(W: number, H: number, nBlocks: number): [number, number] {
  var ratio = W / H;
  var cols = Math.round(Math.sqrt(nBlocks * ratio));
  var rows = Math.ceil(nBlocks / cols);
  cols = Math.ceil(nBlocks / rows);
  return [cols, rows];
}

function permuteBlocks(src: Uint8Array, order: number[]): Uint8Array {
  var n = order.length;
  var out = new Uint8Array(n * 6);
  for (var i = 0; i < n; i++) {
    var si = order[i] * 6;
    var di = i * 6;
    out[di] = src[si];
    out[di + 1] = src[si + 1];
    out[di + 2] = src[si + 2];
    out[di + 3] = src[si + 3];
    out[di + 4] = src[si + 4];
    out[di + 5] = src[si + 5];
  }
  return out;
}

function renderBlocks(pairs: Uint8Array, cols: number): Uint8ClampedArray {
  var rows = pairs.length / 6 / cols;
  var outW = cols * BS, outH = rows * BS;
  var buf = new Uint8ClampedArray(outW * outH * 4);
  var view = new Uint32Array(buf.buffer);
  for (var i = 0; i < cols * rows; i++) {
    var r = (i / cols) | 0, c = i % cols;
    var r0 = r * BS, c0 = c * BS;
    var p0 = pairs[i * 6] | (pairs[i * 6 + 1] << 8) | (pairs[i * 6 + 2] << 16) | (255 << 24);
    var p1 = pairs[i * 6 + 3] | (pairs[i * 6 + 4] << 8) | (pairs[i * 6 + 5] << 16) | (255 << 24);
    for (var dy = 0; dy < BS; dy++) {
      var rowOff = (r0 + dy) * outW + c0;
      for (var dx = 0; dx < HLF; dx++) view[rowOff + dx] = p0;
      for (var dx = HLF; dx < BS; dx++) view[rowOff + dx] = p1;
    }
  }
  return buf;
}

function extractBlocks(data: Uint8ClampedArray, cols: number, rows: number, stride: number): Uint8Array {
  var totalBlocks = cols * rows;
  var pairs = new Uint8Array(totalBlocks * 6);
  var view = new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4);
  var n = BS * HLF;
  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      var idx = r * cols + c;
      var y0 = r * BS, x0 = c * BS;
      var s0 = 0, s1 = 0, s2 = 0;
      for (var dy = 0; dy < BS; dy++) {
        var rowOff = (y0 + dy) * stride + x0;
        for (var dx = 0; dx < HLF; dx++) {
          var pxl = view[rowOff + dx];
          s0 += pxl & 0xff; s1 += (pxl >>> 8) & 0xff; s2 += (pxl >>> 16) & 0xff;
        }
      }
      pairs[idx * 6] = Math.round(s0 / n);
      pairs[idx * 6 + 1] = Math.round(s1 / n);
      pairs[idx * 6 + 2] = Math.round(s2 / n);
      s0 = 0; s1 = 0; s2 = 0;
      for (var dy = 0; dy < BS; dy++) {
        var rowOff = (y0 + dy) * stride + x0;
        for (var dx = HLF; dx < BS; dx++) {
          var pxl = view[rowOff + dx];
          s0 += pxl & 0xff; s1 += (pxl >>> 8) & 0xff; s2 += (pxl >>> 16) & 0xff;
        }
      }
      pairs[idx * 6 + 3] = Math.round(s0 / n);
      pairs[idx * 6 + 4] = Math.round(s1 / n);
      pairs[idx * 6 + 5] = Math.round(s2 / n);
    }
  }
  return pairs;
}

function encodeMetaStrip(W: number, H: number, gridBuf: Uint8ClampedArray, outW: number): Uint8ClampedArray {
  var strip = new Uint8ClampedArray(outW * STRIP_H * 4);
  var bits: number[] = [];
  for (var b = 3; b >= 0; b--) bits.push((0xa >> b) & 1);
  for (var b = 11; b >= 0; b--) bits.push((W >> b) & 1);
  for (var b = 11; b >= 0; b--) bits.push((H >> b) & 1);
  var npad = META_BLOCKS * 2 - bits.length;
  for (var i = 0; i < npad; i++) bits.push(0);
  for (var mb = 0; mb < META_BLOCKS; mb++) {
    var hi = bits[mb * 2], lo = bits[mb * 2 + 1];
    var lum = BIT2LUM[(hi << 1) | lo];
    var bx = mb * BS;
    for (var j = 0; j < STRIP_H; j++) {
      for (var i = 0; i < BS; i++) {
        var idx = (j * outW + bx + i) * 4;
        strip[idx] = lum; strip[idx + 1] = lum; strip[idx + 2] = lum; strip[idx + 3] = 255;
      }
    }
  }
  var full = new Uint8ClampedArray(gridBuf.length + strip.length);
  full.set(gridBuf);
  full.set(strip, gridBuf.length);
  return full;
}

function decodeMetaStrip(data: Uint8ClampedArray, totalW: number): [number, number] {
  var base = (data.length / 4) - STRIP_H * totalW;
  var bits: number[] = [];
  for (var mb = 0; mb < META_BLOCKS; mb++) {
    var cx = mb * BS + 4;
    var idx = (base + 4 * totalW + cx) * 4;
    var lum = data[idx];
    var val = [32, 96, 160, 224].reduce(function (p, c) {
      return Math.abs(c - lum) < Math.abs(p - lum) ? c : p;
    });
    var code = val === 224 ? 3 : val === 160 ? 2 : val === 96 ? 1 : 0;
    bits.push((code >> 1) & 1, code & 1);
  }
  var w = 0, h = 0;
  for (var i = 0; i < 12; i++) w = (w << 1) | bits[4 + i];
  for (var i = 0; i < 12; i++) h = (h << 1) | bits[16 + i];
  return [w, h];
}

class PixelObfuscator {
  seed: number;

  constructor(seed?: number) {
    this.seed = seed !== undefined ? seed : SEED;
  }

  obfuscate(imageData: ImageData): ImageData {
    var W = imageData.width, H = imageData.height, data = imageData.data;
    var nPixels = W * H;
    var pixels = flattenRGBA(data, nPixels);
    var nBlocks = (nPixels + PPB - 1) / PPB | 0;
    var cg = grid(W, H, nBlocks);
    var cols = cg[0], rows = cg[1];
    var totalBlocks = cols * rows;
    if (cols * BS < META_STRIP_W) {
      cols = Math.ceil(META_STRIP_W / BS);
    }
    totalBlocks = cols * rows;
    var pairs = makePairs(pixels);
    pairs = padPairs(pairs, totalBlocks);
    var perm = permutation(totalBlocks, this.seed);
    pairs = permuteBlocks(pairs, perm);
    var outW = cols * BS, outH = rows * BS;
    var gridBuf = renderBlocks(pairs, cols);
    var fullBuf = encodeMetaStrip(W, H, gridBuf, outW);
    return new ImageData(fullBuf as unknown as Uint8ClampedArray, outW, outH + STRIP_H);
  }

  recover(imageData: ImageData): ImageData {
    var totalW = imageData.width, totalH = imageData.height;
    var outH = totalH - STRIP_H;
    var cols = totalW / BS, rows = outH / BS;
    var totalBlocks = cols * rows;
    var data = imageData.data;
    var dims = decodeMetaStrip(data, totalW);
    var recW = dims[0], recH = dims[1];
    var pairs = extractBlocks(data, cols, rows, totalW);
    var perm = permutation(totalBlocks, this.seed);
    var inv = argsort(perm);
    var restored = permuteBlocks(pairs, inv);
    var outData = expandRGBA(restored, recW, recH);
    return new ImageData(outData as unknown as Uint8ClampedArray, recW, recH);
  }
}

// ── UI 逻辑 ──────────────────────────────────────────

var MAX_SIZE = 1920;
var origImg: HTMLImageElement | null = null;
var origFileName = '';
var obfuscator = new PixelObfuscator();

function cacheRefs() {
  // 已存在时跳过
}

function get(id: string): HTMLElement { return document.getElementById(id)!; }

function setStatus(msg: string) {
  get('status').textContent = msg;
}

function downloadCanvas(canvas: HTMLCanvasElement, filename: string, quality?: number) {
  if (quality === undefined) quality = 0.60;
  canvas.toBlob(function (blob) {
    if (!blob) { setStatus('导出失败'); return; }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }, 'image/jpeg', quality);
}

function loadImageData(img: HTMLImageElement, w?: number, h?: number): ImageData {
  var cw = w !== undefined ? w : img.naturalWidth;
  var ch = h !== undefined ? h : img.naturalHeight;
  var c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  var ctx = c.getContext('2d')!;
  if (w) ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, cw, ch);
  return ctx.getImageData(0, 0, cw, ch);
}

function loadImage(file: File) {
  var reader = new FileReader();
  reader.onload = function () {
    var img = new Image();
    img.onload = function () {
      origImg = img;
      origFileName = file.name.replace(/\.[^.]+$/, '');
      var origCanvas = get('origCanvas') as HTMLCanvasElement;
      origCanvas.width = img.naturalWidth;
      origCanvas.height = img.naturalHeight;
      origCanvas.getContext('2d')!.drawImage(img, 0, 0);
      get('gallery').hidden = false;
      (get('obfBtn') as HTMLButtonElement).disabled = false;
      (get('recBtn') as HTMLButtonElement).disabled = false;
      (get('dlObfBtn') as HTMLButtonElement).disabled = true;
      (get('dlRecBtn') as HTMLButtonElement).disabled = true;
      (get('obfCanvas') as HTMLCanvasElement).width = 0;
      (get('obfCanvas') as HTMLCanvasElement).height = 0;
      (get('recCanvas') as HTMLCanvasElement).width = 0;
      (get('recCanvas') as HTMLCanvasElement).height = 0;
      setStatus('已加载: ' + file.name + ' (' + img.naturalWidth + 'x' + img.naturalHeight + ')');
    };
    img.src = reader.result as string;
  };
  reader.readAsDataURL(file);
}

// ── 初始化：上传区 ────────────────────────────────────

export function initUpload() {
  var dropZone = get('dropZone');
  var fileInput = get('fileInput') as HTMLInputElement;

  dropZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', function () {
    dropZone.classList.remove('drag-over');
  });
  dropZone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    var dt = (e as DragEvent).dataTransfer;
    var file = dt ? dt.files[0] : null;
    if (file && file.type.startsWith('image/')) loadImage(file);
  });
  dropZone.addEventListener('click', function () { fileInput.click(); });
  fileInput.addEventListener('change', function () {
    var file = fileInput.files ? fileInput.files[0] : null;
    if (file) loadImage(file);
  });
}

// ── 初始化：画廊区 ────────────────────────────────────

export function initGallery() {
  var obfBtn = get('obfBtn') as HTMLButtonElement;
  var recBtn = get('recBtn') as HTMLButtonElement;
  var dlObfBtn = get('dlObfBtn') as HTMLButtonElement;
  var dlRecBtn = get('dlRecBtn') as HTMLButtonElement;
  var obfCanvas = get('obfCanvas') as HTMLCanvasElement;
  var recCanvas = get('recCanvas') as HTMLCanvasElement;

  obfBtn.addEventListener('click', function () {
    if (!origImg) return;
    setStatus('混淆中…');
    obfBtn.disabled = true;
    var w = origImg.naturalWidth;
    var h = origImg.naturalHeight;
    var tw = w, th = h;
    if (w > MAX_SIZE || h > MAX_SIZE) {
      var s = MAX_SIZE / Math.max(w, h);
      tw = Math.round(w * s);
      th = Math.round(h * s);
    }
    if (tw % 2 !== 0) tw++;
    if (th % 2 !== 0) th++;

    requestAnimationFrame(function () {
      var data = loadImageData(origImg!, tw, th);
      var result = obfuscator.obfuscate(data);
      obfCanvas.width = result.width;
      obfCanvas.height = result.height;
      obfCanvas.getContext('2d')!.putImageData(result, 0, 0);
      dlObfBtn.disabled = false;
      obfBtn.disabled = false;
      setStatus('混淆完成 → ' + result.width + 'x' + result.height);
    });
  });

  recBtn.addEventListener('click', function () {
    setStatus('恢复中…');
    recBtn.disabled = true;

    requestAnimationFrame(function () {
      var data: ImageData;
      if (obfCanvas.width > 0) {
        var ctx = obfCanvas.getContext('2d')!;
        data = ctx.getImageData(0, 0, obfCanvas.width, obfCanvas.height);
      } else if (origImg) {
        data = loadImageData(origImg);
      } else {
        setStatus('没有可恢复的数据');
        recBtn.disabled = false;
        return;
      }

      var result = obfuscator.recover(data);
      recCanvas.width = result.width;
      recCanvas.height = result.height;
      recCanvas.getContext('2d')!.putImageData(result, 0, 0);
      dlRecBtn.disabled = false;
      recBtn.disabled = false;
      setStatus('恢复完成 → ' + result.width + 'x' + result.height);
    });
  });

  dlObfBtn.addEventListener('click', function () {
    downloadCanvas(obfCanvas, origFileName + '_obfuscated.jpg');
  });
  dlRecBtn.addEventListener('click', function () {
    downloadCanvas(recCanvas, origFileName + '_recovered.jpg', 0.85);
  });
}
