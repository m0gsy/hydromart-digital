import { NO_SHOW_REASON } from '../../src/domain/no-show';
import { FAILURE_REASON_CODES, FAILURE_REASON_LABELS, legacyFailureCode } from '../../src/domain/failure-reason';

describe('failure reason codes', () => {
  it('maps the four old chip texts, the no-show text and everything else', () => {
    expect(legacyFailureCode('Alamat tidak ditemukan')).toBe('ADDRESS_NOT_FOUND');
    expect(legacyFailureCode('Pelanggan menolak')).toBe('CUSTOMER_REFUSED');
    expect(legacyFailureCode('Barang rusak')).toBe('GOODS_DAMAGED');
    expect(legacyFailureCode('Pelanggan tidak bisa dihubungi')).toBe('CANNOT_CONTACT');
    expect(legacyFailureCode(NO_SHOW_REASON)).toBe('NO_SHOW');
    expect(legacyFailureCode('Alamat tidak ketemu, telp 0812')).toBe('OTHER');
    expect(legacyFailureCode(null)).toBe('OTHER');
  });

  it('has a label for every code', () => {
    for (const c of FAILURE_REASON_CODES) expect(FAILURE_REASON_LABELS[c]).toBeTruthy();
  });
});
