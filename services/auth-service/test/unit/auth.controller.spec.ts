import { Request } from 'express';

import { AuthController } from '../../src/modules/auth/auth.controller';
import { OtpPurpose } from '../../src/domain/otp/otp-purpose.enum';
import { LoginService } from '../../src/application/services/login.service';
import { OtpVerificationService } from '../../src/application/services/otp-verification.service';
import { RegistrationService } from '../../src/application/services/registration.service';
import { TokenService } from '../../src/application/services/token.service';

// Delegation only: the controller maps the DTO + request context onto its service and
// wraps the result in the response DTO. The services themselves are unit-tested elsewhere.
// The DTO always states deliveryPending, so the shape these routes return carries it too:
// false on the ordinary path, true when the SMS gateway had not answered by reply time.
const CHALLENGE = { phoneMasked: '+62812****890', expiresInSeconds: 300 };
const CHALLENGE_RESPONSE = {
  ...CHALLENGE,
  resendCooldownSeconds: undefined,
  deliveryPending: false,
};
const SESSION = {
  tokenType: 'Bearer' as const,
  accessToken: 'at',
  expiresIn: 900,
  refreshToken: 'rt',
  customer: { id: 'cust-1' },
};

const req = {
  headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'user-agent': 'jest' },
  ip: '10.0.0.2',
  socket: {},
} as unknown as Request;

const CONTEXT = { ipAddress: '203.0.113.9', userAgent: 'jest' };

describe('AuthController', () => {
  let registration: { register: jest.Mock };
  let otpVerification: { verify: jest.Mock; resend: jest.Mock };
  let login: { requestLogin: jest.Mock };
  let tokens: { refresh: jest.Mock };
  let controller: AuthController;

  beforeEach(() => {
    registration = { register: jest.fn().mockResolvedValue(CHALLENGE) };
    otpVerification = {
      verify: jest.fn().mockResolvedValue(SESSION),
      resend: jest.fn().mockResolvedValue(CHALLENGE),
    };
    login = { requestLogin: jest.fn().mockResolvedValue(CHALLENGE) };
    tokens = { refresh: jest.fn().mockResolvedValue(SESSION) };
    controller = new AuthController(
      registration as unknown as RegistrationService,
      otpVerification as unknown as OtpVerificationService,
      login as unknown as LoginService,
      tokens as unknown as TokenService,
    );
  });

  it('register() forwards the profile fields and request context', async () => {
    const res = await controller.register(
      { phone: '+628123456789', fullName: 'Budi', email: 'budi@example.com' },
      req,
    );
    expect(registration.register).toHaveBeenCalledWith({
      phone: '+628123456789',
      fullName: 'Budi',
      email: 'budi@example.com',
      context: CONTEXT,
    });
    expect(res).toEqual(CHALLENGE_RESPONSE);
  });

  it('verifyOtp() forwards phone/code/purpose and returns a session', async () => {
    const res = await controller.verifyOtp(
      { phone: '+628123456789', code: '123456', purpose: OtpPurpose.REGISTRATION },
      req,
    );
    expect(otpVerification.verify).toHaveBeenCalledWith({
      phone: '+628123456789',
      code: '123456',
      purpose: OtpPurpose.REGISTRATION,
      context: CONTEXT,
    });
    expect(res).toMatchObject({ accessToken: 'at', refreshToken: 'rt' });
  });

  it('resendOtp() forwards phone/purpose and returns a fresh challenge', async () => {
    const res = await controller.resendOtp(
      { phone: '+628123456789', purpose: OtpPurpose.LOGIN },
      req,
    );
    expect(otpVerification.resend).toHaveBeenCalledWith({
      phone: '+628123456789',
      purpose: OtpPurpose.LOGIN,
      context: CONTEXT,
    });
    expect(res).toEqual(CHALLENGE_RESPONSE);
  });

  it('login() requests an OTP challenge for the phone', async () => {
    const res = await controller.login({ phone: '+628123456789' }, req);
    expect(login.requestLogin).toHaveBeenCalledWith({
      phone: '+628123456789',
      context: CONTEXT,
    });
    expect(res).toEqual(CHALLENGE_RESPONSE);
  });

  it('refresh() rotates the refresh token', async () => {
    const res = await controller.refresh({ refreshToken: 'rt' }, req);
    expect(tokens.refresh).toHaveBeenCalledWith({ refreshToken: 'rt', context: CONTEXT });
    expect(res).toMatchObject({ refreshToken: 'rt' });
  });
});
