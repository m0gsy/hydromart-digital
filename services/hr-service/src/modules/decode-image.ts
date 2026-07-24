import { BadRequestException } from '@nestjs/common';

/** Decode a base64 string or `data:image/...;base64,` data-URL into raw bytes. */
export function decodeBase64Image(input: string): Buffer {
  const b64 = input.includes(',') ? input.slice(input.indexOf(',') + 1) : input;
  const buf = Buffer.from(b64, 'base64');
  if (buf.length === 0) {
    throw new BadRequestException('Frame gambar tidak valid');
  }
  return buf;
}
