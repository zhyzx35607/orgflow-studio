import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Calculator,
  CheckCircle2,
  Eye,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { evaluateFormSchema, buildInitialFormValues } from '../engine/formEngine';
import {
  FieldType,
  FormFieldSchema,
  FormSchema,
  FormValues,
  WorkspaceMember,
} from '../types/domain';

interface FormStudioViewProps {
  schema: FormSchema;
  members: WorkspaceMember[];
  canEditSchema: boolean;
  canSubmitTicket: boolean;
  onSaveSchema: (next: FormSchema) => Promise<void>;
  onLaunchTicket: (title: string, values: FormValues) => Promise<void>;
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: '单行文本 (text)',
  number: '数值 (number)',
  currency: '金额 (currency)',
  date: '日期 (date)',
  select: '单选下拉 (select)',
  multiselect: '多选标签 (multiselect)',
  member: '组织成员 (member)',
  subtable: '明细子表 (subtable)',
};

export const FormStudioView: React.FC<FormStudioViewProps> = ({
  schema,
  members,
  canEditSchema,
  canSubmitTicket,
  onSaveSchema,
  onLaunchTicket,
}) => {
  const [draftSchema, setDraftSchema] = useState<FormSchema>(() => structuredClone(schema));
  const [selectedFieldKey, setSelectedFieldKey] = useState<string>(
    schema.fields[0]?.key ?? '',
  );
  const [formValues, setFormValues] = useState<FormValues>(() =>
    buildInitialFormValues(schema),
  );
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  React.useEffect(() => {
    setDraftSchema(structuredClone(schema));
    setSelectedFieldKey(schema.fields[0]?.key ?? '');
    setFormValues(buildInitialFormValues(schema));
  }, [schema]);

  const snapshot = useMemo(
    () => evaluateFormSchema(draftSchema, formValues),
    [draftSchema, formValues],
  );

  const selectedField = draftSchema.fields.find((f) => f.key === selectedFieldKey);

  const updateField = (key: string, patch: Partial<FormFieldSchema>) => {
    setDraftSchema((prev) => ({
      ...prev,
      fields: prev.fields.map((f) => (f.key === key ? { ...f, ...patch } : f)),
    }));
  };

  const moveField = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= draftSchema.fields.length) return;
    setDraftSchema((prev) => {
      const copy = [...prev.fields];
      const [moved] = copy.splice(index, 1);
      copy.splice(target, 0, moved);
      return { ...prev, fields: copy };
    });
  };

  const addNewField = (type: FieldType) => {
    const suffix = Date.now().toString(36).slice(-4);
    const key = `field_${suffix}`;
    const newField: FormFieldSchema = {
      key,
      label: `新建${FIELD_TYPE_LABELS[type].split(' ')[0]}`,
      type,
      required: false,
      ...(type === 'select' || type === 'multiselect'
        ? {
            options: [
              { label: '选项 A', value: 'opt_a' },
              { label: '选项 B', value: 'opt_b' },
            ],
          }
        : {}),
      ...(type === 'subtable'
        ? {
            columns: [
              { key: 'name', label: '名称', type: 'text', required: true },
              { key: 'qty', label: '数量', type: 'number', required: true, min: 1 },
              { key: 'price', label: '单价', type: 'currency', required: true, min: 0 },
              {
                key: 'lineTotal',
                label: '小计',
                type: 'currency',
                computedExpr: 'ROUND(qty * price, 2)',
              },
            ],
          }
        : {}),
    };
    setDraftSchema((prev) => ({ ...prev, fields: [...prev.fields, newField] }));
    setSelectedFieldKey(key);
  };

  const deleteField = (key: string) => {
    setDraftSchema((prev) => {
      const remaining = prev.fields.filter((f) => f.key !== key);
      if (selectedFieldKey === key) {
        setSelectedFieldKey(remaining[0]?.key ?? '');
      }
      return { ...prev, fields: remaining };
    });
  };

  const handleSave = async () => {
    await onSaveSchema(draftSchema);
    setStatusBanner(`已保存 Schema 新版本 (v${draftSchema.version + 1})`);
    setTimeout(() => setStatusBanner(null), 3000);
  };

  const handleSubmitTicket = async () => {
    if (!snapshot.valid) {
      setStatusBanner('当前表单存在未通过的校验项，请先修正后再发起审批流程');
      return;
    }
    const titleVal =
      String(
        snapshot.evaluatedValues.projectTitle ||
          snapshot.evaluatedValues.reagentBatchTitle ||
          draftSchema.title,
      ) || draftSchema.title;
    await onLaunchTicket(titleVal, snapshot.evaluatedValues);
    setStatusBanner(`工单「${titleVal}」已成功提交并进入流程引擎！`);
    setTimeout(() => setStatusBanner(null), 3500);
  };

  return (
    <div className="studio-split">
      {/* Left Pane: Schema Metadata Designer */}
      <section className="panel studio-left">
        <div className="panel-header">
          <div>
            <h3>元数据 Schema 设计器</h3>
            <span className="muted">
              编码: <code>{draftSchema.code}</code> · 版本 v{draftSchema.version}
            </span>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canEditSchema}
            onClick={handleSave}
            title={canEditSchema ? '保存为新版本' : '当前角色无 schema:edit 权限'}
          >
            <Save size={15} /> 保存版本
          </button>
        </div>

        <div className="field-adder-bar">
          {(['text', 'number', 'currency', 'select', 'multiselect', 'member', 'subtable'] as FieldType[]).map(
            (t) => (
              <button
                key={t}
                type="button"
                className="chip-btn"
                disabled={!canEditSchema}
                onClick={() => addNewField(t)}
              >
                <Plus size={12} /> {FIELD_TYPE_LABELS[t].split(' ')[0]}
              </button>
            ),
          )}
        </div>

        <div className="designer-body">
          <div className="field-outline-list">
            {draftSchema.fields.map((field, idx) => {
              const active = field.key === selectedFieldKey;
              return (
                <div
                  key={field.key}
                  className={`outline-item ${active ? 'active' : ''}`}
                  onClick={() => setSelectedFieldKey(field.key)}
                >
                  <div className="outline-main">
                    <span className="badge-type">{field.type}</span>
                    <strong>{field.label}</strong>
                    <code>{field.key}</code>
                  </div>
                  <div className="outline-tags">
                    {field.computedExpr && (
                      <span className="mini-tag formula" title={field.computedExpr}>
                        fx
                      </span>
                    )}
                    {field.visibleWhen && (
                      <span className="mini-tag visible" title={field.visibleWhen}>
                        联动
                      </span>
                    )}
                    {canEditSchema && (
                      <>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveField(idx, -1);
                          }}
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveField(idx, 1);
                          }}
                        >
                          <ArrowDown size={13} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn danger"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteField(field.key);
                          }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {selectedField && (
            <div className="inspector-box">
              <h4>字段属性与规则配置 · {selectedField.key}</h4>
              <div className="form-grid-2">
                <label>
                  显示标题
                  <input
                    type="text"
                    value={selectedField.label}
                    disabled={!canEditSchema}
                    onChange={(e) => updateField(selectedField.key, { label: e.target.value })}
                  />
                </label>
                <label>
                  组件类型
                  <select
                    value={selectedField.type}
                    disabled={!canEditSchema}
                    onChange={(e) =>
                      updateField(selectedField.key, { type: e.target.value as FieldType })
                    }
                  >
                    {Object.entries(FIELD_TYPE_LABELS).map(([val, text]) => (
                      <option key={val} value={val}>
                        {text}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={Boolean(selectedField.required)}
                  disabled={!canEditSchema}
                  onChange={(e) =>
                    updateField(selectedField.key, { required: e.target.checked })
                  }
                />
                设为必填字段 (Required)
              </label>

              <label>
                <span>
                  <Eye size={13} /> 显隐联动表达式 (<code>visibleWhen</code>)
                </span>
                <input
                  type="text"
                  placeholder="例如: procurementMode == 'sole_source' || grandTotal >= 50000"
                  value={selectedField.visibleWhen ?? ''}
                  disabled={!canEditSchema}
                  onChange={(e) =>
                    updateField(selectedField.key, {
                      visibleWhen: e.target.value || undefined,
                    })
                  }
                />
              </label>

              <label>
                <span>
                  <Calculator size={13} /> AST 安全计算公式 (<code>computedExpr</code>)
                </span>
                <input
                  type="text"
                  placeholder="例如: ROUND(SUM(items, 'subtotal') - discountAmount, 2)"
                  value={selectedField.computedExpr ?? ''}
                  disabled={!canEditSchema}
                  onChange={(e) =>
                    updateField(selectedField.key, {
                      computedExpr: e.target.value || undefined,
                    })
                  }
                />
              </label>

              {(selectedField.type === 'number' || selectedField.type === 'currency') && (
                <div className="form-grid-2">
                  <label>
                    最小值 (min)
                    <input
                      type="number"
                      value={selectedField.min ?? ''}
                      disabled={!canEditSchema}
                      onChange={(e) =>
                        updateField(selectedField.key, {
                          min: e.target.value === '' ? undefined : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    最大值 (max)
                    <input
                      type="number"
                      value={selectedField.max ?? ''}
                      disabled={!canEditSchema}
                      onChange={(e) =>
                        updateField(selectedField.key, {
                          max: e.target.value === '' ? undefined : Number(e.target.value),
                        })
                      }
                    />
                  </label>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Right Pane: Live Interactive Form Renderer & Snapshot Inspector */}
      <section className="panel studio-right">
        <div className="panel-header">
          <div>
            <h3>
              <Sparkles size={16} /> 实时交互渲染与 AST 校验快照
            </h3>
            <span className="muted">{draftSchema.description}</span>
          </div>
          <button
            type="button"
            className="btn btn-accent"
            disabled={!canSubmitTicket || !snapshot.valid}
            onClick={handleSubmitTicket}
          >
            <Send size={15} /> 发起审批工单
          </button>
        </div>

        {statusBanner && <div className="banner-info">{statusBanner}</div>}

        <div className="live-form-canvas">
          {draftSchema.fields.map((field) => {
            if (!snapshot.visibleMap[field.key]) return null;
            const val = snapshot.evaluatedValues[field.key];
            const isComputed = Boolean(field.computedExpr);
            const fieldErrors = snapshot.errors.filter((e) => e.fieldKey === field.key);

            return (
              <div key={field.key} className="rendered-field">
                <div className="rendered-label-row">
                  <label>
                    {field.label}
                    {field.required && <span className="req-star">*</span>}
                  </label>
                  {isComputed && (
                    <span className="formula-pill">AST 公式自动计算: {field.computedExpr}</span>
                  )}
                </div>

                {field.type === 'text' && (
                  <input
                    type="text"
                    value={String(val ?? '')}
                    readOnly={isComputed}
                    placeholder={field.placeholder}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  />
                )}

                {(field.type === 'number' || field.type === 'currency') && (
                  <input
                    type="number"
                    className={isComputed ? 'readonly-computed' : ''}
                    value={Number(val ?? 0)}
                    readOnly={isComputed}
                    onChange={(e) =>
                      setFormValues((prev) => ({
                        ...prev,
                        [field.key]: e.target.value === '' ? 0 : Number(e.target.value),
                      }))
                    }
                  />
                )}

                {field.type === 'date' && (
                  <input
                    type="date"
                    value={String(val ?? '')}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  />
                )}

                {field.type === 'select' && (
                  <select
                    value={String(val ?? '')}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  >
                    <option value="">-- 请选择 --</option>
                    {(field.options ?? []).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                )}

                {field.type === 'member' && (
                  <select
                    value={String(val ?? '')}
                    onChange={(e) =>
                      setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  >
                    <option value="">-- 选择空间成员 --</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.title})
                      </option>
                    ))}
                  </select>
                )}

                {field.type === 'multiselect' && (
                  <div className="multiselect-group">
                    {(field.options ?? []).map((opt) => {
                      const arr = Array.isArray(val) ? (val as string[]) : [];
                      const checked = arr.includes(opt.value);
                      return (
                        <label key={opt.value} className="multi-chip">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const nextArr = e.target.checked
                                ? [...arr, opt.value]
                                : arr.filter((item) => item !== opt.value);
                              setFormValues((prev) => ({ ...prev, [field.key]: nextArr }));
                            }}
                          />
                          {opt.label}
                        </label>
                      );
                    })}
                  </div>
                )}

                {field.type === 'subtable' && (
                  <div className="subtable-wrapper">
                    <table className="subtable">
                      <thead>
                        <tr>
                          {(field.columns ?? []).map((col) => (
                            <th key={col.key}>
                              {col.label}
                              {col.computedExpr && <span className="fx-badge">fx</span>}
                            </th>
                          ))}
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(Array.isArray(val) ? (val as Record<string, unknown>[]) : []).map(
                          (row, rIdx) => (
                            <tr key={rIdx}>
                              {(field.columns ?? []).map((col) => {
                                const isColComputed = Boolean(col.computedExpr);
                                return (
                                  <td key={col.key}>
                                    <input
                                      type={
                                        col.type === 'number' || col.type === 'currency'
                                          ? 'number'
                                          : 'text'
                                      }
                                      readOnly={isColComputed}
                                      className={isColComputed ? 'readonly-computed' : ''}
                                      value={String(row[col.key] ?? '')}
                                      onChange={(e) => {
                                        const currentRows = Array.isArray(formValues[field.key])
                                          ? [...(formValues[field.key] as Record<string, unknown>[])]
                                          : [...(val as Record<string, unknown>[])];
                                        const parsed =
                                          col.type === 'number' || col.type === 'currency'
                                            ? Number(e.target.value || 0)
                                            : e.target.value;
                                        currentRows[rIdx] = {
                                          ...currentRows[rIdx],
                                          [col.key]: parsed,
                                        };
                                        setFormValues((prev) => ({
                                          ...prev,
                                          [field.key]: currentRows,
                                        }));
                                      }}
                                    />
                                  </td>
                                );
                              })}
                              <td>
                                <button
                                  type="button"
                                  className="icon-btn danger"
                                  onClick={() => {
                                    const currentRows = (
                                      Array.isArray(val) ? (val as Record<string, unknown>[]) : []
                                    ).filter((_, idx) => idx !== rIdx);
                                    setFormValues((prev) => ({
                                      ...prev,
                                      [field.key]: currentRows,
                                    }));
                                  }}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                    <button
                      type="button"
                      className="chip-btn mt-8"
                      onClick={() => {
                        const currentRows = Array.isArray(val)
                          ? [...(val as Record<string, unknown>[])]
                          : [];
                        const blankRow: Record<string, unknown> = {};
                        for (const col of field.columns ?? []) {
                          blankRow[col.key] =
                            col.type === 'number' || col.type === 'currency' ? 1 : '';
                        }
                        setFormValues((prev) => ({
                          ...prev,
                          [field.key]: [...currentRows, blankRow],
                        }));
                      }}
                    >
                      <Plus size={13} /> 新增明细行
                    </button>
                  </div>
                )}

                {fieldErrors.map((err, i) => (
                  <div key={i} className="field-error">
                    <AlertCircle size={13} /> {err.message}
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        {/* Live Validation & Formula Evaluation Snapshot Footer */}
        <div className="snapshot-panel">
          <div className="snapshot-status">
            {snapshot.valid ? (
              <span className="status-ok">
                <CheckCircle2 size={15} /> 校验通过（0 错误）· 实时计算追踪已就绪
              </span>
            ) : (
              <span className="status-err">
                <AlertCircle size={15} /> 待修正校验项：{snapshot.errors.length} 项
              </span>
            )}
          </div>
          <pre className="snapshot-json">
            {JSON.stringify(
              {
                valid: snapshot.valid,
                visibleFields: Object.entries(snapshot.visibleMap)
                  .filter(([, vis]) => vis)
                  .map(([k]) => k),
                formulaTrace: snapshot.formulaTrace,
                errors: snapshot.errors,
              },
              null,
              2,
            )}
          </pre>
        </div>
      </section>
    </div>
  );
};
