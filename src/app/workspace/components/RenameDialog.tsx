import { TextPromptDialog } from '@/shared/components/TextPromptDialog'

interface RenameDialogProps {
  currentName: string
  isFile: boolean
  onConfirm: (newName: string) => void
  onCancel: () => void
}

export function RenameDialog({ currentName, isFile, onConfirm, onCancel }: RenameDialogProps) {
  // 文件名在界面上不带扩展名；重命名只改主名
  const displayName = isFile ? currentName.replace(/\.mindlane$/, '') : currentName

  return (
    <TextPromptDialog
      label="重命名"
      title={isFile ? '重命名文件' : '重命名文件夹'}
      initialValue={displayName}
      selectInitial
      placeholder={isFile ? '输入文件名' : '输入文件夹名'}
      canSubmit={(value) => value !== displayName}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
