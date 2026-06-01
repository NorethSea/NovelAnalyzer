import { useRef, useState } from 'react'
import { api } from '../api'

interface FolderPickerProps {
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
}

export default function FolderPicker({ values, onChange, placeholder }: FolderPickerProps) {
  const [resolvingIdx, setResolvingIdx] = useState<number | null>(null)

  function update(index: number, val: string) {
    const next = [...values]
    next[index] = val
    onChange(next)
  }

  function remove(index: number) {
    onChange(values.filter((_, i) => i !== index))
  }

  function add() {
    onChange([...values, ''])
  }

  async function handleFileChange(index: number, e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return

    const firstFile = files[0]
    const relativePath = firstFile.webkitRelativePath
    e.target.value = ''

    if (!relativePath) {
      update(index, '')
      return
    }

    const folderName = relativePath.split('/')[0]
    setResolvingIdx(index)
    try {
      const result = await api.folders.resolve(folderName)
      update(index, result.resolved || folderName)
    } catch (err) {
      console.warn('[FolderPicker] 解析失败:', err)
      update(index, folderName)
    } finally {
      setResolvingIdx(null)
    }
  }

  return (
    <div className="space-y-2">
      {values.map((val, i) => (
        <FolderRow
          key={`folder-row-${i}`}
          value={val}
          index={i}
          total={values.length}
          resolving={resolvingIdx === i}
          onUpdate={update}
          onRemove={remove}
          onFileChange={handleFileChange}
          placeholder={placeholder}
        />
      ))}
      <button
        type="button"
        onClick={add}
        className="text-sm text-indigo-600 hover:text-indigo-800"
      >
        + 添加文件夹
      </button>
    </div>
  )
}

function FolderRow({
  value, index, total, resolving, onUpdate, onRemove, onFileChange, placeholder,
}: {
  value: string
  index: number
  total: number
  resolving: boolean
  onUpdate: (i: number, v: string) => void
  onRemove: (i: number) => void
  onFileChange: (i: number, e: React.ChangeEvent<HTMLInputElement>) => void
  placeholder?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex gap-2 items-center">
      <input
        type="text"
        value={value}
        onChange={(e) => onUpdate(index, e.target.value)}
        placeholder={placeholder || '点击右侧按钮选择文件夹'}
        readOnly
        className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm bg-gray-50"
        aria-label={`文件夹路径 ${index + 1}`}
      />
      <input
        ref={inputRef}
        type="file"
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => onFileChange(index, e)}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={resolving}
        className="px-3 py-2 bg-gray-100 border border-gray-300 rounded-md hover:bg-gray-200 text-sm whitespace-nowrap disabled:opacity-50"
      >
        {resolving ? '解析中...' : '浏览'}
      </button>
      {total > 1 && (
        <button
          type="button"
          onClick={() => onRemove(index)}
          aria-label="删除文件夹"
          className="px-2 py-2 text-gray-400 hover:text-red-500 text-sm"
          title="删除"
        >
          ✕
        </button>
      )}
    </div>
  )
}
