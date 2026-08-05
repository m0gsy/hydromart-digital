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

  it('refuses anything too short to carry a signature', () => {
    expect(sniffFileType(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
    expect(sniffFileType(Buffer.alloc(0))).toBeNull();
  });

  it('reports the mime of what the bytes are, not what was claimed', () => {
    expect(SNIFFED_MIME[sniffFileType(png)!]).toBe('image/png');
  });
});
