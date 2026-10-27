/*
 * Word Crawler: ZIP minimale.
 * Lettura (per DOCX, ODT, PPTX, XLSX, EPUB): file "stored" e "deflate", e ZIP64.
 * Scrittura (per esportare i documenti Word): file compressi con deflate quando il browser lo permette.
 * La (de)compressione usa (De)CompressionStream del browser oppure zlib di Node.
 */
(function (g) {
  'use strict';
  if (g.WCZip) return;

  function u16(v, o) { return v.getUint16(o, true); }
  function u32(v, o) { return v.getUint32(o, true); }
  function u64(v, o) { return v.getUint32(o, true) + v.getUint32(o + 4, true) * 4294967296; }

  function defaultInflate(bytes) {
    if (typeof DecompressionStream !== 'undefined') {
      var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
    }
    if (typeof require === 'function') {
      return Promise.resolve(new Uint8Array(require('zlib').inflateRawSync(bytes)));
    }
    return Promise.reject(new Error('Decompressione non disponibile'));
  }

  function isZip(bytes) {
    return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5) && (bytes[3] === 4 || bytes[3] === 6);
  }

  function open(buffer, options) {
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var inflate = (options && options.inflateRaw) || defaultInflate;
    var len = bytes.length;

    // fine della directory centrale (cercata negli ultimi 64 KB)
    var eocd = -1;
    for (var i = len - 22; i >= Math.max(0, len - 65557); i--) {
      if (u32(view, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Archivio ZIP non valido o danneggiato');
    var count = u16(view, eocd + 10);
    var cdOffset = u32(view, eocd + 16);
    if (cdOffset === 0xffffffff || count === 0xffff) {
      var loc = eocd - 20;
      if (loc >= 0 && u32(view, loc) === 0x07064b50) {
        var z64 = u64(view, loc + 8);
        if (u32(view, z64) === 0x06064b50) { count = u64(view, z64 + 32); cdOffset = u64(view, z64 + 48); }
      }
    }

    var dec = new TextDecoder('utf-8');
    var entries = new Map();
    var p = cdOffset;
    for (var n = 0; n < count; n++) {
      if (p + 46 > len || u32(view, p) !== 0x02014b50) throw new Error('Directory ZIP danneggiata');
      var method = u16(view, p + 10);
      var csize = u32(view, p + 20), usize = u32(view, p + 24);
      var nameLen = u16(view, p + 28), extraLen = u16(view, p + 30), commentLen = u16(view, p + 32);
      var local = u32(view, p + 42);
      var name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      // campi ZIP64 nell'extra
      var e = p + 46 + nameLen, eEnd = e + extraLen;
      while (e + 4 <= eEnd) {
        var id = u16(view, e), sz = u16(view, e + 2), q = e + 4;
        if (id === 0x0001) {
          if (usize === 0xffffffff) { usize = u64(view, q); q += 8; }
          if (csize === 0xffffffff) { csize = u64(view, q); q += 8; }
          if (local === 0xffffffff) { local = u64(view, q); q += 8; }
        }
        e += 4 + sz;
      }
      entries.set(name, { name: name, method: method, csize: csize, usize: usize, local: local });
      p += 46 + nameLen + extraLen + commentLen;
    }

    function raw(entry) {
      var lp = entry.local;
      if (u32(view, lp) !== 0x04034b50) throw new Error('Voce ZIP danneggiata: ' + entry.name);
      var start = lp + 30 + u16(view, lp + 26) + u16(view, lp + 28);
      return bytes.subarray(start, start + entry.csize);
    }

    return {
      names: function () { return Array.from(entries.keys()); },
      has: function (name) { return entries.has(name); },
      bytes: function (name) {
        var entry = entries.get(name);
        if (!entry) return Promise.reject(new Error('Manca ' + name));
        if (entry.method === 0) return Promise.resolve(raw(entry).slice());
        if (entry.method === 8) return inflate(raw(entry));
        return Promise.reject(new Error('Compressione non supportata in ' + name));
      },
      text: function (name) {
        return this.bytes(name).then(function (b) { return new TextDecoder('utf-8').decode(b); });
      }
    };
  }

  // ------------------------------------------------------------ scrittura
  var CRC = null;
  function crc32(bytes) {
    if (!CRC) {
      CRC = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        CRC[n] = c >>> 0;
      }
    }
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) crc = CRC[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function deflateRaw(bytes) {
    if (typeof CompressionStream !== 'undefined') {
      var stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
    }
    if (typeof require === 'function') return Promise.resolve(new Uint8Array(require('zlib').deflateRawSync(bytes)));
    return Promise.resolve(null);
  }

  /*
   * Crea un archivio ZIP. files: [{ name, data: stringa (UTF-8) o Uint8Array }]
   * Restituisce Promise<Uint8Array>.
   */
  function write(files) {
    var enc = new TextEncoder();
    var d = new Date();
    var dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    var dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return Promise.all(files.map(function (f) {
      var data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      return (data.length > 64 ? deflateRaw(data) : Promise.resolve(null)).then(function (z) {
        var use = z && z.length < data.length;
        return { name: enc.encode(f.name), data: data, comp: use ? z : data, method: use ? 8 : 0, crc: crc32(data) };
      });
    })).then(function (items) {
      var size = 22;
      items.forEach(function (it) { size += 30 + it.name.length + it.comp.length + 46 + it.name.length; });
      var out = new Uint8Array(size), v = new DataView(out.buffer), p = 0;
      function u16(x) { v.setUint16(p, x, true); p += 2; }
      function u32(x) { v.setUint32(p, x >>> 0, true); p += 4; }
      items.forEach(function (it) {
        it.offset = p;
        u32(0x04034b50); u16(20); u16(0x0800); u16(it.method); u16(dosTime); u16(dosDate);
        u32(it.crc); u32(it.comp.length); u32(it.data.length); u16(it.name.length); u16(0);
        out.set(it.name, p); p += it.name.length;
        out.set(it.comp, p); p += it.comp.length;
      });
      var cd = p;
      items.forEach(function (it) {
        u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(it.method); u16(dosTime); u16(dosDate);
        u32(it.crc); u32(it.comp.length); u32(it.data.length); u16(it.name.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(it.offset);
        out.set(it.name, p); p += it.name.length;
      });
      var cdSize = p - cd;
      u32(0x06054b50); u16(0); u16(0); u16(items.length); u16(items.length); u32(cdSize); u32(cd); u16(0);
      return out;
    });
  }

  g.WCZip = { open: open, isZip: isZip, write: write, crc32: crc32 };
})(globalThis);
