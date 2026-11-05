import { isHighRisk, payerKeys, type Payer } from './risk.domain';
import type { RiskSignalKind, RiskSignalsRepo } from './risk-signals.repo';

/** Shared risk signals: what one shop learns about a payer warns every other shop. */
export class RiskService {
  constructor(
    private readonly repo: RiskSignalsRepo,
    private readonly secret: string,
  ) {}

  async record(shopId: string, kind: RiskSignalKind, payer: Payer): Promise<void> {
    await this.repo.insert(shopId, kind, payerKeys(this.secret, payer));
  }

  async isHighRisk(payer: Payer): Promise<boolean> {
    return isHighRisk(await this.repo.shopCount(payerKeys(this.secret, payer)));
  }
}
