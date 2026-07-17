import { OtpPurpose } from '../../src/domain/otp/otp-purpose.enum';
import { ConsoleOtpDeliveryAdapter } from '../../src/infrastructure/otp-delivery/console-otp-delivery.adapter';
import { SmsOtpDeliveryAdapter } from '../../src/infrastructure/otp-delivery/sms-otp-delivery.adapter';
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
});
