import { normalizeSettings } from './settings-panel.js';
import { invoke as nativeInvoke } from '@tauri-apps/api/core';

export function createBrowserInvoke({ storage, download } = {}) {
  let key = 'localpostman-workspace', backupKey = key + '-backup';
  const catalogKey = 'localpostman-workspaces';
  const readCatalog = () => {
    const text = storage.getItem?.(catalogKey);
    if (!text) return { activeId: 'default', workspaces: [{ id: 'default', name: 'My Workspace' }] };
    const value = JSON.parse(text);
    if (!value || !Array.isArray(value.workspaces) || !value.workspaces.some(w => w.id === value.activeId)
      || value.workspaces.some(w => !w.id || typeof w.name !== 'string')) throw Error('工作区列表损坏，已停止切换');
    return value;
  };
  const selectKey = catalog => { key = catalog.activeId === 'default' ? 'localpostman-workspace' : 'localpostman-workspace-' + catalog.activeId; backupKey = key + '-backup'; };
  const validName = name => { name = String(name || '').trim(); if (!name || name.length > 80) throw Error('Workspace name must contain 1–80 characters'); return name; };
  const validate = value => { if (!value || !Array.isArray(value.collections) || !Array.isArray(value.environments || []) || !Array.isArray(value.history || [])) throw Error('Invalid workspace'); return value; };
  const storageError = error => new Error('浏览器本地保存不可用：' + (error?.message || error));
  return async (command, args = {}) => {
    if (command === 'settings_load') {
      const text = storage.getItem?.('localpostman-preferences');
      if (!text) return normalizeSettings();
      try { const settings = JSON.parse(text); if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw Error('Invalid preferences'); return normalizeSettings(settings); }
      catch(error) { throw Error('SETTINGS_INVALID: ' + error.message); }
    }
    if (command === 'settings_save') {
      const previous = storage.getItem?.('localpostman-preferences');
      if (previous) { try { const decoded=JSON.parse(previous); if(!decoded||typeof decoded!=='object'||Array.isArray(decoded))throw Error('Invalid preferences');normalizeSettings(decoded); } catch { throw Error('SETTINGS_INVALID: Previous settings are corrupt; overwrite blocked'); } }
      const settings = normalizeSettings(args.settings);
      for (const [key,min,max] of [['timeout',0,86400000],['maxResponseSize',0,10240],['editorFontSize',8,32],['editorTabSize',1,8],['maxRedirects',0,100]]) if (!Number.isFinite(settings.general[key]) || settings.general[key]<min || settings.general[key]>max) throw Error('Invalid setting: '+key);
      if (previous) storage.setItem('localpostman-preferences-backup', previous);
      storage.setItem('localpostman-preferences', JSON.stringify(settings)); return settings;
    }
    if (command === 'settings_info') return {version:'0.2.0',platform:'Browser preview',arch:'Web',dataDirectory:'Browser local storage',preferencesPath:'Browser local storage'};
    if (command === 'settings_check_update') return {status:'unavailable',message:'No update feed is configured for this local build.'};
    if (command.startsWith('workspace_') && command !== 'workspace_recovery_info') {
      const catalog = readCatalog(), rows = () => catalog.workspaces.map(w => ({ ...w, active: w.id === catalog.activeId }));
      if (command === 'workspace_list') return rows();
      if (command === 'workspace_create') {
        const entry = { id: 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2,8), name: validName(args.name) };
        storage.setItem('localpostman-workspace-' + entry.id, JSON.stringify({ collections: [], environments: [], history: [] }));
        catalog.workspaces.push(entry); storage.setItem(catalogKey, JSON.stringify(catalog)); return { ...entry, active: false };
      }
      const entry = catalog.workspaces.find(w => w.id === args.id);
      if (!entry) throw Error('Workspace does not exist');
      if (command === 'workspace_rename') { entry.name = validName(args.name); storage.setItem(catalogKey, JSON.stringify(catalog)); return; }
      if (command === 'workspace_delete') {
        if (entry.id === catalog.activeId) throw Error('Switch to another workspace before deleting this one');
        // Leave the data key archived so deletion can be recovered from local storage.
        catalog.workspaces = catalog.workspaces.filter(w => w.id !== entry.id); storage.setItem(catalogKey, JSON.stringify(catalog)); return;
      }
      if (command === 'workspace_switch') {
        const nextKey = entry.id === 'default' ? 'localpostman-workspace' : 'localpostman-workspace-' + entry.id;
        const text = storage.getItem(nextKey);
        if (!text) throw Error('WORKSPACE_NOT_FOUND: 工作区文件不存在');
        const workspace = validate(JSON.parse(text)); catalog.activeId = entry.id;
        storage.setItem(catalogKey, JSON.stringify(catalog)); selectKey(catalog); return workspace;
      }
    }
    selectKey(readCatalog());
    if (command === 'load_workspace') {
      let text;
      try { text = storage.getItem(key); } catch (error) { throw storageError(error); }
      if (!text) throw new Error('WORKSPACE_NOT_FOUND: 尚无浏览器本地工作区');
      try { return validate(JSON.parse(text)); } catch { throw new Error('浏览器工作区数据格式错误'); }
    }
    if (command === 'save_workspace') {
      try {
        if (args.workspaceId && args.workspaceId !== readCatalog().activeId) throw Error('WORKSPACE_CHANGED: 当前工作区已切换，已阻止旧工作区写入');
        validate(args.workspace);
        const previous = storage.getItem?.(key);
        if (previous) {
          try { validate(JSON.parse(previous)); } catch { throw Error('工作区数据损坏，已阻止覆盖，请先恢复备份'); }
          storage.setItem(backupKey, previous);
          if (args.archiveCurrent) storage.setItem(key + '-before-git-load', previous);
        }
        storage.setItem(key, JSON.stringify(args.workspace));
      } catch (error) { throw storageError(error); }
      return;
    }
    if (command === 'workspace_recovery_info') {
      try { const text = storage.getItem(backupKey); return { backupAvailable: !!(text && validate(JSON.parse(text))) }; } catch { return { backupAvailable: false }; }
    }
    if (command === 'restore_workspace_backup') {
      try { const text = storage.getItem(backupKey), workspace = validate(JSON.parse(text || 'null')); storage.setItem(key, text); return workspace; } catch (error) { throw storageError(error); }
    }
    if (command === 'mock_status' || command === 'service_status') return [];
    if (command === 'export_workspace' || command === 'export_response') {
      const workspace = command === 'export_workspace';
      if (!download) throw new Error('当前浏览器无法下载文件');
      await download(workspace ? 'localpostman-export.json' : 'response.txt',
        workspace ? JSON.stringify(args.workspace, null, 2) : String(args.body || ''),
        workspace ? 'application/json' : 'text/plain');
      return '已下载到浏览器下载目录';
    }
    const names = { send_request: '发送请求', git_probe: '检查 Git 工作目录', git_choose_folder: '选择 Git 工作目录', git_status: '读取 Git 状态', git_open: '打开 Git 工作区', git_preview: '预览 Git 差异', git_pull: '拉取 Git 工作区', git_sync: '同步 Git 仓库',
      mock_start: '启动本地 Mock 服务', mock_stop: '停止本地 Mock 服务', service_start: '启动本地服务', service_stop: '停止本地服务', service_run: '运行集合服务' };
    throw new Error((names[command] || '此操作') + '需要在桌面客户端中使用');
  };
}

