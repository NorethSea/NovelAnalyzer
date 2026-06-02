import { useEffect, useReducer, useRef, useState } from 'react'
import { api, LLMConfig } from '../api'
import FolderPicker from '../components/FolderPicker'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import LoadingState from '../components/LoadingState'
import Button from '../components/Button'

interface Preset {
  id: number
  name: string
  is_active: number
  provider: string
  model: string
  created_at: string
}

type Tab = 'llm' | 'prompt' | 'folders' | 'tokens'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'llm', label: 'LLM 配置', icon: '🤖' },
  { key: 'prompt', label: 'Prompt 配置', icon: '✍️' },
  { key: 'folders', label: '文件夹', icon: '📁' },
  { key: 'tokens', label: 'Token 统计', icon: '📊' },
]

interface FormState {
  provider: string
  apiKey: string
  baseUrl: string
  model: string
  chunkSize: string
  overlapRatio: string
  rpmLimit: string
  timeoutSec: string
  maxTokens: string
  folderA: string[]
  folderB: string[]
  autoScan: boolean
  promptAnalyze: string
  promptMerge: string
  promptRecommend: string
}

type FormAction =
  | { type: 'set'; key: keyof FormState; value: FormState[keyof FormState] }
  | { type: 'apply'; config: LLMConfig; defaults?: DefaultPrompts }
  | { type: 'reset' }

interface DefaultPrompts {
  prompt_analyze: string
  prompt_merge: string
  prompt_recommend: string
}

const INITIAL_FORM: FormState = {
  provider: 'openai',
  apiKey: '',
  baseUrl: '',
  model: '',
  chunkSize: '200000',
  overlapRatio: '0.1',
  rpmLimit: '0',
  timeoutSec: '300',
  maxTokens: '',
  folderA: [],
  folderB: [],
  autoScan: true,
  promptAnalyze: '',
  promptMerge: '',
  promptRecommend: '',
}

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'set':
      return { ...state, [action.key]: action.value }
    case 'apply': {
      const { config, defaults } = action
      return {
        provider: config.provider,
        apiKey: config.api_key || '',
        baseUrl: config.base_url || '',
        model: config.model,
        chunkSize: String(config.chunk_size),
        overlapRatio: String(config.overlap_ratio ?? 0.1),
        rpmLimit: String(config.rpm_limit ?? 0),
        timeoutSec: String(config.timeout ?? 300),
        maxTokens: config.max_tokens != null ? String(config.max_tokens) : '',
        folderA: parseFolderPaths(config.folder_a),
        folderB: parseFolderPaths(config.folder_b),
        autoScan: config.auto_scan === 1,
        promptAnalyze: config.prompt_analyze || defaults?.prompt_analyze || '',
        promptMerge: config.prompt_merge || defaults?.prompt_merge || '',
        promptRecommend: config.prompt_recommend || defaults?.prompt_recommend || '',
      }
    }
    case 'reset':
      return INITIAL_FORM
  }
}

function parseFolderPaths(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === 'string' && s.length > 0)
    if (typeof parsed === 'string' && parsed) return [parsed]
    return []
  } catch {
    return raw ? [raw] : []
  }
}

function stringifyFolderPaths(paths: string[]): string | undefined {
  const filtered = paths.filter(Boolean)
  return filtered.length > 0 ? JSON.stringify(filtered) : undefined
}

