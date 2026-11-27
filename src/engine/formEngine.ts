import {
  FieldValidationError,
  FormEvaluationSnapshot,
  FormFieldSchema,
  FormSchema,
  FormValues,
} from '../types/domain';
import { evaluateBooleanExpression, evaluateExpression } from './astEvaluator';

function isValueEmpty(value: unknown, fieldType: FormFieldSchema['type']): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (fieldType === 'multiselect' || fieldType === 'subtable') {
    return !Array.isArray(value) || value.length === 0;
  }
  return false;
}

export function buildInitialFormValues(
  schema: FormSchema,
  seedValues: FormValues = {},
): FormValues {
  const next: FormValues = { ...seedValues };

  for (const field of schema.fields) {
    if (next[field.key] !== undefined) continue;
    if (field.defaultValue !== undefined) {
      next[field.key] = structuredClone(field.defaultValue);
      continue;
    }
    switch (field.type) {
      case 'number':
      case 'currency':
        next[field.key] = 0;
        break;
      case 'multiselect':
      case 'subtable':
        next[field.key] = [];
        break;
      default:
        next[field.key] = '';
    }
  }

  return next;
}

/**
 * Evaluates subtable row computed columns, top-level computedExpr fields (multi-pass for chained formulas),
 * visibleWhen rules, field constraints, and cross-field validation rules.
 */
export function evaluateFormSchema(
  schema: FormSchema,
  rawValues: FormValues,
): FormEvaluationSnapshot {
  const values: FormValues = structuredClone(buildInitialFormValues(schema, rawValues));
  const formulaTrace: FormEvaluationSnapshot['formulaTrace'] = {};

  // Step 1: Evaluate subtable row-level computed columns first (e.g., subtotal = ROUND(qty * unitPrice, 2))
  for (const field of schema.fields) {
    if (field.type === 'subtable' && field.columns) {
      const rows = Array.isArray(values[field.key])
        ? (values[field.key] as Record<string, unknown>[])
        : [];
      const nextRows = rows.map((row, rowIdx) => {
        const rowCopy: Record<string, unknown> = { ...row };
        for (const col of field.columns ?? []) {
          if (col.computedExpr) {
            try {
              const rowScope = { ...values, ...rowCopy, row: rowCopy, rowIndex: rowIdx };
              const computedVal = evaluateExpression(col.computedExpr, rowScope);
              rowCopy[col.key] = computedVal;
              formulaTrace[`${field.key}[${rowIdx}].${col.key}`] = {
                expression: col.computedExpr,
                result: computedVal,
              };
            } catch (err) {
              formulaTrace[`${field.key}[${rowIdx}].${col.key}`] = {
                expression: col.computedExpr,
                result: null,
                error: err instanceof Error ? err.message : String(err),
              };
            }
          }
        }
        return rowCopy;
      });
      values[field.key] = nextRows;
    }
  }

  // Step 2: Evaluate top-level computedExpr fields (2 passes to allow chained dependencies like tax -> grandTotal)
  const computedFields = schema.fields.filter((f) => Boolean(f.computedExpr));
  for (let pass = 0; pass < 2; pass += 1) {
    for (const field of computedFields) {
      if (!field.computedExpr) continue;
      try {
        const result = evaluateExpression(field.computedExpr, values);
        values[field.key] = result;
        formulaTrace[field.key] = {
          expression: field.computedExpr,
          result,
        };
      } catch (err) {
        formulaTrace[field.key] = {
          expression: field.computedExpr,
          result: values[field.key],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }

  // Step 3: Evaluate declarative visibleWhen rules
  const visibleMap: Record<string, boolean> = {};
  for (const field of schema.fields) {
    try {
      visibleMap[field.key] = evaluateBooleanExpression(field.visibleWhen, values, true);
    } catch {
      visibleMap[field.key] = true;
    }
  }

  // Step 4: Validate visible fields & subtable cells
  const errors: FieldValidationError[] = [];

  for (const field of schema.fields) {
    if (!visibleMap[field.key]) continue;
    const val = values[field.key];

    if (field.required && isValueEmpty(val, field.type)) {
      errors.push({
        fieldKey: field.key,
        label: field.label,
        message: `「${field.label}」为必填项`,
      });
      continue;
    }

    if (isValueEmpty(val, field.type)) continue;

    if (field.type === 'number' || field.type === 'currency') {
      const numVal = Number(val);
      if (!Number.isFinite(numVal)) {
        errors.push({
          fieldKey: field.key,
          label: field.label,
          message: `「${field.label}」必须是有效数值`,
        });
      } else {
        if (field.min !== undefined && numVal < field.min) {
          errors.push({
            fieldKey: field.key,
            label: field.label,
            message: `「${field.label}」不能小于 ${field.min}`,
          });
        }
        if (field.max !== undefined && numVal > field.max) {
          errors.push({
            fieldKey: field.key,
            label: field.label,
            message: `「${field.label}」不能大于 ${field.max}`,
          });
        }
      }
    }

    if (field.type === 'text' && field.pattern && typeof val === 'string') {
      const regex = new RegExp(field.pattern);
      if (!regex.test(val)) {
        errors.push({
          fieldKey: field.key,
          label: field.label,
          message: `「${field.label}」格式不符合校验规则`,
        });
      }
    }

    if (field.type === 'subtable' && Array.isArray(val) && field.columns) {
      val.forEach((rowObj, idx) => {
        const row = (rowObj ?? {}) as Record<string, unknown>;
        for (const col of field.columns ?? []) {
          const cell = row[col.key];
          if (col.required && (cell === undefined || cell === null || cell === '')) {
            errors.push({
              fieldKey: field.key,
              label: `${field.label} 第${idx + 1}行-${col.label}`,
              rowIndex: idx,
              columnKey: col.key,
              message: `${field.label} 第 ${idx + 1} 行「${col.label}」不能为空`,
            });
            continue;
          }
          if ((col.type === 'number' || col.type === 'currency') && cell !== undefined && cell !== '') {
            const cellNum = Number(cell);
            if (col.min !== undefined && cellNum < col.min) {
              errors.push({
                fieldKey: field.key,
                label: `${field.label} 第${idx + 1}行-${col.label}`,
                rowIndex: idx,
                columnKey: col.key,
                message: `${field.label} 第 ${idx + 1} 行「${col.label}」不能小于 ${col.min}`,
              });
            }
            if (col.max !== undefined && cellNum > col.max) {
              errors.push({
                fieldKey: field.key,
                label: `${field.label} 第${idx + 1}行-${col.label}`,
                rowIndex: idx,
                columnKey: col.key,
                message: `${field.label} 第 ${idx + 1} 行「${col.label}」不能大于 ${col.max}`,
              });
            }
          }
        }
      });
    }
  }

  // Step 5: Cross-field validation rules (conditionExpr must evaluate to true to pass)
  for (const rule of schema.crossFieldRules) {
    try {
      const passed = evaluateBooleanExpression(rule.conditionExpr, values, true);
      if (!passed) {
        errors.push({
          fieldKey: rule.targetFieldKey ?? '__form__',
          label: rule.name,
          message: rule.errorMessage,
        });
      }
    } catch (err) {
      errors.push({
        fieldKey: rule.targetFieldKey ?? '__form__',
        label: rule.name,
        message: `跨字段校验表达式异常: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return {
    evaluatedValues: values,
    visibleMap,
    errors,
    valid: errors.length === 0,
    formulaTrace,
  };
}
