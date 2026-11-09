import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ReportIncidentDto } from '../../src/modules/dto/incident.dto';

// DLV-15: photoUrl was any string up to 2048 characters, and the signed link is derived from it. It
// must be what the PoD upload endpoint hands back: `<base>/pod/<uuid>.<jpg|png|webp>`.
describe('ReportIncidentDto · photoUrl', () => {
  const base = { category: 'ACCIDENT', severity: 'LOW', description: 'Ban bocor' };
  const photoErrors = async (photoUrl: unknown) =>
    (await validate(plainToInstance(ReportIncidentDto, { ...base, photoUrl }))).filter((e) => e.property === 'photoUrl');
  const UUID = '7d0f5ff1-0b8f-4e1a-9d63-0f4a0f2f9a11';

  it.each([
    `https://cdn.example.com/pod/${UUID}.jpg`,
    `https://cdn.example.com/uploads/pod/${UUID}.png`,
    `/uploads/pod/${UUID}.webp`,
  ])('accepts an upload URL %s', async (url) => {
    expect(await photoErrors(url)).toHaveLength(0);
  });

  it('is optional', async () => {
    expect(await photoErrors(undefined)).toHaveLength(0);
  });

  it.each([
    'https://evil.example.com/x.jpg',
    `https://cdn.example.com/pod/../../etc/passwd`,
    `https://cdn.example.com/pod/${UUID}.html`,
    `https://cdn.example.com/pod/not-a-uuid.jpg`,
    `https://cdn.example.com/pod/${UUID}.jpg?x=1`,
  ])('refuses %s', async (url) => {
    expect(await photoErrors(url)).not.toHaveLength(0);
  });
});