function getProviderDefaults(p: string) {
  switch (p) {
    case 'openai': return { model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' }
    case 'claude': return { model: 'claude-sonnet-4-20250514', baseUrl: '' }
    case 'ollama': return { model: 'llama3', baseUrl: 'http://localhost:11434' }
    default: return { model: '', baseUrl: '' }
  }
}

export default function Settings() {
  const toast = useToast()
  const confirm = useConfirm()

  const [tab, setTab] = useState<Tab>('llm')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message?: string } | null>(null)

  const [presets, setPresets] = useState<Preset[]>([])
  const [presetName, setPresetName] = useState('')
  const [editingPresetId, setEditingPresetId] = useState<number | null>(null)
  const [editingPresetName, setEditingPresetName] = useState('')
  const renameSubmittedRef = useRef(false)

  const [form, dispatch] = useReducer(formReducer, INITIAL_FORM)
  const [defaultPrompts, setDefaultPrompts] = useState<DefaultPrompts | null>(null)
  const [showPrompts, setShowPrompts] = useState({ analyze: true, merge: false, recommend: false })

  const [tokenStats, setTokenStats] = useState<{
    total_calls: number;
    total_prompt_tokens: number;
    total_completion_tokens: number;
    total_tokens: number;
    by_model: { model: string; calls: number; total_tokens: number }[];
    by_provider: { provider: string; calls: number; total_tokens: number }[];
  } | null>(null)
  const [tokenLoading, setTokenLoading] = useState(false)
  const [tokenClearing, setTokenClearing] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([api.config.get(), api.config.getDefaults()])
      .then(([data, defaults]) => {
        if (cancelled) return
        dispatch({ type: 'apply', config: data, defaults })
        setDefaultPrompts(defaults)
      })
      .catch(err => { if (!cancelled) toast.error(err instanceof Error ? err.message : '加载配置失败') })
      .finally(() => { if (!cancelled) setLoading(false) })

    api.config.getPresets()
      .then(data => { if (!cancelled) setPresets(data) })
      .catch(err => { if (!cancelled) toast.error(err instanceof Error ? err.message : '加载方案失败') })

    return () => { cancelled = true }
  }, [toast])

  useEffect(() => {
    if (tab !== 'tokens') return
    let cancelled = false
    setTokenLoading(true)
    api.config.getTokenUsage()
      .then(data => { if (!cancelled) setTokenStats(data) })
      .catch(err => { if (!cancelled) toast.error(err instanceof Error ? err.message : '加载 Token 统计失败') })
      .finally(() => { if (!cancelled) setTokenLoading(false) })
    return () => { cancelled = true }
  }, [tab, toast])

  async function handleClearTokenUsage() {
    const ok = await confirm({
      title: '清空 Token 记录',
      message: '确定要清空所有 Token 消耗记录吗？此操作不可恢复。',
      variant: 'danger',
      confirmText: '清空',
    })
    if (!ok) return
    setTokenClearing(true)
    try {
      await api.config.clearTokenUsage()
      setTokenStats(null)
      toast.success('Token 记录已清空')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '清空失败')
    } finally {
      setTokenClearing(false)
    }
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    dispatch({ type: 'set', key, value })
  }

  async function handleSavePreset() {
    if (!presetName.trim()) return
    try {
      await api.config.savePreset(presetName.trim(), {
        provider: form.provider,
        api_key: form.apiKey || undefined,
        base_url: form.baseUrl || undefined,
        model: form.model,
        chunk_size: Number(form.chunkSize),
        overlap_ratio: Number(form.overlapRatio),
        rpm_limit: Number(form.rpmLimit),
        timeout: Number(form.timeoutSec),
        max_tokens: form.maxTokens ? Number(form.maxTokens) : null,
        prompt_analyze: form.promptAnalyze || undefined,
        prompt_merge: form.promptMerge || undefined,
        prompt_recommend: form.promptRecommend || undefined,
        folder_a: stringifyFolderPaths(form.folderA),
        folder_b: stringifyFolderPaths(form.folderB),
        auto_scan: form.autoScan ? 1 : 0,
      })
      setPresetName('')
      const data = await api.config.getPresets()
      setPresets(data)
      toast.success('方案已保存')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败')
    }
  }

  async function handleActivatePreset(id: number) {
    try {
      const [data, defaults] = await Promise.all([api.config.activatePreset(id), api.config.getDefaults()])
      dispatch({ type: 'apply', config: data, defaults })
      setDefaultPrompts(defaults)
      const presetsData = await api.config.getPresets()
      setPresets(presetsData)
      toast.success('已切换方案')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '切换失败')
    }
  }

  async function handleDeletePreset(id: number) {
    const ok = await confirm({
      title: '删除方案', message: '确定要删除这个方案吗？', variant: 'danger',
    })
    if (!ok) return
    try {
      await api.config.deletePreset(id)
      const data = await api.config.getPresets()
      setPresets(data)
      toast.success('方案已删除')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  async function handleRenamePreset(id: number) {
    if (renameSubmittedRef.current) return
    const name = editingPresetName.trim()
    if (!name) {
      setEditingPresetId(null)
      return
    }
    renameSubmittedRef.current = true
    try {
      await api.config.renamePreset(id, name)
      setEditingPresetId(null)
      const data = await api.config.getPresets()
      setPresets(data)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '重命名失败')
    } finally {
      renameSubmittedRef.current = false
    }
  }

  function startEditPreset(p: Preset) {
    setEditingPresetId(p.id)
    setEditingPresetName(p.name)
    renameSubmittedRef.current = false
  }

  async function handleSave() {
    setSaving(true)
    try {
      const updated = await api.config.update({
        provider: form.provider,
        api_key: form.apiKey || undefined,
        base_url: form.baseUrl || undefined,
        model: form.model,
        chunk_size: Number(form.chunkSize),
        overlap_ratio: Number(form.overlapRatio),
        rpm_limit: Number(form.rpmLimit),
        timeout: Number(form.timeoutSec),
        max_tokens: form.maxTokens ? Number(form.maxTokens) : null,
        prompt_analyze: form.promptAnalyze || undefined,
        prompt_merge: form.promptMerge || undefined,
        prompt_recommend: form.promptRecommend || undefined,
        folder_a: stringifyFolderPaths(form.folderA),
        folder_b: stringifyFolderPaths(form.folderB),
        auto_scan: form.autoScan ? 1 : 0,
      })
      const defaults = await api.config.getDefaults()
      dispatch({ type: 'apply', config: updated, defaults })
      setDefaultPrompts(defaults)
      toast.success('配置已保存')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api.config.test()
      setTestResult(result)
    } catch (error) {
      setTestResult({ success: false, message: error instanceof Error ? error.message : '测试失败' })
    } finally {
      setTesting(false)
    }
  }

  function handleProviderChange(p: string) {
    const oldDefaults = getProviderDefaults(form.provider)
    const newDefaults = getProviderDefaults(p)
    dispatch({ type: 'set', key: 'provider', value: p })
    if (!form.model || form.model === oldDefaults.model) {
      dispatch({ type: 'set', key: 'model', value: newDefaults.model })
    }
    if (!form.baseUrl || form.baseUrl === oldDefaults.baseUrl) {
      dispatch({ type: 'set', key: 'baseUrl', value: newDefaults.baseUrl })
    }
  }

  function resetPrompt(type: 'analyze' | 'merge' | 'recommend') {
    if (!defaultPrompts) return
    if (type === 'analyze') setField('promptAnalyze', defaultPrompts.prompt_analyze)
    else if (type === 'merge') setField('promptMerge', defaultPrompts.prompt_merge)
    else setField('promptRecommend', defaultPrompts.prompt_recommend)
  }

  if (loading) return <LoadingState />

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">设置</h2>

      <div className="bg-white shadow rounded-lg p-4 mb-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-3">
          <h3 className="text-sm font-semibold text-gray-700">方案管理</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSavePreset()}
              placeholder="输入方案名称…"
              aria-label="新方案名称"
              className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <Button size="sm" onClick={handleSavePreset} disabled={!presetName.trim()}>
              保存为方案
            </Button>
          </div>
        </div>

        {presets.length === 0 ? (
          <p className="text-xs text-gray-400">暂无保存的方案。调整下方任意 tab 的配置后，可保存为方案以便快速切换。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <div key={p.id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border ${
                p.is_active ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-gray-50 border-gray-200 text-gray-600'
              }`}>
                {editingPresetId === p.id ? (
                  <input
                    type="text"
                    value={editingPresetName}
                    onChange={(e) => setEditingPresetName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRenamePreset(p.id)
                      if (e.key === 'Escape') setEditingPresetId(null)
                    }}
                    onBlur={() => handleRenamePreset(p.id)}
                    autoFocus
                    aria-label="重命名方案"
                    className="w-24 px-1 py-0 text-sm border border-indigo-300 rounded focus:outline-none"
                  />
                ) : (
                  <span
                    onDoubleClick={() => startEditPreset(p)}
                    className="cursor-pointer"
                    title="双击重命名"
                  >
                    {p.name}
                  </span>
                )}
                <span className="text-xs text-gray-400">{p.provider}/{p.model}</span>
                {p.is_active ? (
                  <span className="text-xs text-indigo-500 font-medium">使用中</span>
                ) : (
                  <div className="flex gap-1">
                    <button onClick={() => handleActivatePreset(p.id)} className="text-xs text-indigo-600 hover:text-indigo-800">切换</button>
                    <button onClick={() => handleDeletePreset(p.id)} className="text-xs text-gray-400 hover:text-red-500">删除</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-b border-gray-200 mb-6 overflow-x-auto">
        <nav className="flex -mb-px min-w-max" aria-label="设置分组">
          {TABS.map(t => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${
                tab === t.key
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span className="mr-1" aria-hidden="true">{t.icon}</span>{t.label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'llm' && (
        <div className="bg-white shadow rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">LLM 配置</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Provider" htmlFor="provider">
              <select id="provider" value={form.provider} onChange={(e) => handleProviderChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="openai">OpenAI</option>
                <option value="claude">Claude</option>
                <option value="ollama">Ollama (本地)</option>
              </select>
            </Field>
            <Field label="Model" htmlFor="model">
              <input id="model" type="text" value={form.model} onChange={(e) => setField('model', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="模型名称" />
            </Field>
            {form.provider !== 'ollama' && (
              <Field label="API Key" htmlFor="apiKey">
                <input id="apiKey" type="password" value={form.apiKey} onChange={(e) => setField('apiKey', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="API密钥" />
              </Field>
            )}
            <Field label="Base URL" htmlFor="baseUrl">
              <input id="baseUrl" type="text" value={form.baseUrl} onChange={(e) => setField('baseUrl', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="API地址" />
            </Field>
            <Field label="分块大小（字符）" htmlFor="chunkSize" hint="大文件将按此大小分块分析，默认 200000">
              <input id="chunkSize" type="number" value={form.chunkSize} onChange={(e) => setField('chunkSize', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                min="10000" step="10000" />
            </Field>
            <Field label="分块重叠比例" htmlFor="overlapRatio" hint="防止关键情节断裂，默认 0.1 (10%)">
              <input id="overlapRatio" type="number" value={form.overlapRatio} onChange={(e) => setField('overlapRatio', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                min="0" max="0.5" step="0.05" />
            </Field>
            <Field label="RPM 限制（每分钟请求数）" htmlFor="rpmLimit" hint="0 表示不限制，设置后自动控制请求频率">
              <input id="rpmLimit" type="number" value={form.rpmLimit} onChange={(e) => setField('rpmLimit', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                min="0" step="1" />
            </Field>
            <Field label="请求超时（秒）" htmlFor="timeoutSec" hint="本地模型分析大文件时建议设为 600-900 秒">
              <input id="timeoutSec" type="number" value={form.timeoutSec} onChange={(e) => setField('timeoutSec', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                min="30" step="30" />
            </Field>
            <Field label="最大输出 Token（可选）" htmlFor="maxTokens" hint="留空使用模型默认值">
              <input id="maxTokens" type="number" value={form.maxTokens} onChange={(e) => setField('maxTokens', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                min="100" step="100" />
            </Field>
          </div>
          <div className="mt-6 flex space-x-3">
            <Button variant="secondary" onClick={handleTest} loading={testing}>
              测试连接
            </Button>
            <Button variant="primary" onClick={handleSave} loading={saving}>
              保存配置
            </Button>
          </div>
          {testResult && (
            <div className={`mt-4 p-3 rounded-md ${testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {testResult.success ? `连接成功: ${testResult.message}` : `连接失败: ${testResult.message}`}
            </div>
          )}
        </div>
      )}

      {tab === 'prompt' && (
        <div className="bg-white shadow rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-2">Prompt 配置</h3>
          <p className="text-sm text-gray-500 mb-4">
            自定义分析和推荐使用的 prompt。留空使用默认值。可用变量：
            <code className="bg-gray-100 px-1 rounded text-xs ml-1">{'{title}'}</code>
            <code className="bg-gray-100 px-1 rounded text-xs ml-1">{'{content}'}</code>
            <code className="bg-gray-100 px-1 rounded text-xs ml-1">{'{chunkInfo}'}</code>
            <code className="bg-gray-100 px-1 rounded text-xs ml-1">{'{analyses}'}</code>
            <code className="bg-gray-100 px-1 rounded text-xs ml-1">{'{preferences}'}</code>
            <code className="bg-gray-100 px-1 rounded text-xs ml-1">{'{candidateTitle}'}</code>
            <code className="bg-gray-100 px-1 rounded text-xs ml-1">{'{candidateAnalysis}'}</code>
          </p>

          <div className="space-y-3">
            <PromptSection
              title="分块分析 Prompt"
              value={form.promptAnalyze}
              onChange={(v) => setField('promptAnalyze', v)}
              onReset={() => resetPrompt('analyze')}
              expanded={showPrompts.analyze}
              onToggle={() => setShowPrompts(p => ({ ...p, analyze: !p.analyze }))}
            />
            <PromptSection
              title="分块合并 Prompt"
              value={form.promptMerge}
              onChange={(v) => setField('promptMerge', v)}
              onReset={() => resetPrompt('merge')}
              expanded={showPrompts.merge}
              onToggle={() => setShowPrompts(p => ({ ...p, merge: !p.merge }))}
            />
            <PromptSection
              title="推荐分析 Prompt"
              value={form.promptRecommend}
              onChange={(v) => setField('promptRecommend', v)}
              onReset={() => resetPrompt('recommend')}
              expanded={showPrompts.recommend}
              onToggle={() => setShowPrompts(p => ({ ...p, recommend: !p.recommend }))}
            />
          </div>

          <div className="mt-6">
            <Button variant="primary" onClick={handleSave} loading={saving}>
              保存 Prompt
            </Button>
          </div>
        </div>
      )}

      {tab === 'folders' && (
        <div className="bg-white shadow rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">文件夹配置</h3>
          <div className="space-y-4">
            <Field label="小说库" htmlFor="folderA" hint="存放待读小说的文件夹，支持 .txt 和 .epub 格式">
              <FolderPicker values={form.folderA} onChange={(v) => setField('folderA', v)} placeholder="选择小说库文件夹" />
            </Field>
            <Field label="收藏夹" htmlFor="folderB" hint="存放已读/喜爱小说的文件夹，导入后自动标记为喜欢">
              <FolderPicker values={form.folderB} onChange={(v) => setField('folderB', v)} placeholder="选择收藏夹文件夹" />
            </Field>
            <div className="flex items-center pt-2">
              <input
                type="checkbox"
                id="autoScan"
                checked={form.autoScan}
                onChange={(e) => setField('autoScan', e.target.checked)}
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
              />
              <label htmlFor="autoScan" className="ml-2 text-sm text-gray-700">启动时自动扫描文件夹</label>
            </div>
          </div>
          <div className="mt-6">
            <Button variant="primary" onClick={handleSave} loading={saving}>
              保存配置
            </Button>
          </div>
        </div>
      )}

      {tab === 'tokens' && (
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-semibold">Token 消耗统计</h3>
            <Button variant="danger" size="sm" onClick={handleClearTokenUsage} loading={tokenClearing} disabled={!tokenStats}>
              清空记录
            </Button>
          </div>

          {tokenLoading ? (
            <div className="text-center py-8 text-gray-400 text-sm">加载中…</div>
          ) : !tokenStats || tokenStats.total_calls === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">暂无 Token 消耗记录。执行小说分析后会自动记录。</div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="总请求数" value={String(tokenStats.total_calls)} />
                <StatCard label="Prompt Tokens" value={formatNumber(tokenStats.total_prompt_tokens)} />
                <StatCard label="Completion Tokens" value={formatNumber(tokenStats.total_completion_tokens)} />
                <StatCard label="总 Tokens" value={formatNumber(tokenStats.total_tokens)} />
              </div>

              {tokenStats.by_model.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">按模型统计</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-2 pr-4 font-medium text-gray-500">模型</th>
                          <th className="text-right py-2 pr-4 font-medium text-gray-500">请求数</th>
                          <th className="text-right py-2 font-medium text-gray-500">Tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tokenStats.by_model.map(m => (
                          <tr key={m.model} className="border-b border-gray-100">
                            <td className="py-2 pr-4 text-gray-900">{m.model}</td>
                            <td className="py-2 pr-4 text-right text-gray-600">{m.calls}</td>
                            <td className="py-2 text-right text-gray-600">{formatNumber(m.total_tokens)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {tokenStats.by_provider.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">按提供商统计</h4>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-2 pr-4 font-medium text-gray-500">提供商</th>
                          <th className="text-right py-2 pr-4 font-medium text-gray-500">请求数</th>
                          <th className="text-right py-2 font-medium text-gray-500">Tokens</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tokenStats.by_provider.map(p => (
                          <tr key={p.provider} className="border-b border-gray-100">
                            <td className="py-2 pr-4 text-gray-900">{p.provider}</td>
                            <td className="py-2 pr-4 text-right text-gray-600">{p.calls}</td>
                            <td className="py-2 text-right text-gray-600">{formatNumber(p.total_tokens)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-4 text-center">
      <div className="text-2xl font-bold text-indigo-600">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  )
}

function formatNumber(n: number): string {
  return n.toLocaleString('zh-CN')
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
    </div>
  )
}

function PromptSection({ title, value, onChange, onReset, expanded, onToggle }: {
  title: string
  value: string
  onChange: (v: string) => void
  onReset: () => void
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <div className="border border-gray-200 rounded-md">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex justify-between items-center px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <span>{title} {value ? <span className="text-xs text-indigo-500 ml-1">(自定义)</span> : <span className="text-xs text-gray-400 ml-1">(默认)</span>}</span>
        <span className="text-gray-400" aria-hidden="true">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          <textarea value={value} onChange={(e) => onChange(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-mono"
            rows={10} placeholder="留空使用默认 prompt" />
          <button onClick={onReset} className="text-xs text-gray-400 hover:text-gray-600 mt-2">恢复默认</button>
        </div>
      )}
    </div>
  )
}
