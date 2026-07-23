import { OtpPurpose } from '../../src/domain/otp/otp-purpose.enum';
import { ConsoleOtpDeliveryAdapter } from '../../src/infrastructure/otp-delivery/console-otp-delivery.adapter';
import { SmsOtpDeliveryAdapter } from '../../src/infrastructure/otp-delivery/sms-otp-delivery.adapter';
import { ZenzivaOtpDeliveryAdapter } from '../../src/infrastructure/otp-delivery/zenziva-otp-delivery.adapter';
import { buildTestConfig } from '../support/fakes';

const message = {
  phone: '+6281234567890',
  code: '123456',
  purpose: OtpPurpose.REGISTRATION,
  ttlSeconds: 300,
};

describe('OTP delivery adapters', () => {
  afterEach(() => jest.restoreAllMocks());

  it('console adapter logs without throwing', async () => {
    const adapter = new ConsoleOtpDeliveryAdapter();
    await expect(adapter.send(message)).resolves.toBeUndefined();
  });

  describe('SmsOtpDeliveryAdapter', () => {
    const config = buildTestConfig({
      OTP_DELIVERY_CHANNEL: 'sms',
      SMS_API_BASE_URL: 'https://sms.example.com',
      SMS_API_TOKEN: 'sms-token',
    });

    it('posts a message with the sender id', async () => {
      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue({ ok: true, text: async () => '' } as Response);
      const adapter = new SmsOtpDeliveryAdapter(config);

      await adapter.send(message);
      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse((init as RequestInit).body as string);
      expect(body.to).toBe('+6281234567890');
      expect(body.from).toBe('HYDROMART');
      expect(body.text).toContain('123456');
    });

    it('throws when SMS delivery fails', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue({ ok: false, status: 400, text: async () => 'bad' } as Response);
      const adapter = new SmsOtpDeliveryAdapter(config);
      await expect(adapter.send(message)).rejects.toThrow(/SMS/);
    });
  });

  describe('ZenzivaOtpDeliveryAdapter', () => {
    const config = buildTestConfig({
      OTP_DELIVERY_CHANNEL: 'zenziva',
      ZENZIVA_BASE_URL: 'https://console.zenziva.net',
      ZENZIVA_USERKEY: 'zen-userkey',
      ZENZIVA_PASSKEY: 'zen-passkey',
    });

    function mockZenziva(body: unknown, ok = true, status = 200): jest.SpyInstance {
      return jest
        .spyOn(global, 'fetch')
        .mockResolvedValue({ ok, status, json: async () => body, text: async () => '' } as Response);
    }

    function sentForm(fetchMock: jest.SpyInstance): URLSearchParams {
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      return new URLSearchParams(init.body as string);
    }

    it('posts form-encoded credentials to the sendOTP endpoint', async () => {
      const fetchMock = mockZenziva({ status: '1', text: 'Success' });
      await new ZenzivaOtpDeliveryAdapter(config).send(message);

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://console.zenziva.net/masking/api/sendOTP/');
      expect((init.headers as Record<string, string>)['Content-Type']).toBe(
        'application/x-www-form-urlencoded',
      );
      const form = sentForm(fetchMock);
      expect(form.get('userkey')).toBe('zen-userkey');
      expect(form.get('passkey')).toBe('zen-passkey');
    });

    // Accounts are stored E.164; Zenziva's API takes the local 08… form.
    it('sends the destination in local format', async () => {
      const fetchMock = mockZenziva({ status: '1' });
      await new ZenzivaOtpDeliveryAdapter(config).send(message);
      expect(sentForm(fetchMock).get('to')).toBe('081234567890');
    });

    it('uses the registration copy for a registration challenge', async () => {
      const fetchMock = mockZenziva({ status: '1' });
      await new ZenzivaOtpDeliveryAdapter(config).send(message);
      const text = sentForm(fetchMock).get('message') ?? '';
      expect(text).toContain('Kode Verifikasi HYDROMART');
      expect(text).toContain('Kode OTP Anda adalah 123456.');
      expect(text).toContain('berlaku selama 5 menit');
      expect(text.length).toBeLessThanOrEqual(400);
    });

    it('uses the login copy for a login challenge', async () => {
      const fetchMock = mockZenziva({ status: '1' });
      await new ZenzivaOtpDeliveryAdapter(config).send({ ...message, purpose: OtpPurpose.LOGIN });
      const text = sentForm(fetchMock).get('message') ?? '';
      expect(text).toContain('Kode Login HYDROMART');
      expect(text).toContain('Masukkan kode OTP 123456 untuk melanjutkan login.');
      expect(text.length).toBeLessThanOrEqual(400);
    });

    // Zenziva answers 200 even when it refuses the send; the real outcome is in `status`.
    it('throws when Zenziva returns a non-success status on a 200', async () => {
      mockZenziva({ status: '0', text: 'Insufficient balance' });
      await expect(new ZenzivaOtpDeliveryAdapter(config).send(message)).rejects.toThrow(/Zenziva/);
    });

    it('throws on a transport-level failure', async () => {
      mockZenziva(null, false, 502);
      await expect(new ZenzivaOtpDeliveryAdapter(config).send(message)).rejects.toThrow(/502/);
    });
  });
});
