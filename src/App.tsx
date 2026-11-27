import React, { useCallback, useEffect, useState } from 'react';
import {
  Database,
  FileSpreadsheet,
  GitPullRequest,
  Layers,
  Network,
  RefreshCw,
  UserCheck,
} from 'lucide-react';
import { FormStudioView } from './components/FormStudioView';
import { WorkflowCenterView } from './components/WorkflowCenterView';
import { WorkspaceDocsView } from './components/WorkspaceDocsView';
import { hasWorkspacePermission } from './engine/workspaceEngine';
import { defaultGateway, GatewayMode, WorkspaceSnapshot } from './services/gateway';
import { FormSchema, FormValues, WorkflowDefinition, Workspace } from './types/domain';

type ActiveTab = 'form-studio' | 'workflow-center' | 'workspace-docs';

export const App: React.FC = () => {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string>('ws_nebula');
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null);
  const [activeActorId, setActiveActorId] = useState<string>('mem_lin');
  const [activeTab, setActiveTab] = useState<ActiveTab>('form-studio');
  const [gatewayMode, setGatewayMode] = useState<GatewayMode>('local');
  const [backendAvailable, setBackendAvailable] = useState<boolean>(false);

  const refreshWorkspace = useCallback(async (wsId: string) => {
    const wsList = await defaultGateway.listWorkspaces();
    setWorkspaces(wsList);
    const snap = await defaultGateway.getWorkspaceSnapshot(wsId);
    setSnapshot(snap);
    setActiveActorId((prev) =>
      snap.members.some((m) => m.id === prev) ? prev : (snap.members[0]?.id ?? ''),
    );
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const reachable = await defaultGateway.probeBackend();
      if (!mounted) return;
      setBackendAvailable(reachable);
      await refreshWorkspace(currentWorkspaceId);
    })();
    return () => {
      mounted = false;
    };
  }, [currentWorkspaceId, refreshWorkspace]);

  const handleToggleGateway = async (nextMode: GatewayMode) => {
    if (nextMode === 'fastapi') {
      const ok = await defaultGateway.probeBackend();
      setBackendAvailable(ok);
      if (!ok) {
        alert('未检测到本地 FastAPI 服务 (http://127.0.0.1:8000)，已保持浏览器离线网关模式。');
        return;
      }
    }
    defaultGateway.setMode(nextMode);
    setGatewayMode(nextMode);
    await refreshWorkspace(currentWorkspaceId);
  };

  const handleResetDemo = async () => {
    defaultGateway.setMode('local');
    setGatewayMode('local');
    defaultGateway.resetLocalDemoData();
    await refreshWorkspace(currentWorkspaceId);
  };

  if (!snapshot) {
    return <div className="loading-screen">正在加载 OrgFlow Studio 工作空间元数据...</div>;
  }

  const currentActor =
    snapshot.members.find((m) => m.id === activeActorId) ?? snapshot.members[0];
  const activeSchema = snapshot.schemas[0];
  const activeWorkflow = snapshot.workflows[0];

  const canEditSchema = hasWorkspacePermission(
    currentActor,
    snapshot.roles,
    currentWorkspaceId,
    'schema:edit',
  );
  const canSubmitTicket = hasWorkspacePermission(
    currentActor,
    snapshot.roles,
    currentWorkspaceId,
    'ticket:submit',
  );
  const canEditDocs = hasWorkspacePermission(
    currentActor,
    snapshot.roles,
    currentWorkspaceId,
    'doc:edit',
  );

  const pendingForActor = snapshot.tickets.filter((t) =>
    t.currentAssignees.includes(currentActor?.id ?? ''),
  ).length;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-logo">
            <Layers size={20} />
          </div>
          <div>
            <h1>OrgFlow Studio</h1>
            <span>元数据驱动组织协同与安全 AST 动态表单底座</span>
          </div>
        </div>

        <nav className="main-tabs">
          <button
            type="button"
            className={activeTab === 'form-studio' ? 'active' : ''}
            onClick={() => setActiveTab('form-studio')}
          >
            <FileSpreadsheet size={16} /> Form Studio 设计器
          </button>
          <button
            type="button"
            className={activeTab === 'workflow-center' ? 'active' : ''}
            onClick={() => setActiveTab('workflow-center')}
          >
            <GitPullRequest size={16} /> 多级会签与工单流转
            {pendingForActor > 0 && <span className="nav-count">{pendingForActor}</span>}
          </button>
          <button
            type="button"
            className={activeTab === 'workspace-docs' ? 'active' : ''}
            onClick={() => setActiveTab('workspace-docs')}
          >
            <Network size={16} /> 组织权限与知识卡片
          </button>
        </nav>

        <div className="context-controls">
          <label className="ctx-select" title="切换多租户组织空间（数据严格隔离）">
            <span>空间:</span>
            <select
              value={currentWorkspaceId}
              onChange={(e) => setCurrentWorkspaceId(e.target.value)}
            >
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
          </label>

          <label className="ctx-select" title="切换当前登录成员角色视角">
            <UserCheck size={14} />
            <select
              value={currentActor?.id ?? ''}
              onChange={(e) => setActiveActorId(e.target.value)}
            >
              {snapshot.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.title}
                </option>
              ))}
            </select>
          </label>

          <div className="gateway-switch">
            <Database size={14} />
            <select
              value={gatewayMode}
              onChange={(e) => handleToggleGateway(e.target.value as GatewayMode)}
            >
              <option value="local">离线 LocalStorage 网关</option>
              <option value="fastapi">
                FastAPI 后端网关 {backendAvailable ? '(在线)' : '(未启动)'}
              </option>
            </select>
            {gatewayMode === 'local' && (
              <button
                type="button"
                className="icon-btn"
                title="重置演示种子数据"
                onClick={handleResetDemo}
              >
                <RefreshCw size={14} />
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="workspace-main">
        {activeTab === 'form-studio' && activeSchema && (
          <FormStudioView
            schema={activeSchema}
            members={snapshot.members}
            canEditSchema={canEditSchema}
            canSubmitTicket={canSubmitTicket}
            onSaveSchema={async (next: FormSchema) => {
              await defaultGateway.saveFormSchema(currentWorkspaceId, next);
              await refreshWorkspace(currentWorkspaceId);
            }}
            onLaunchTicket={async (title: string, values: FormValues) => {
              if (!activeWorkflow || !currentActor) return;
              await defaultGateway.submitTicket({
                workspaceId: currentWorkspaceId,
                formSchemaId: activeSchema.id,
                workflowId: activeWorkflow.id,
                applicantId: currentActor.id,
                title,
                values,
              });
              await refreshWorkspace(currentWorkspaceId);
              setActiveTab('workflow-center');
            }}
          />
        )}

        {activeTab === 'workflow-center' && currentActor && (
          <WorkflowCenterView
            workflows={snapshot.workflows}
            tickets={snapshot.tickets}
            members={snapshot.members}
            currentActor={currentActor}
            onActOnTicket={async (params) => {
              await defaultGateway.actOnTicket({
                workspaceId: currentWorkspaceId,
                actorId: currentActor.id,
                ...params,
              });
              await refreshWorkspace(currentWorkspaceId);
            }}
            onSaveWorkflow={async (wf: WorkflowDefinition) => {
              await defaultGateway.saveWorkflow(currentWorkspaceId, wf);
              await refreshWorkspace(currentWorkspaceId);
            }}
          />
        )}

        {activeTab === 'workspace-docs' && currentActor && (
          <WorkspaceDocsView
            workspaceId={currentWorkspaceId}
            departments={snapshot.departments}
            roles={snapshot.roles}
            members={snapshot.members}
            schemas={snapshot.schemas}
            docs={snapshot.docs}
            currentActor={currentActor}
            canEditDocs={canEditDocs}
            onCreateDoc={async (card) => {
              await defaultGateway.createDocCard(currentWorkspaceId, card);
              await refreshWorkspace(currentWorkspaceId);
            }}
          />
        )}
      </main>
    </div>
  );
};
