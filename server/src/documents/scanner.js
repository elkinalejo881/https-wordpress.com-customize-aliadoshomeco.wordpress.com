import net from 'node:net';

const EICAR = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');

/** Siempre activo: detecta la cadena de prueba EICAR (permite probar el flujo sin antivirus real). */
export class EicarScanner {
  async scan(buf) { return buf.includes(EICAR) ? { clean: false, signature: 'EICAR-Test-File' } : { clean: true }; }
}

/** ClamAV por protocolo clamd INSTREAM (contenedor clamav/clamav en la misma red privada). */
export class ClamdScanner {
  constructor({ host, port = 3310, timeoutMs = 60_000 }) { this.host = host; this.port = port; this.timeoutMs = timeoutMs; }
  scan(buf) {
    return new Promise((resolve, reject) => {
      const s = net.connect(this.port, this.host); let out = '';
      s.setTimeout(this.timeoutMs, () => { s.destroy(); reject(new Error('clamd: tiempo agotado')); });
      s.on('error', reject);
      s.on('data', d => out += d);
      s.on('end', () => {
        const r = out.replace(/\0/g, '').trim();
        if (/OK$/.test(r)) resolve({ clean: true });
        else if (/FOUND$/.test(r)) resolve({ clean: false, signature: r.replace(/^stream:\s*/, '').replace(/\s*FOUND$/, '') });
        else reject(new Error(`clamd respuesta inesperada: ${r}`));
      });
      s.write('zINSTREAM\0');
      for (let o = 0; o < buf.length; o += 65536) {
        const ch = buf.subarray(o, o + 65536), len = Buffer.alloc(4); len.writeUInt32BE(ch.length); s.write(len); s.write(ch);
      }
      s.end(Buffer.alloc(4));
    });
  }
}

/** Ante error del motor NO se aprueba el archivo: el trabajo reintenta y, si agota intentos, queda 'failed'. */
export class CompositeScanner {
  constructor(list) { this.list = list; }
  async scan(buf) { for (const s of this.list) { const r = await s.scan(buf); if (!r.clean) return r; } return { clean: true }; }
}

export function createScanner(cfg) {
  const list = [new EicarScanner()];
  if (cfg.clamdHost) list.push(new ClamdScanner({ host: cfg.clamdHost, port: cfg.clamdPort }));
  return new CompositeScanner(list);
}
