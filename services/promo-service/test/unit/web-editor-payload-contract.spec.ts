import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
// Lives HERE (not in apps/web) because the DTOs need decorators the web tsconfig does not enable.
// The web component tests mock `api.post`, so nothing ever ran the editor's payload through the
// validation pipe — and the editor sent `active` on create (a 400 on every real create) for as
// long as it existed. This feeds what the editor really builds to the DTOs the API really uses,
// with the pipe's own settings (whitelist + forbidNonWhitelisted).
import {
  CreatePromoRuleDto,
  UpdatePromoRuleDto,
} from '../../src/modules/dto/promo-rule.dto';
// The editor's own payload builder, from the web app. `require`, not `import`: a static import
// pulls the web file into this service's TypeScript program (TS6059, outside rootDir), and the
// builder is pure code with type-only imports, which ts-jest compiles on its own.
interface EditorForm {
  name: string;
  kind: string;
  [field: string]: unknown;
}
// eslint-disable-next-line @typescript-eslint/no-var-requires
const web = require('../../../../apps/web/src/lib/promo-rule-form') as {
  EMPTY_RULE_FORM: EditorForm;
  ruleFormToPayload: (f: EditorForm, depotId: string | null, mode?: 'create' | 'edit') => Record<string, unknown>;
};
const { EMPTY_RULE_FORM, ruleFormToPayload } = web;
type RuleForm = EditorForm;

const U = '00000000-0000-4000-8000-0000000000';
const id = (n: number) => `${U}${String(n).padStart(2, '0')}`;
const form = (over: Partial<RuleForm>): RuleForm => ({ ...EMPTY_RULE_FORM, name: 'Promo', ...over });

const CASES: [string, RuleForm][] = [
  ['SPECIAL_PRICE', form({ kind: 'SPECIAL_PRICE', specialPrice: '4500', productId: id(1) })],
  ['BUY_X_GET_Y', form({ kind: 'BUY_X_GET_Y', buyQty: '2', getQty: '1', productId: id(1) })],
  ['SHIPPING_DISCOUNT', form({ kind: 'SHIPPING_DISCOUNT', shippingFeeOverride: '0' })],
  ['PERCENTAGE_OFF', form({ kind: 'PERCENTAGE_OFF', percentOff: '20', productId: id(1), depotId: id(2) })],
  ['ORDER_DISCOUNT amount', form({ kind: 'ORDER_DISCOUNT', minSubtotal: '100000', discountAmount: '10000', orderMode: 'AMOUNT' })],
  ['ORDER_DISCOUNT percent', form({ kind: 'ORDER_DISCOUNT', minSubtotal: '100000', percentOff: '5', orderMode: 'PERCENT' })],
  ['BUNDLE_GIFT', form({ kind: 'BUNDLE_GIFT', buyQty: '2', getQty: '1', giftProductId: id(3), productId: id(1) })],
  [
    'everything optional filled',
    form({
      kind: 'PERCENTAGE_OFF', percentOff: '10', categoryId: id(4), firstOrderOnly: true, validFrom: '2026-01-01',
      validUntil: '2026-12-31', daysOfWeek: [5], startTime: '09:00', endTime: '18:00', minQty: '2', maxQty: '10',
      channels: ['APP', 'COUNTER'],
    }),
  ],
];

const PIPE = { whitelist: true, forbidNonWhitelisted: true } as const;

describe('what the promo-rule editor sends is accepted by the API', () => {
  it.each(CASES)('CREATE %s passes CreatePromoRuleDto', async (_name, f) => {
    const dto = plainToInstance(CreatePromoRuleDto, ruleFormToPayload(f, (f.depotId as string) || null, 'create'));
    const errors = await validate(dto, PIPE);
    expect(errors.map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)).toEqual([]);
  });

  it.each(CASES)('EDIT %s passes UpdatePromoRuleDto (with seenUpdatedAt)', async (_name, f) => {
    const body = { ...ruleFormToPayload({ ...f, active: false }, (f.depotId as string) || null, 'edit'), seenUpdatedAt: '2026-01-01T00:00:00.000Z' };
    const errors = await validate(plainToInstance(UpdatePromoRuleDto, body), PIPE);
    expect(errors.map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)).toEqual([]);
  });

  it('a create body carrying `active` IS refused — the guard against the regression', async () => {
    const body = { ...ruleFormToPayload(CASES[0]![1], null, 'create'), active: true };
    const errors = await validate(plainToInstance(CreatePromoRuleDto, body), PIPE);
    expect(errors.map((e) => e.property)).toContain('active');
  });
});
