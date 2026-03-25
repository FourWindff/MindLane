import type { NodeTypeDescriptor } from '../types'
import type { DocumentNodeData } from '@/shared/lib/fileFormat'
import { DocumentNodeComponent } from './DocumentNodeComponent'

export const documentDescriptor: NodeTypeDescriptor<DocumentNodeData> = {
  typeId: 'document',
  displayName: '文档',
  group: 'core',
  component: DocumentNodeComponent,
  defaultData: () => ({ filename: '', excerpt: '' }),
  userCreatable: false,
}
