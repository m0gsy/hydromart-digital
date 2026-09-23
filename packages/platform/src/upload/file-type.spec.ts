import { sniffFileType, SNIFFED_MIME } from './file-type';

const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
const pdf = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(8)]);

describe('sniffFileType', () => {
  it('reads each accepted format from its magic bytes', () => {
    expect(sniffFileType(jpg)).toBe('jpg');
    expect(sniffFileType(png)).toBe('png');
    expect(sniffFileType(webp)).toBe('webp');
    expect(sniffFileType(pdf)).toBe('pdf');
  });

  // H-20: this is the whole point. The multipart Content-Type is client-controlled, so a
  // script uploaded as image/jpeg used to be stored and served back from the bucket.
  it('refuses content the client merely labelled as an image', () => {
    expect(sniffFileType(Buffer.from('<script>alert(1)</script>          '))).toBeNull();
    expect(sniffFileType(Buffer.from('<svg onload="alert(1)"></svg>      '))).toBeNull();
    expect(sniffFileType(Buffer.from('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00'))).toBeNull();
  });

  /*
   * CORE-5: a polyglot has an honest header and a document behind it. The signature check
   * cannot see that — being honest at the front is the whole attack — so a browser that
   * content-sniffs (or any viewer that ignores the served Content-Type) runs the markup.
   */
  it.each([
    ['a script', '<script>alert(1)</script>'],
    ['an svg', '<svg onload="alert(1)">'],
    ['an html document', '<!DOCTYPE html><html>'],
    ['an iframe', "<iframe src='x'>"],
    ['markup further into the sniffing window', `${' '.repeat(600)}<script>alert(1)</script>`],
  ])('refuses a real JPEG header with %s behind it', (_label, payload) => {
    expect(sniffFileType(Buffer.concat([jpg, Buffer.from(payload)]))).toBeNull();
  });

  it('leaves an ordinary image alone, markup-shaped bytes and all', () => {
    // `<` and a word is not markup; a real photo carries every byte value eventually.
    const photo = Buffer.concat([jpg, Buffer.from('EXIF Comment: 3 < 4 and 5 > 2')]);
    expect(sniffFileType(photo)).toBe('jpg');
  });

  // Past the window a sniffer reads, the bytes cannot decide how the file is treated.
  it('does not scan the whole file, only the window a sniffer reads', () => {
    const deep = Buffer.concat([jpg, Buffer.alloc(4096, 0x20), Buffer.from('<script>x</script>')]);
    expect(sniffFileType(deep)).toBe('jpg');
  });

  it('refuses anything too short to carry a signature', () => {
    expect(sniffFileType(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
    expect(sniffFileType(Buffer.alloc(0))).toBeNull();
  });

  it('reports the mime of what the bytes are, not what was claimed', () => {
    expect(SNIFFED_MIME[sniffFileType(png)!]).toBe('image/png');
  });
});
