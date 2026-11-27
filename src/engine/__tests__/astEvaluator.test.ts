import { describe, expect, it } from 'vitest';
import {
  ExpressionSyntaxError,
  evaluateBooleanExpression,
  evaluateExpression,
} from '../astEvaluator';

describe('Safe Deterministic AST Evaluator', () => {
  it('evaluates arithmetic precedence and parentheses accurately', () => {
    expect(evaluateExpression('2 + 3 * 4 - (10 / 2)', {})).toBe(9);
  });

  it('handles division and modulo by zero safely without throwing NaN/Infinity', () => {
    expect(evaluateExpression('100 / 0', {})).toBe(0);
    expect(evaluateExpression('100 % 0', {})).toBe(0);
  });

  it('supports unary operators and logical negation', () => {
    expect(evaluateExpression('-5 + +8', {})).toBe(3);
    expect(evaluateExpression('!false && true', {})).toBe(true);
    expect(evaluateExpression('NOT (amount > 100)', { amount: 50 })).toBe(true);
  });

  it('supports ternary conditional expressions and IF() short-circuiting', () => {
    expect(evaluateExpression("tier == 'vip' ? 0.85 : 1.0", { tier: 'vip' })).toBe(0.85);
    expect(evaluateExpression('IF(score >= 60, "PASS", "FAIL")', { score: 78 })).toBe('PASS');
  });

  it('aggregates subtable column arrays with SUM, AVG, MIN, MAX, COUNT', () => {
    const scope = {
      items: [
        { name: 'GPU', qty: 2, subtotal: 40000 },
        { name: 'NIC', qty: 4, subtotal: 10000 },
        { name: 'Cable', qty: 10, subtotal: 2000 },
      ],
    };
    expect(evaluateExpression("SUM(items, 'subtotal')", scope)).toBe(52000);
    expect(evaluateExpression("ROUND(AVG(items, 'subtotal'), 2)", scope)).toBe(17333.33);
    expect(evaluateExpression("MIN(items, 'subtotal')", scope)).toBe(2000);
    expect(evaluateExpression("MAX(items, 'subtotal')", scope)).toBe(40000);
    expect(evaluateExpression("COUNT(items, 'subtotal')", scope)).toBe(3);
  });

  it('supports dot-path member access, array projection, and index access', () => {
    const scope = {
      applicant: { dept: 'RD', level: 4 },
      items: [{ price: 15 }, { price: 25 }],
    };
    expect(evaluateExpression("applicant.dept == 'RD' && applicant.level >= 3", scope)).toBe(true);
    expect(evaluateExpression('items[1].price * 2', scope)).toBe(50);
    expect(evaluateExpression('SUM(items.price)', scope)).toBe(40);
  });

  it('supports INCLUDES, CONTAINS, LEN, COALESCE, UPPER, LOWER, ABS', () => {
    const scope = { tags: ['iso27001', 'trusted_compute'], note: '' };
    expect(evaluateExpression("INCLUDES(tags, 'iso27001')", scope)).toBe(true);
    expect(evaluateExpression("CONTAINS('orgflow-studio', 'flow')", scope)).toBe(true);
    expect(evaluateExpression('LEN(tags)', scope)).toBe(2);
    expect(evaluateExpression("COALESCE(note, 'N/A')", scope)).toBe('N/A');
    expect(evaluateExpression("UPPER('rd') + '-' + LOWER('PROD')", scope)).toBe('RD-prod');
    expect(evaluateExpression('ABS(-42.5)', scope)).toBe(42.5);
  });

  it('blocks prototype pollution and forbidden global identifiers', () => {
    expect(() => evaluateExpression('__proto__', {})).toThrow(ExpressionSyntaxError);
    expect(() => evaluateExpression('constructor.name', {})).toThrow(ExpressionSyntaxError);
    expect(() => evaluateExpression('window.location', {})).toThrow(ExpressionSyntaxError);
    expect(() => evaluateExpression('eval("1+1")', {})).toThrow(ExpressionSyntaxError);
  });

  it('rejects unknown functions and malformed syntax cleanly', () => {
    expect(() => evaluateExpression('UNKNOWN_FN(1, 2)', {})).toThrow(ExpressionSyntaxError);
    expect(() => evaluateExpression('1 + * 2', {})).toThrow(ExpressionSyntaxError);
    expect(() => evaluateExpression('"unterminated', {})).toThrow(ExpressionSyntaxError);
  });

  it('evaluates boolean expressions with fallback when empty', () => {
    expect(evaluateBooleanExpression(undefined, {}, true)).toBe(true);
    expect(evaluateBooleanExpression('', {}, false)).toBe(false);
    expect(evaluateBooleanExpression('grandTotal >= 50000', { grandTotal: 52000 }, false)).toBe(
      true,
    );
  });
});
