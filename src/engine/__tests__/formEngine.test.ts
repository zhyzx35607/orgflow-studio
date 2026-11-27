import { describe, expect, it } from 'vitest';
import { createDefaultSeedBundle } from '../../data/seedData';
import { evaluateFormSchema } from '../formEngine';

describe('Dynamic Form Schema Engine', () => {
  it('computes subtable row formulas and chained top-level formulas deterministically', () => {
    const seed = createDefaultSeedBundle();
    const capex = seed.schemas.find((s) => s.id === 'schema_capex_procure')!;
    const snapshot = evaluateFormSchema(capex, {
      projectTitle: '测试服务器采购',
      items: [
        { itemName: 'Node A', qty: 3, unitPrice: 10000 },
        { itemName: 'Node B', qty: 2, unitPrice: 5000 },
      ],
      discountAmount: 5000,
      taxRate: 10,
    });

    const items = snapshot.evaluatedValues.items as Array<Record<string, unknown>>;
    expect(items[0].subtotal).toBe(30000);
    expect(items[1].subtotal).toBe(10000);
    expect(snapshot.evaluatedValues.subtotalAmount).toBe(35000);
    expect(snapshot.evaluatedValues.grandTotal).toBe(38500);
    expect(snapshot.formulaTrace.grandTotal.result).toBe(38500);
    expect(snapshot.valid).toBe(true);
  });

  it('toggles visibleWhen fields and skips validation for hidden fields', () => {
    const seed = createDefaultSeedBundle();
    const capex = seed.schemas.find((s) => s.id === 'schema_capex_procure')!;

    // When procurementMode = bidding and grandTotal < 50000, both soleSourceReason and cfoRiskMemo are hidden
    const snapHidden = evaluateFormSchema(capex, {
      projectTitle: '常规办公软件采购',
      procurementMode: 'bidding',
      items: [{ itemName: 'License', qty: 1, unitPrice: 10000 }],
      discountAmount: 0,
      taxRate: 6,
      soleSourceReason: '',
      cfoRiskMemo: '',
    });
    expect(snapHidden.visibleMap.soleSourceReason).toBe(false);
    expect(snapHidden.visibleMap.cfoRiskMemo).toBe(false);
    expect(snapHidden.valid).toBe(true);

    // When procurementMode = sole_source, soleSourceReason becomes visible & required
    const snapVisible = evaluateFormSchema(capex, {
      projectTitle: '独家专利设备采购',
      procurementMode: 'sole_source',
      items: [{ itemName: 'Sensor', qty: 1, unitPrice: 10000 }],
      discountAmount: 0,
      taxRate: 6,
      soleSourceReason: '',
    });
    expect(snapVisible.visibleMap.soleSourceReason).toBe(true);
    expect(snapVisible.valid).toBe(false);
    expect(snapVisible.errors.some((e) => e.fieldKey === 'soleSourceReason')).toBe(true);
  });

  it('enforces numeric min/max bounds and subtable cell requirements', () => {
    const seed = createDefaultSeedBundle();
    const capex = seed.schemas.find((s) => s.id === 'schema_capex_procure')!;
    const snapshot = evaluateFormSchema(capex, {
      projectTitle: '边界测试',
      items: [{ itemName: '', qty: 0, unitPrice: 100 }],
      taxRate: 45,
    });

    expect(snapshot.valid).toBe(false);
    expect(snapshot.errors.some((e) => e.fieldKey === 'taxRate')).toBe(true);
    expect(snapshot.errors.some((e) => e.columnKey === 'itemName')).toBe(true);
    expect(snapshot.errors.some((e) => e.columnKey === 'qty')).toBe(true);
  });

  it('enforces cross-field rules such as discount cap <= 50% of subtotal', () => {
    const seed = createDefaultSeedBundle();
    const capex = seed.schemas.find((s) => s.id === 'schema_capex_procure')!;
    const snapshot = evaluateFormSchema(capex, {
      projectTitle: '超额减免测试',
      items: [{ itemName: 'Server', qty: 1, unitPrice: 10000 }],
      discountAmount: 6000,
      taxRate: 13,
    });

    expect(snapshot.valid).toBe(false);
    expect(snapshot.errors.some((e) => e.fieldKey === 'discountAmount')).toBe(true);
  });

  it('validates regex pattern on text fields when configured', () => {
    const schema = {
      id: 'sc_pat',
      workspaceId: 'ws_1',
      code: 'PAT_TEST',
      title: 'Pattern Test',
      description: '',
      version: 1,
      updatedAt: '2026-03-01T00:00:00Z',
      fields: [
        {
          key: 'contractCode',
          label: '合同编号',
          type: 'text' as const,
          required: true,
          pattern: '^CT-\\d{4}$',
        },
      ],
      crossFieldRules: [],
    };
    expect(evaluateFormSchema(schema, { contractCode: 'BAD' }).valid).toBe(false);
    expect(evaluateFormSchema(schema, { contractCode: 'CT-2026' }).valid).toBe(true);
  });
});
