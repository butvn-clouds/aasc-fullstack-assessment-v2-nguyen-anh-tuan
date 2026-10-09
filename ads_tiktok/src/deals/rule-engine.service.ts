import { BadRequestException, Injectable } from '@nestjs/common';
import { isRecord } from '../common/object';
import { getPath, Json } from '../common/bitrix-mapper';

export interface DealRule {
  name?: string;
  condition: string;
  action: 'create_deal';
  pipeline_id: string;
  stage_id: string;
  probability: number;
  probability_mode?: 'fixed' | 'lead_score';
  priority?: 'normal' | 'high';
  amount?: number;
  assign_to?: { strategy: 'round_robin' | 'fixed'; users: (number | string)[] };
}

const CLAUSE = /^\s*([\w.]+)\s+(NOT_CONTAINS|CONTAINS|EQUALS|==|!=|>=|<=|>|<)\s+(?:'([^']*)'|"([^"]*)"|(\S+))\s*$/i;

/** Rule engine tối giản: "path OP 'value' [AND path OP value ...]". */
@Injectable()
export class RuleEngineService {
  evaluateCondition(condition: string, ctx: Json): boolean {
    return condition.split(/\s+AND\s+/i).every((clause) => this.evaluateClause(clause, ctx));
  }

  private evaluateClause(clause: string, ctx: Json): boolean {
    const m = CLAUSE.exec(clause);
    if (!m) throw new BadRequestException(`Điều kiện không hợp lệ: ${clause}`);
    const [, path, opRaw, q1, q2, bare] = m;
    const expected = q1 ?? q2 ?? bare;
    const actual = getPath(ctx, path);
    const op = opRaw.toUpperCase();
    const str = actual == null ? '' : String(actual).toLowerCase();
    const exp = String(expected).toLowerCase();
    switch (op) {
      case 'CONTAINS':
        return Array.isArray(actual) ? actual.map((a) => String(a).toLowerCase()).includes(exp) : str.includes(exp);
      case 'NOT_CONTAINS':
        return !str.includes(exp);
      case 'EQUALS':
      case '==':
        return str === exp;
      case '!=':
        return str !== exp;
      case '>':
        return Number(actual) > Number(expected);
      case '<':
        return Number(actual) < Number(expected);
      case '>=':
        return Number(actual) >= Number(expected);
      case '<=':
        return Number(actual) <= Number(expected);
      default:
        return false;
    }
  }

  /** Trả rule đầu tiên khớp (thứ tự trong mảng = độ ưu tiên). */
  findMatch(rules: DealRule[], ctx: Json): DealRule | null {
    return (rules ?? []).find((r) => r.action === 'create_deal' && this.evaluateCondition(r.condition, ctx)) ?? null;
  }

  validateRule(rule: unknown): void {
    if (
      !isRecord(rule) ||
      typeof rule.condition !== 'string' ||
      !rule.condition.trim() ||
      rule.action !== 'create_deal' ||
      typeof rule.pipeline_id !== 'string' ||
      !rule.pipeline_id.trim() ||
      typeof rule.stage_id !== 'string' ||
      !rule.stage_id.trim() ||
      typeof rule.probability !== 'number' ||
      !Number.isFinite(rule.probability) ||
      rule.probability < 0 ||
      rule.probability > 100
    ) {
      throw new BadRequestException(
        'Mỗi quy tắc cần condition, pipeline_id, stage_id hợp lệ, action là "create_deal" và probability từ 0–100',
      );
    }
    rule.condition.split(/\s+AND\s+/i).forEach((c: string) => {
      if (!CLAUSE.test(c)) throw new BadRequestException(`Điều kiện không hợp lệ: ${c}`);
    });
    if (rule.probability_mode !== undefined && !['fixed', 'lead_score'].includes(String(rule.probability_mode)))
      throw new BadRequestException('probability_mode không hợp lệ');
    if (rule.priority !== undefined && !['normal', 'high'].includes(String(rule.priority)))
      throw new BadRequestException('priority phải là normal hoặc high');
    if (
      rule.amount !== undefined &&
      (typeof rule.amount !== 'number' || !Number.isFinite(rule.amount) || rule.amount < 0)
    )
      throw new BadRequestException('amount phải là số không âm');
    if (rule.assign_to !== undefined) {
      const assignment = rule.assign_to;
      if (
        !isRecord(assignment) ||
        !['fixed', 'round_robin'].includes(String(assignment.strategy)) ||
        !Array.isArray(assignment.users) ||
        assignment.users.length === 0 ||
        assignment.users.some(
          (user: unknown) =>
            !(
              (typeof user === 'string' && user.trim()) ||
              (typeof user === 'number' && Number.isSafeInteger(user) && user > 0)
            ),
        )
      ) {
        throw new BadRequestException('assign_to cần strategy hợp lệ và danh sách users không rỗng');
      }
    }
  }
}
