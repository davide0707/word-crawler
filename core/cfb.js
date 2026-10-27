// Copyright (c) 2026 Davide Di Filippo. Tutti i diritti riservati. Vedi LICENSE.
/*
 * Word Crawler: lettore dei vecchi file Word 97-2003 (.doc).
 * Legge il contenitore "Compound File" (CFB), poi il testo del documento attraverso
 * la tabella dei pezzi (piece table) descritta nella specifica MS-DOC.
 * Solo testo: niente stili, immagini o tabelle complesse.
 */
(function (g) {
  'use strict';
  if (g.WCCfb) return;

  var SIG = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  var FREE = 0xffffffff, END = 0xfffffffe;

  function isCfb(bytes) {
    if (bytes.length < 512) return false;
    for (var i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) return false;
    return true;
  }

  function openCfb(buffer) {
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (!isCfb(bytes)) throw new Error('Non è un file Office 97-2003');
    var secSize = 1 << v.getUint16(0x1e, true);
    var miniSize = 1 << v.getUint16(0x20, true);
    var nFat = v.getUint32(0x2c, true);
    var dirStart = v.getUint32(0x30, true);
    var miniCutoff = v.getUint32(0x38, true);
    var miniFatStart = v.getUint32(0x3c, true);
    var difatStart = v.getUint32(0x44, true);
    var nDifat = v.getUint32(0x48, true);

    function secOff(s) { return (s + 1) * secSize; }

    // DIFAT -> settori della FAT
    var fatSecs = [];
    for (var i = 0; i < 109 && fatSecs.length < nFat; i++) {
      var s = v.getUint32(0x4c + i * 4, true);
      if (s !== FREE) fatSecs.push(s);
    }
    var ds = difatStart, guard = 0;
    while (fatSecs.length < nFat && ds !== END && ds !== FREE && guard++ < nDifat + 1) {
      var o = secOff(ds), per = secSize / 4 - 1;
      for (var k = 0; k < per && fatSecs.length < nFat; k++) {
        var x = v.getUint32(o + k * 4, true);
        if (x !== FREE) fatSecs.push(x);
      }
      ds = v.getUint32(o + per * 4, true);
    }
    var fat = new Uint32Array(fatSecs.length * secSize / 4);
    fatSecs.forEach(function (fs, n) {
      var off = secOff(fs);
      for (var k = 0; k < secSize / 4; k++) fat[n * secSize / 4 + k] = v.getUint32(off + k * 4, true);
    });

    function chain(start, table) {
      var out = [], s = start, seen = 0;
      while (s !== END && s !== FREE && s < table.length && seen++ < table.length) { out.push(s); s = table[s]; }
      return out;
    }
    function readFat(start, size) {
      var secs = chain(start, fat);
      var out = new Uint8Array(secs.length * secSize);
      secs.forEach(function (s, n) {
        var off = secOff(s);
        out.set(bytes.subarray(off, Math.min(off + secSize, bytes.length)), n * secSize);
      });
      return size != null ? out.subarray(0, size) : out;
    }

    // directory
    var dirBytes = readFat(dirStart);
    var dv = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
    var entries = [];
    for (var d = 0; d + 128 <= dirBytes.length; d += 128) {
      var nameLen = dv.getUint16(d + 0x40, true);
      if (!nameLen) { entries.push(null); continue; }
      var name = '';
      for (var c = 0; c < nameLen / 2 - 1; c++) name += String.fromCharCode(dv.getUint16(d + c * 2, true));
      entries.push({ name: name, type: dv.getUint8(d + 0x42), start: dv.getUint32(d + 0x74, true), size: dv.getUint32(d + 0x78, true) });
    }
    var root = entries[0];
    var miniStream = root ? readFat(root.start, root.size) : new Uint8Array(0);
    var miniFat = new Uint32Array(0);
    if (miniFatStart !== END && miniFatStart !== FREE) {
      var mfb = readFat(miniFatStart);
      miniFat = new Uint32Array(mfb.buffer.slice(mfb.byteOffset, mfb.byteOffset + mfb.byteLength));
    }

    function stream(name) {
      var e = entries.find(function (x) { return x && x.type === 2 && x.name === name; });
      if (!e) return null;
      if (e.size < miniCutoff) {
        var secs = chain(e.start, miniFat);
        var out = new Uint8Array(secs.length * miniSize);
        secs.forEach(function (s, n) { out.set(miniStream.subarray(s * miniSize, (s + 1) * miniSize), n * miniSize); });
        return out.subarray(0, e.size);
      }
      return readFat(e.start, e.size);
    }

    return { stream: stream, names: function () { return entries.filter(Boolean).map(function (e) { return e.name; }); } };
  }

  // Testo di un documento Word 97-2003
  function docText(buffer) {
    var cfb = openCfb(buffer);
    var wd = cfb.stream('WordDocument');
    if (!wd) {
      var names = cfb.names();
      if (names.indexOf('PowerPoint Document') >= 0) throw new Error('È una presentazione PowerPoint 97-2003 (.ppt): salvala come .pptx per leggerla.');
      if (names.indexOf('Workbook') >= 0 || names.indexOf('Book') >= 0) throw new Error('È un foglio Excel 97-2003 (.xls): salvalo come .xlsx per leggerlo.');
      throw new Error('File Office 97-2003 non riconosciuto');
    }
    var v = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
    if (v.getUint16(0, true) !== 0xa5ec) throw new Error('Documento Word non valido');
    var flags = v.getUint16(0x0a, true);
    if (flags & 0x0100) throw new Error('Il documento è protetto da password');
    var table = cfb.stream(flags & 0x0200 ? '1Table' : '0Table');
    if (!table) throw new Error('Documento Word incompleto (manca la tabella)');
    var ccpText = v.getInt32(0x4c, true);
    var fcClx = v.getUint32(0x1a2, true), lcbClx = v.getUint32(0x1a6, true);
    var tv = new DataView(table.buffer, table.byteOffset, table.byteLength);

    var p = fcClx, endClx = fcClx + lcbClx, pieces = null;
    while (p < endClx) {
      var clxt = table[p];
      if (clxt === 1) { p += 3 + tv.getInt16(p + 1, true); continue; }
      if (clxt === 2) {
        var lcb = tv.getUint32(p + 1, true), start = p + 5;
        var n = (lcb - 4) / 12;
        pieces = [];
        for (var i = 0; i < n; i++) {
          var cp0 = tv.getUint32(start + i * 4, true), cp1 = tv.getUint32(start + (i + 1) * 4, true);
          var pcd = start + (n + 1) * 4 + i * 8;
          var fc = tv.getUint32(pcd + 2, true);
          pieces.push({ cp0: cp0, cp1: cp1, compressed: !!(fc & 0x40000000), fc: fc & 0x3fffffff });
        }
        break;
      }
      break;
    }
    var text = '';
    var cp1252 = new TextDecoder('windows-1252');
    var utf16 = new TextDecoder('utf-16le');
    if (!pieces) {
      // documento senza tabella dei pezzi: testo contiguo dopo l'intestazione (fcMin)
      var fcMin = v.getUint32(0x18, true);
      text = cp1252.decode(wd.subarray(fcMin, fcMin + ccpText));
    } else {
      pieces.forEach(function (pc) {
        if (pc.cp0 >= ccpText) return;
        var nChars = Math.min(pc.cp1, ccpText) - pc.cp0;
        if (pc.compressed) {
          var off = pc.fc / 2;
          text += cp1252.decode(wd.subarray(off, off + nChars));
        } else {
          text += utf16.decode(wd.subarray(pc.fc, pc.fc + nChars * 2));
        }
      });
    }
    return cleanDocChars(text);
  }

  // Caratteri speciali di Word: campi, celle, interruzioni
  function cleanDocChars(s) {
    var out = '', depth = 0, inCode = [];
    for (var i = 0; i < s.length; i++) {
      var ch = s.charCodeAt(i);
      if (ch === 0x13) { depth++; inCode.push(true); continue; }          // inizio campo: codice
      if (ch === 0x14) { if (depth) inCode[depth - 1] = false; continue; } // separatore: segue il risultato
      if (ch === 0x15) { if (depth) { depth--; inCode.pop(); } continue; } // fine campo
      if (depth && inCode[depth - 1]) continue;
      if (ch === 0x0d) out += '\n';
      else if (ch === 0x07) out += '\t';
      else if (ch === 0x0b) out += ' ';
      else if (ch === 0x0c) out += '\n';
      else if (ch === 0x1e) out += '-';
      else if (ch === 0x1f || ch === 0x01 || ch === 0x08 || ch === 0x02 || ch === 0x05) continue;
      else if (ch < 0x20 && ch !== 0x09 && ch !== 0x0a) continue;
      else out += s[i];
    }
    return out;
  }

  g.WCCfb = { isCfb: isCfb, open: openCfb, docText: docText };
})(globalThis);
