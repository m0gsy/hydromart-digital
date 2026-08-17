#!/usr/bin/env bash
# Self-check for the service-to-service half of check-endpoint-contracts.mjs.
#
# That reader resolves a target service, a verb and a path from three different places in an
# adapter, and every earlier draft of it was confidently wrong in a way nothing failed on:
# eleven POSTs read as GETs, four calls pinned on the wrong service, twenty adapters silently
# skipped. A gate that cannot fail is worse than no gate, so this drops a broken adapter into
# a real service and insists the check refuses it — once per call shape.
set -euo pipefail

FIXTURE=services/order-service/src/infrastructure/http/zz-contract-gate-fixture.http.adapter.ts
cleanup() { rm -f "$FIXTURE"; }
trap cleanup EXIT

expect_refusal() {
  local what=$1 want=$2
  if node scripts/check-endpoint-contracts.mjs >/tmp/contract-gate.out 2>&1; then
    echo "FAIL: $what passed the contract gate"
    cat /tmp/contract-gate.out
    exit 1
  fi
  if ! grep -q "$want" /tmp/contract-gate.out; then
    echo "FAIL: $what was refused, but not for the expected reason ($want)"
    cat /tmp/contract-gate.out
    exit 1
  fi
  echo "ok: $what"
}

# 1. Direct call at a path payment-service does not serve.
cat > "$FIXTURE" <<'TS'
import { Injectable } from '@nestjs/common';
import { OrderConfigService } from '../../config/order-config.service';

@Injectable()
export class ZzContractGateFixture {
  constructor(private readonly config: OrderConfigService) {}

  async broken(): Promise<void> {
    await fetch(`${this.config.paymentServiceUrl}/api/v1/payments/internal/zz-no-such-route`, { method: 'GET' });
  }
}
TS
expect_refusal "a path no controller declares" "payment-service declares no matching route"

# 2. Right path, wrong verb — the failure mode the frontend half already catches.
cat > "$FIXTURE" <<'TS'
import { Injectable } from '@nestjs/common';
import { OrderConfigService } from '../../config/order-config.service';

@Injectable()
export class ZzContractGateFixture {
  constructor(private readonly config: OrderConfigService) {}

  async broken(): Promise<void> {
    await fetch(`${this.config.paymentServiceUrl}/api/v1/payments/internal/cash-collected`, {
      method: 'DELETE',
    });
  }
}
TS
expect_refusal "a verb the route does not declare" "declares only"

# 3. The helper shape: the verb is on the helper, the path at the call site. Read one of the
#    two wrong and this fixture passes.
cat > "$FIXTURE" <<'TS'
import { Injectable } from '@nestjs/common';
import { OrderConfigService } from '../../config/order-config.service';

@Injectable()
export class ZzContractGateFixture {
  constructor(private readonly config: OrderConfigService) {}

  async broken(): Promise<void> {
    await this.post('internal/zz-no-such-route');
  }

  private async post(path: string): Promise<void> {
    await fetch(`${this.config.paymentServiceUrl}/api/v1/payments/${path}`, { method: 'POST' });
  }
}
TS
expect_refusal "a helper call site naming a path that does not exist" "payment-service declares no matching route"

cleanup
# 4. And with the fixture gone the tree is clean — the check is not simply always red.
if ! node scripts/check-endpoint-contracts.mjs >/tmp/contract-gate.out 2>&1; then
  echo 'FAIL: the unmodified tree does not pass its own contract gate'
  cat /tmp/contract-gate.out
  exit 1
fi
echo 'ok: the unmodified tree passes'
