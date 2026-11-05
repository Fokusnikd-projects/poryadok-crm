const unfold = raw => String(raw).replace(/\r?\n[ \t]/g, '').split(/\r?\n/).filter(Boolean);
const property = line => line.split(':', 1)[0].split(';', 1)[0].split('.').pop().toUpperCase();
const value = line => line.slice(line.indexOf(':') + 1);
const decode = s => s.replace(/\\([nN,;\\])/g, (_, c) => /n/i.test(c) ? '\n' : c);
const encode = s => String(s || '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
const fields = { name: 'FN', phone: 'TEL', email: 'EMAIL' };

export function readCard(card) {
  const lines = unfold(card.data);
  if (!lines.includes('BEGIN:VCARD') || !lines.includes('END:VCARD')) throw new Error('Некорректный vCard в адресной книге');
  if (lines.some(l => /^(?:[^:]+\.)?(?:FN|N|TEL|EMAIL)[;:]/i.test(l) && /ENCODING=(?:QUOTED-PRINTABLE|B|BASE64)|CHARSET=(?!UTF-8)/i.test(l))) {
    throw new Error('В адресной книге есть контакт в устаревшей кодировке. Пересохраните его в Яндекс Контактах.');
  }
  const get = key => lines.filter(l => property(l) === key).map(l => decode(value(l)));
  return { uid: get('UID')[0] || card.url, href: card.url, etag: card.etag,
    name: get('FN')[0] || get('N')[0]?.split(';').filter(Boolean).join(' ') || 'Без имени',
    phone: (get('TEL')[0] || '').replace(/^tel:/i, ''), email: (get('EMAIL')[0] || '').replace(/^mailto:/i, ''),
    org: get('ORG')[0]?.split(';')[0] || '', raw: card.data };
}

// Preserve secondary numbers/emails, photo, birthdays, labels and all unknown properties.
export function writeCard(remote, contact, uid) {
  let lines = remote ? unfold(remote.raw) : ['BEGIN:VCARD', 'VERSION:3.0', `UID:${encode(uid)}`, 'END:VCARD'];
  for (const [key, prop] of Object.entries(fields)) {
    if (remote && String(remote[key] || '') === String(contact[key] || '')) continue;
    let found = false;
    lines = lines.map(l => {
      if (property(l) !== prop || found) return l;
      found = true;
      if (!contact[key]) return null;
      const prefix = key === 'phone' && /^tel:/i.test(value(l)) ? 'tel:' : key === 'email' && /^mailto:/i.test(value(l)) ? 'mailto:' : '';
      return l.slice(0, l.indexOf(':') + 1) + prefix + encode(contact[key]);
    }).filter(Boolean);
    if (!found && contact[key]) lines.splice(lines.length - 1, 0, `${prop}:${encode(contact[key])}`);
    if (key === 'name') {
      lines = lines.filter(l => property(l) !== 'N');
      lines.splice(lines.length - 1, 0, `N:;${encode(contact.name)};;;`);
    }
  }
  lines = lines.filter(l => property(l) !== 'REV');
  lines.splice(lines.length - 1, 0, `REV:${new Date().toISOString()}`);
  // Fold by octets without splitting UTF-8 characters (vCard 3/4).
  return lines.map(line => {
    const parts = []; let part = '', bytes = 0;
    for (const char of line) {
      const size = Buffer.byteLength(char);
      if (bytes + size > 75) { parts.push(part); part = ' '; bytes = 1; }
      part += char; bytes += size;
    }
    parts.push(part); return parts.join('\r\n');
  }).join('\r\n') + '\r\n';
}
