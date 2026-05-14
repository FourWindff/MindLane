import { nodeRegistry } from './registry'
import { topicDescriptor } from './topic'
import { palaceDescriptor } from './palace'

nodeRegistry.register(topicDescriptor)
nodeRegistry.register(palaceDescriptor)

export { nodeRegistry } from './registry'
export { NodeTypeDescriptor } from './types'
