import { nodeRegistry } from './registry'
import { topicDescriptor } from './topic'
import { palaceDescriptor } from './palace'
import { documentDescriptor } from './document'

nodeRegistry.register(topicDescriptor)
nodeRegistry.register(palaceDescriptor)
nodeRegistry.register(documentDescriptor)

export { nodeRegistry } from './registry'
export { NodeTypeDescriptor, type ContextMenuItem } from './types'