export function createRuntimeInvoke({ isNative, native, browser }) {
  let writes = Promise.resolve(), lastWriteError = null;
  return (command, args) => {
    if (!isNative()) return browser(command, args);
    if (['git_sync', 'git_pull', 'git_preview', 'workspace_switch'].includes(command)) return writes.then(() => { if (lastWriteError) throw new Error('Latest workspace save failed; retry saving before Git or switching workspace: ' + lastWriteError); return native(command, args); });
    if (command !== 'save_workspace') return native(command, args);
    // Capture each edit before queuing it; native file writes must keep edit order.
    const snapshot = JSON.parse(JSON.stringify(args));
    const write = writes.then(() => native(command, snapshot)).then(result => { lastWriteError = null; return result; }, error => { lastWriteError = String(error?.message || error); throw error; });
    writes = write.catch(() => {});
    return write;
  };
}

let browserInvoke;
export const invoke = createRuntimeInvoke({
  isNative: () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__,
  native: nativeInvoke,
  browser: (command, args) => {
    browserInvoke ||= createBrowserInvoke({
      storage: { getItem: key => window.localStorage.getItem(key), setItem: (key, value) => window.localStorage.setItem(key, value) },
      download: async (name, text, type) => {
        const url = URL.createObjectURL(new Blob([text], { type }));
        const link = document.createElement('a');
        link.href = url; link.download = name;
        document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
    });
    return browserInvoke(command, args);
  },
});
