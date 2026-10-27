/*
 * Word Crawler: lettore ZIP minimale (per DOCX, ODT, PPTX, XLSX, EPUB).
 * Solo lettura. Supporta file "stored" e "deflate", e ZIP64.
 * La decompressione usa DecompressionStream del browser oppure zlib di Node.
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

  g.WCZip = { open: open, isZip: isZip };
})(globalThis);
